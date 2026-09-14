import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "Password123";
export const ADMIN = "admin@acme.test";
export const MEMBER = "sam@acme.test";

/**
 * Collects browser-side failures so every test also asserts the app didn't
 * throw or hit unexpected HTTP errors. Pass `allow` for responses a test
 * deliberately provokes (e.g. a 404 while access is still pending).
 */
export function watchForErrors(page: Page, allow: Array<(status: number, url: string) => boolean> = []) {
  const problems: string[] = [];
  const expected = [
    // Checking for a session on public pages is expected to 401.
    (status: number, url: string) => status === 401 && url.endsWith("/auth/me"),
    ...allow,
  ];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Resource failures are reported (with their URL) by the response listener below.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400 || expected.some((ok) => ok(r.status(), r.url()))) return;
    problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

export async function newSession(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = watchForErrors(page);
  await signIn(page, email);
  return { context, page, errors };
}

export async function waitForLive(page: Page) {
  await expect(page.getByRole("status", { name: "Live updates on" })).toBeVisible({ timeout: 15_000 });
}

/** Opens the seeded Acme Corp org and returns its base URL (/orgs/<id>). */
export async function openAcme(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Organisations" }).click();
  await page.waitForURL("**/orgs");
  await page.locator("main").getByRole("link", { name: /Acme Corp/ }).click();
  await page.waitForURL(/\/orgs\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
