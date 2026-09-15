import { expect, test, type Page } from "@playwright/test";
import { MEMBER, PASSWORD, newSession, openAcme, signIn, unique, watchForErrors } from "./fixtures";
import { totp } from "./totp";

const OWNER = "owner@acme.test";

/** Turns 2FA on from the profile page and returns what the user would have saved. */
async function enableTwoFactor(page: Page) {
  await page.goto("/profile#security");
  const card = page.locator("#security");
  await card.getByRole("button", { name: "Set up two-factor" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up two-factor authentication" });
  await expect(dialog.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await dialog.getByText("Can't scan it? Enter the key manually").click();
  const secret = ((await dialog.getByTestId("mfa-secret").textContent()) ?? "").replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await dialog.getByLabel("Authentication code").fill(totp(secret));
  await dialog.getByRole("button", { name: "Turn on" }).click();

  const codesDialog = page.getByRole("dialog", { name: "Your recovery codes" });
  const items = codesDialog.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
  await expect(items).toHaveCount(10);
  const recoveryCodes = await items.allTextContents();
  await codesDialog.getByRole("button", { name: "I've saved them" }).click();
  await expect(card.getByText("On", { exact: true })).toBeVisible();
  return { secret, recoveryCodes };
}

async function passwordStep(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("two-factor authentication: set up, then sign in with a code or a recovery code", async ({ browser }) => {
  const setupContext = await browser.newContext();
  const page = await setupContext.newPage();
  const errors = watchForErrors(page);
  const email = `${unique("twofactor")}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Tess Factor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");
  const { secret, recoveryCodes } = await enableTwoFactor(page);
  expect(errors).toEqual([]);
  await setupContext.close();

  // Password, then an authenticator code. (The next 30-second code: the setup code can't be reused.)
  const second = await browser.newContext();
  const login = await second.newPage();
  const loginErrors = watchForErrors(login, [(status, url) => status === 401 && url.endsWith("/auth/mfa/verify")]);
  await passwordStep(login, email);
  await expect(login.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await login.getByLabel("Authentication code").fill("000000");
  await login.getByRole("button", { name: "Verify" }).click();
  await expect(login.getByText("That code isn't valid")).toBeVisible();
  await login.getByLabel("Authentication code").fill(totp(secret, Date.now() + 30_000));
  await login.getByRole("button", { name: "Verify" }).click();
  await login.waitForURL("**/dashboard");
  expect(loginErrors).toEqual([]);
  await second.close();

  // A recovery code instead.
  const third = await browser.newContext();
  const recovery = await third.newPage();
  await passwordStep(recovery, email);
  await recovery.getByRole("button", { name: "Use a recovery code instead" }).click();
  await recovery.getByLabel("Recovery code").fill(recoveryCodes[0]!);
  await recovery.getByRole("button", { name: "Verify" }).click();
  await recovery.waitForURL("**/dashboard");
  await recovery.goto("/profile#security");
  await expect(recovery.locator("#security").getByText("9 of 10 recovery codes left")).toBeVisible();
  await third.close();
});

test("an organisation that requires 2FA locks out members who don't have it", async ({ browser }) => {
  const owner = await newSession(browser, OWNER);
  const { recoveryCodes } = await enableTwoFactor(owner.page);
  const org = await openAcme(owner.page);

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  const memberErrors = watchForErrors(member, [(status, url) => status === 403 && url.includes("/organisations/")]);

  try {
    await owner.page.goto(`${org}/settings`);
    const policy = owner.page.locator("#mfa-policy");
    await policy.getByRole("switch", { name: "Require two-factor authentication" }).click();
    await owner.page.getByRole("dialog", { name: "Require two-factor authentication?" }).getByRole("button", { name: "Require it" }).click();
    await expect(owner.page.locator("[data-sonner-toast]").filter({ hasText: "Two-factor authentication is now required" })).toBeVisible();

    await signIn(member, MEMBER);
    await member.goto("/orgs");
    await expect(member.locator("main").getByRole("link", { name: /Acme Corp/ }).getByText("2FA required")).toBeVisible();
    await member.goto(org);
    await expect(member.getByText("Acme Corp requires two-factor authentication", { exact: true })).toBeVisible();
    await expect(member.getByRole("link", { name: "Set up two-factor authentication" })).toHaveAttribute("href", "/profile#security");
  } finally {
    await owner.page.goto(`${org}/settings`);
    const toggle = owner.page.locator("#mfa-policy").getByRole("switch", { name: "Require two-factor authentication" });
    if ((await toggle.getAttribute("aria-checked")) === "true") {
      await toggle.click();
      await expect(owner.page.locator("[data-sonner-toast]").filter({ hasText: "now optional" })).toBeVisible();
    }
    await owner.page.goto("/profile#security");
    await owner.page.locator("#security").getByRole("button", { name: "Turn off" }).click();
    const dialog = owner.page.getByRole("dialog", { name: "Turn off two-factor authentication?" });
    await dialog.getByRole("button", { name: "Use a recovery code instead" }).click();
    await dialog.getByLabel("Recovery code").fill(recoveryCodes[0]!);
    await dialog.getByRole("button", { name: "Turn off" }).click();
    await expect(owner.page.locator("#security").getByRole("button", { name: "Set up two-factor" })).toBeVisible();
  }

  expect(owner.errors).toEqual([]);
  expect(memberErrors).toEqual([]);
  await Promise.all([owner.context.close(), memberContext.close()]);
});

test("single sign-on: verify a domain, connect and test the IdP, auto-provision, then require SSO", async ({ browser }) => {
  // Needs the mock identity provider (apps/backend/scripts/mock-oidc.ts) and an API that allows it.
  const idp = process.env.E2E_MOCK_IDP_URL;
  test.skip(!idp, "E2E_MOCK_IDP_URL isn't set");

  const owner = await newSession(browser, OWNER);
  const org = await openAcme(owner.page);
  const settings = async () => {
    await owner.page.goto(`${org}/settings#sso`);
    const card = owner.page.locator("#sso");
    // Loaded, so "no Remove button" really means there's nothing to remove.
    await expect(card.getByLabel("Redirect URI", { exact: true })).toBeVisible();
    return card;
  };
  const toast = (text: string | RegExp) => owner.page.locator("[data-sonner-toast]").filter({ hasText: text });

  try {
    let card = await settings();
    await card.getByLabel("Domain", { exact: true }).fill("acme.test");
    await card.getByRole("button", { name: "Add domain" }).click();
    const row = card.getByRole("listitem").filter({ hasText: "acme.test" });
    await expect(row.getByText("Pending")).toBeVisible();
    await expect(row.getByText("_perigo-challenge.acme.test")).toBeVisible();
    await row.getByRole("button", { name: "Verify" }).click();
    await expect(row.getByText("Verified")).toBeVisible();

    await card.getByLabel("Issuer URL").fill(idp!);
    await card.getByLabel("Client ID").fill("perigo-e2e");
    await card.getByLabel("Client secret").fill("perigo-e2e-secret");
    await card.getByRole("switch", { name: "Enable single sign-on" }).click();
    await card.getByRole("switch", { name: "Create accounts automatically" }).click();
    await expect(card.getByRole("switch", { name: "Require single sign-on" })).toBeDisabled();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(toast("Single sign-on settings saved")).toBeVisible();

    // Test the connection: a round trip through the identity provider back to settings.
    await card.getByRole("button", { name: "Test connection" }).click();
    await owner.page.waitForURL(`${idp}/authorize**`);
    await owner.page.getByLabel("Email").fill(OWNER);
    await owner.page.getByRole("button", { name: "Continue" }).click();
    await owner.page.waitForURL(`**${org}/settings**`);
    await expect(toast("Single sign-on works")).toBeVisible();

    // Someone new on the domain signs in through SSO and is provisioned into the org.
    const newcomerContext = await browser.newContext();
    const newcomer = await newcomerContext.newPage();
    const newcomerErrors = watchForErrors(newcomer);
    const email = `${unique("jamie")}@acme.test`;
    await newcomer.goto("/login");
    await newcomer.getByRole("button", { name: "Sign in with SSO" }).click();
    await newcomer.getByLabel("Work email").fill(email);
    await newcomer.getByRole("button", { name: "Continue with SSO" }).click();
    await newcomer.waitForURL(`${idp}/authorize**`);
    await expect(newcomer.getByLabel("Email")).toHaveValue(email);
    await newcomer.getByLabel("Name").fill("Jamie Rivera");
    await newcomer.getByRole("button", { name: "Continue" }).click();
    await newcomer.waitForURL("**/dashboard");
    await expect(newcomer.getByRole("heading", { name: /Good (morning|afternoon|evening), Jamie/ })).toBeVisible();
    await newcomer.goto("/orgs");
    await expect(newcomer.locator("main").getByRole("link", { name: /Acme Corp/ })).toBeVisible();
    expect(newcomerErrors).toEqual([]);
    await newcomerContext.close();

    // Require SSO: Sam's password no longer works, and the login page routes him through SSO.
    card = await settings();
    await card.getByRole("switch", { name: "Require single sign-on" }).click();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(toast("Single sign-on settings saved")).toBeVisible();

    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    const memberErrors = watchForErrors(member, [(status, url) => status === 403 && url.endsWith("/auth/login")]);
    await passwordStep(member, MEMBER);
    await expect(member.getByRole("heading", { name: "Single sign-on" })).toBeVisible();
    await expect(member.getByText("Acme Corp requires you to sign in with single sign-on")).toBeVisible();
    await member.getByLabel("Work email").fill(MEMBER);
    await member.getByRole("button", { name: "Continue with SSO" }).click();
    await member.waitForURL(`${idp}/authorize**`);
    await member.getByRole("button", { name: "Continue" }).click();
    await member.waitForURL("**/dashboard");
    await member.goto("/profile");
    await expect(member.getByText("This session: signed in with single sign-on")).toBeVisible();
    expect(memberErrors).toEqual([]);
    await memberContext.close();

    // The audit log records the setup.
    await owner.page.goto(`${org}/settings`);
    await expect(owner.page.getByText("verified the domain acme.test").first()).toBeVisible();
  } finally {
    const card = await settings();
    const remove = card.getByRole("button", { name: "Remove", exact: true });
    if (await remove.isVisible()) {
      await remove.click();
      await owner.page.getByRole("dialog", { name: "Remove single sign-on?" }).getByRole("button", { name: "Remove" }).click();
      await expect(toast("Single sign-on removed")).toBeVisible();
    }
    const removeDomain = card.getByRole("button", { name: "Remove acme.test" });
    if (await removeDomain.isVisible()) {
      await removeDomain.click();
      await expect(removeDomain).toBeHidden();
    }
  }

  expect(owner.errors).toEqual([]);
  await owner.context.close();
});
