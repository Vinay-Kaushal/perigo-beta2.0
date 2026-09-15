import { expect, test, type Page } from "@playwright/test";
import { ADMIN, newSession, openAcme, unique } from "./fixtures";

/** Restores the default Urgent policy (safe to call whether or not it was customised). */
async function resetUrgent(page: Page, org: string) {
  await page.goto(`${org}/settings#sla`);
  const card = page.locator("#sla");
  // Wait for the policy table, so "no Reset button" really means "already default".
  await expect(card.getByLabel("urgent resolution hours")).toBeVisible();
  const row = card.getByRole("row").filter({ hasText: "Urgent" });
  const reset = row.getByRole("button", { name: "Reset" });
  if (await reset.isVisible()) {
    await reset.click();
    await expect(reset).toBeHidden();
  }
}

test("SLA targets are configurable, shown on tickets, and pause while on hold", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const { page } = admin;
  const org = await openAcme(page);
  await resetUrgent(page, org);

  try {
    await page.goto(`${org}/settings`);
    const card = page.locator("#sla");
    await expect(card.getByRole("heading", { name: "SLA & business hours" })).toBeVisible();
    const save = card.getByRole("button", { name: "Save SLA settings" });
    await expect(save).toBeDisabled();

    await card.getByLabel("urgent first response hours").fill("1");
    await card.getByLabel("urgent resolution hours").fill("6");
    await save.click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "SLA settings saved" })).toBeVisible();

    await page.reload();
    await expect(card.getByLabel("urgent resolution hours")).toHaveValue("6");
    await expect(card.getByRole("row").filter({ hasText: "Urgent" }).getByRole("button", { name: "Reset" })).toBeVisible();

    // The create dialog quotes the org's policy.
    await page.goto(`${org}/tickets`);
    await page.getByRole("button", { name: "New ticket" }).click();
    const dialog = page.getByRole("dialog", { name: "Raise a ticket" });
    const title = unique("Core switch down");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Priority").selectOption("URGENT");
    await expect(dialog.getByText("Response within 1 hour, resolution within 6 hours")).toBeVisible();
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await page.waitForURL(/\/tickets\/\d+$/);
    const ticketUrl = new URL(page.url()).pathname;

    const responseRow = page.locator("dt", { hasText: "Response SLA" }).locator("..");
    const resolutionRow = page.locator("dt", { hasText: "Resolution SLA" }).locator("..");
    await expect(responseRow.getByText(/due in (59|60)m|due in 1h/)).toBeVisible();
    await expect(resolutionRow.getByText("due in 6h")).toBeVisible();

    // On hold stops the clock.
    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByRole("menuitem", { name: "On hold" }).click();
    await expect(page.getByText("SLA paused while on hold")).toBeVisible();
    await expect(resolutionRow.getByText("Paused")).toBeVisible();

    await page.goto(`${org}/tickets?view=hold`);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

    await page.goto(ticketUrl);
    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByRole("menuitem", { name: "In progress" }).click();
    await expect(page.getByText("SLA paused while on hold")).toBeHidden();
    await expect(resolutionRow.getByText(/due in \dh/)).toBeVisible();
  } finally {
    await resetUrgent(page, org);
  }

  expect(admin.errors).toEqual([]);
  await admin.context.close();
});

/** Puts business hours back to the seeded defaults: off, UTC, Mon–Fri, 09:00–17:00. */
async function resetBusinessHours(page: Page, org: string) {
  await page.goto(`${org}/settings`);
  const card = page.locator("#sla");
  const toggle = card.getByRole("switch", { name: "Count only business hours" });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-checked")) === "false") await toggle.click();
  await card.getByLabel("Timezone").selectOption("UTC");
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    const button = card.getByRole("button", { name: day, exact: true });
    const wanted = day !== "Saturday" && day !== "Sunday";
    if (((await button.getAttribute("aria-pressed")) === "true") !== wanted) await button.click();
  }
  await card.getByLabel("Opens").fill("09:00");
  await card.getByLabel("Closes").fill("17:00");
  await toggle.click();
  if (await card.getByText("Unsaved changes").isVisible()) {
    await card.getByRole("button", { name: "Save SLA settings" }).click();
    await expect(card.getByText("Unsaved changes")).toBeHidden();
  }
}

test("business hours and holidays can be managed", async ({ browser }) => {
  const admin = await newSession(browser, ADMIN);
  const { page } = admin;
  const org = await openAcme(page);
  await resetBusinessHours(page, org);
  const card = page.locator("#sla");
  const toggle = card.getByRole("switch", { name: "Count only business hours" });

  try {
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await card.getByLabel("Timezone").selectOption("Asia/Kolkata");
    await card.getByRole("button", { name: "Saturday" }).click();
    await expect(card.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    await card.getByLabel("Opens").fill("10:00");
    await card.getByLabel("Closes").fill("18:30");
    await card.getByRole("button", { name: "Save SLA settings" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "SLA settings saved" })).toBeVisible();

    await page.reload();
    await expect(card.getByLabel("Timezone")).toHaveValue("Asia/Kolkata");
    await expect(card.getByLabel("Closes")).toHaveValue("18:30");
    await expect(card.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("(hours of business time)")).toBeVisible();

    const holidayName = unique("Founders day");
    await card.getByLabel("Date").fill("2031-01-02");
    await card.getByLabel("Name").fill(holidayName);
    await card.getByRole("button", { name: "Add holiday" }).click();
    await expect(card.getByText(holidayName)).toBeVisible();
    await card.getByRole("button", { name: `Remove ${holidayName}` }).click();
    await expect(card.getByText(holidayName)).toBeHidden();

    // Audit trail records the change.
    await expect(page.getByText(/updated SLA settings \(business hours\)/).first()).toBeVisible();
  } finally {
    await resetBusinessHours(page, org);
  }

  expect(admin.errors).toEqual([]);
  await admin.context.close();
});
