import { expect, test } from "@playwright/test";
import { ADMIN, MEMBER, newSession, openAcme, unique, waitForLive } from "./fixtures";

test("admins manage board columns; changes and presence sync to other viewers", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const member = await newSession(browser, MEMBER);
  await Promise.all([waitForLive(admin.page), waitForLive(member.page)]);
  const org = await openAcme(admin.page);

  await admin.page.goto(`${org}/boards`);
  await admin.page.getByRole("link", { name: /Q3 Infrastructure/ }).click();
  await admin.page.waitForURL(/\/boards\//);
  await member.page.goto(admin.page.url());
  await expect(admin.page.getByLabel("People viewing this board").getByLabel("Sam Okafor")).toBeVisible();

  const column = unique("QA");
  await admin.page.getByRole("button", { name: "Columns" }).click();
  await admin.page.getByLabel("New column name").fill(column);
  await admin.page.getByLabel("New column type").selectOption("IN_REVIEW");
  await admin.page.getByRole("button", { name: "Add" }).click();
  await expect(member.page.getByRole("region", { name: column })).toBeVisible();

  const renamed = `${column}-renamed`;
  const nameInput = admin.page.getByLabel("Column name").last();
  await nameInput.fill(renamed);
  await nameInput.press("Enter");
  await expect(member.page.getByRole("region", { name: renamed })).toBeVisible();

  await admin.page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await expect(member.page.getByRole("region", { name: renamed })).toHaveCount(0);

  // Members don't get column controls.
  await expect(member.page.getByRole("button", { name: "Columns" })).toHaveCount(0);

  expect(admin.errors).toEqual([]);
  expect(member.errors).toEqual([]);
  await Promise.all([admin.context.close(), member.context.close()]);
});

test("quick-add a task and open it", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const org = await openAcme(admin.page);
  await admin.page.goto(`${org}/boards`);
  await admin.page.getByRole("link", { name: /Q3 Infrastructure/ }).click();
  const title = unique("Rotate TLS certificates");
  await admin.page.getByRole("button", { name: "Add task to To Do" }).click();
  await admin.page.getByPlaceholder("Task title — Enter to add").fill(title);
  await admin.page.keyboard.press("Enter");
  await admin.page.getByRole("button", { name: title }).click();
  await expect(admin.page.getByLabel("Title")).toHaveValue(title);
  await admin.context.close();
});
