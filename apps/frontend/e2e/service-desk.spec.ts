import { expect, test } from "@playwright/test";
import { ADMIN, MEMBER, newSession, openAcme, unique, waitForLive } from "./fixtures";

test("assigning a ticket reaches the assignee live, and their updates reach the requester live", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const member = await newSession(browser, MEMBER);
  await Promise.all([waitForLive(admin.page), waitForLive(member.page)]);

  const org = await openAcme(admin.page);
  await member.page.goto(`${org}/tickets`);
  await expect(member.page.getByRole("heading", { name: "Service desk" })).toBeVisible();

  const title = unique("Laptop battery swelling");
  await admin.page.goto(`${org}/tickets`);
  await admin.page.getByRole("button", { name: "New ticket" }).click();
  const dialog = admin.page.getByRole("dialog", { name: "Raise a ticket" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill("Battery is visibly bulging.");
  await dialog.getByLabel("Priority").selectOption("URGENT");
  await dialog.getByLabel("Assignee").selectOption({ label: "Sam Okafor" });
  await dialog.getByRole("button", { name: "Create ticket" }).click();
  await admin.page.waitForURL(/\/tickets\/\d+$/);

  // No reload on the assignee's side: the queue row and the toast arrive over the socket.
  await expect(member.page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(member.page.locator("[data-sonner-toast]").filter({ hasText: "Marcus Chen assigned" })).toBeVisible();
  await expect(member.page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();

  await member.page.getByRole("link", { name: new RegExp(title) }).click();
  await member.page.getByRole("button", { name: "Change status" }).click();
  await member.page.getByRole("menuitem", { name: "In progress" }).click();
  await expect(admin.page.getByRole("region", { name: "Activity" }).getByText(/changed status from\s*Open\s*to\s*In progress/)).toBeVisible();

  await member.page.getByLabel("Comment").fill("Swapping it with a loaner now.");
  await member.page.getByRole("button", { name: "Comment", exact: true }).click();
  // Scoped to the timeline: the same text also arrives in the live notification toast.
  await expect(admin.page.getByRole("region", { name: "Activity" }).getByText("Swapping it with a loaner now.")).toBeVisible();

  // Resolving requires a note.
  await member.page.getByRole("button", { name: "Change status" }).click();
  await member.page.getByRole("menuitem", { name: "Resolved" }).click();
  await expect(member.page.getByRole("button", { name: "Resolve ticket" })).toBeDisabled();
  await member.page.getByLabel("Resolution note").fill("Replaced the battery.");
  await member.page.getByRole("button", { name: "Resolve ticket" }).click();
  await expect(admin.page.getByText("Resolution").locator("..").getByText("Replaced the battery.")).toBeVisible();

  expect(admin.errors).toEqual([]);
  expect(member.errors).toEqual([]);
  await Promise.all([admin.context.close(), member.context.close()]);
});

test("queue views and search", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const org = await openAcme(admin.page);
  await admin.page.goto(`${org}/tickets`);
  await admin.page.getByRole("button", { name: /SLA breached/ }).click();
  await expect(admin.page).toHaveURL(/view=breached/);
  await admin.page.getByLabel("Search tickets").fill("VPN disconnects");
  await expect(admin.page.getByRole("link", { name: /VPN disconnects every 10 minutes/ })).toBeVisible();
  await admin.context.close();
});
