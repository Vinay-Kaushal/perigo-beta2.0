import { expect, test } from "@playwright/test";
import { ADMIN, MEMBER, newSession, openAcme, unique, waitForLive } from "./fixtures";

test("notification preferences persist and are respected live", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const member = await newSession(browser, MEMBER);
  await Promise.all([waitForLive(admin.page), waitForLive(member.page)]);

  // Sam turns off in-app assignment notifications.
  await member.page.goto("/profile#notifications");
  const inAppAssignments = member.page.getByRole("switch", { name: "Assignments in-app notifications" });
  await expect(inAppAssignments).toHaveAttribute("aria-checked", "true");
  await inAppAssignments.click();
  await expect(inAppAssignments).toHaveAttribute("aria-checked", "false");
  await member.page.reload();
  await expect(member.page.getByRole("switch", { name: "Assignments in-app notifications" })).toHaveAttribute("aria-checked", "false");
  await waitForLive(member.page);

  try {
    const org = await openAcme(admin.page);
    const title = unique("Silent assignment");
    await admin.page.goto(`${org}/tickets`);
    await admin.page.getByRole("button", { name: "New ticket" }).click();
    const dialog = admin.page.getByRole("dialog", { name: "Raise a ticket" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Assignee").selectOption({ label: "Sam Okafor" });
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await admin.page.waitForURL(/\/tickets\/\d+$/);

    // No live toast for Sam this time.
    await member.page.waitForTimeout(2500);
    await expect(member.page.locator("[data-sonner-toast]").filter({ hasText: "assigned" })).toHaveCount(0);
  } finally {
    const toggle = member.page.getByRole("switch", { name: "Assignments in-app notifications" });
    await member.page.goto("/profile#notifications");
    if ((await toggle.getAttribute("aria-checked")) === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }

  expect(admin.errors).toEqual([]);
  expect(member.errors).toEqual([]);
  await Promise.all([admin.context.close(), member.context.close()]);
});

test("unsubscribe page needs a click and rejects forged links", async ({ page }) => {
  await page.goto("/unsubscribe?token=00000000-0000-4000-8000-000000000000.ALL.forged");
  await expect(page.getByText("Stop receiving all notification emails from perigo?")).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText("This unsubscribe link is invalid")).toBeVisible();
});
