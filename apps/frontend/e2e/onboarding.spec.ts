import { expect, test } from "@playwright/test";
import { ADMIN, PASSWORD, newSession, openAcme, unique, watchForErrors } from "./fixtures";

test("invite → new user registers from the link → accepts → admin approves → member", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const org = await openAcme(admin.page);
  const email = `${unique("newhire")}@example.com`;

  await admin.page.goto(`${org}/members`);
  await admin.page.getByRole("button", { name: "Invite" }).click();
  await admin.page.getByLabel("Email address").fill(email);
  await admin.page.getByRole("button", { name: "Send invitation" }).click();
  const link = await admin.page.getByLabel("Invitation link", { exact: true }).inputValue();
  expect(link).toContain("/invitations/");
  await admin.page.getByRole("button", { name: "Done" }).click();

  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  // Before approval the invitee is expected to get a 404 for the org itself — nothing else.
  const errors = watchForErrors(invitee, [(status, url) => status === 404 && /\/organisations\/[0-9a-f-]{36}$/.test(url)]);
  await invitee.goto(new URL(link).pathname);
  await expect(invitee.getByRole("heading", { name: "Join Acme Corp" })).toBeVisible();
  await invitee.getByRole("button", { name: "Create account to accept" }).click();
  await invitee.getByLabel("Full name").fill("New Hire");
  await expect(invitee.getByLabel("Work email")).toHaveValue(email);
  await invitee.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await invitee.waitForURL(/\/invitations\//);
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await expect(invitee.getByRole("heading", { name: "Request sent for approval" })).toBeVisible();

  // Not a member until approved.
  await invitee.goto(org);
  await expect(invitee.getByText("You don't have access to this organisation")).toBeVisible();

  await admin.page.goto(`${org}/members?tab=requests`);
  const row = admin.page.getByRole("listitem").filter({ hasText: email });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.page.locator("[data-sonner-toast]").filter({ hasText: "approved" })).toBeVisible();

  await expect(invitee.locator("[data-sonner-toast]").filter({ hasText: "approved to join Acme Corp" })).toBeVisible();
  await invitee.goto(org);
  await expect(invitee.getByRole("heading", { name: "Acme Corp" })).toBeVisible();

  await admin.page.goto(`${org}/settings`);
  await expect(admin.page.getByText(`approved ${email} to join as member`)).toBeVisible();

  expect(errors).toEqual([]);
  expect(admin.errors).toEqual([]);
  await Promise.all([admin.context.close(), inviteeContext.close()]);
});
