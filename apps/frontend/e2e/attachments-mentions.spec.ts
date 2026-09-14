import { expect, test } from "@playwright/test";
import { ADMIN, MEMBER, newSession, openAcme, unique, waitForLive } from "./fixtures";

test("attach files to a ticket and mention a colleague, who is notified live", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const member = await newSession(browser, MEMBER);
  await Promise.all([waitForLive(admin.page), waitForLive(member.page)]);

  const org = await openAcme(admin.page);
  const title = unique("Printer driver crash");
  await admin.page.goto(`${org}/tickets`);
  await admin.page.getByRole("button", { name: "New ticket" }).click();
  const dialog = admin.page.getByRole("dialog", { name: "Raise a ticket" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create ticket" }).click();
  await admin.page.waitForURL(/\/tickets\/\d+$/);
  const ticketUrl = new URL(admin.page.url()).pathname;

  // Upload through the ticket's attachment panel.
  const panel = admin.page.getByRole("region", { name: "Attachments" });
  await panel.locator('input[type="file"]').setInputFiles({ name: "crash-log.txt", mimeType: "text/plain", buffer: Buffer.from("Faulting module: printdrv.dll\n") });
  await expect(panel.getByRole("link", { name: "crash-log.txt", exact: true })).toBeVisible();

  // A disguised file is rejected with a clear message and never appears.
  await panel.locator('input[type="file"]').setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await expect(admin.page.locator("[data-sonner-toast]").filter({ hasText: "don't match its extension" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "cat.png", exact: true })).toHaveCount(0);

  // The colleague sees the file, then mentions the admin in a comment with an attachment.
  await member.page.goto(ticketUrl);
  await expect(member.page.getByRole("region", { name: "Attachments" }).getByRole("link", { name: "crash-log.txt", exact: true })).toBeVisible();

  const composer = member.page.getByLabel("Comment");
  await composer.fill("Looping in ");
  await composer.pressSequentially("@Marc");
  const suggestions = member.page.getByRole("listbox", { name: "Mention someone" });
  await expect(suggestions.getByRole("option", { name: /Marcus Chen/ })).toBeVisible();
  await composer.press("Enter");
  await composer.pressSequentially("can you check the driver version?");
  await expect(composer).toHaveValue("Looping in @Marcus Chen can you check the driver version?");

  await member.page.locator("form").filter({ has: composer }).locator('input[type="file"]').setInputFiles({ name: "version.json", mimeType: "application/json", buffer: Buffer.from('{"driver":"4.2.1"}') });
  await expect(member.page.getByRole("button", { name: "Remove version.json" })).toBeVisible();
  await member.page.getByRole("button", { name: "Comment", exact: true }).click();

  // The admin is told they were mentioned — live, without reloading.
  await expect(admin.page.locator("[data-sonner-toast]").filter({ hasText: "Sam Okafor mentioned you in a comment on" })).toBeVisible();

  const activity = admin.page.getByRole("region", { name: "Activity" });
  await expect(activity.getByText("@Marcus Chen", { exact: true })).toBeVisible();
  await expect(activity.getByRole("link", { name: "version.json", exact: true })).toBeVisible();

  // The only allowed error is the deliberate 415 for the disguised upload.
  expect(admin.errors.filter((e) => !/^415 POST .*\/attachments$/.test(e))).toEqual([]);
  expect(member.errors).toEqual([]);
  await Promise.all([admin.context.close(), member.context.close()]);
});
