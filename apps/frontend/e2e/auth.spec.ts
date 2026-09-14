import { expect, test } from "@playwright/test";
import { ADMIN, signIn, watchForErrors } from "./fixtures";

test("protected pages redirect to login and come back after signing in", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/notifications");
  await page.waitForURL(/\/login\?next=%2Fnotifications/);
  await page.getByLabel("Work email").fill(ADMIN);
  await page.getByLabel("Password", { exact: true }).fill("Password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/notifications");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(ADMIN);
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("the session is an httpOnly cookie the page can't read", async ({ page, context }) => {
  await signIn(page, ADMIN);
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "perigo_session");
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("perigo_session");
});

test("open redirects via ?next= are ignored", async ({ page }) => {
  await page.goto("/login?next=https://evil.example/phish");
  await page.getByLabel("Work email").fill(ADMIN);
  await page.getByLabel("Password", { exact: true }).fill("Password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("button", { name: /Marcus Chen/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);
});

test("forgot password never reveals whether an account exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill("nobody-here@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists for/)).toBeVisible();
});
