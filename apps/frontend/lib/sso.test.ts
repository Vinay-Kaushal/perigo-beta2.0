import { describe, expect, test } from "bun:test";
import { ssoErrorMessage, ssoTestFailureMessage } from "./sso";
import { ApiError, ssoRequiredLoginUrl, ssoStartUrl } from "./api";
import { groupSecret } from "../components/two-factor-card";

describe("SSO messages", () => {
  test("known callback errors get specific copy; unknown ones (and prototype keys) a generic line", () => {
    expect(ssoErrorMessage("domain_not_verified")).toContain("hasn't verified");
    expect(ssoErrorMessage("no_account")).toContain("invitation");
    expect(ssoErrorMessage("made_up")).toBe("Single sign-on failed. Please try again.");
    expect(ssoErrorMessage("__proto__")).toBe("Single sign-on failed. Please try again.");
    expect(ssoTestFailureMessage("not_owner")).toContain("owners");
    expect(ssoTestFailureMessage(null)).toContain("didn't complete");
  });
});

describe("SSO URLs", () => {
  test("start URL carries the email and a safe return path", () => {
    const url = new URL(ssoStartUrl("sam@acme.test", "/orgs/1?view=mine"));
    expect(url.pathname).toBe("/auth/sso/start");
    expect(url.searchParams.get("email")).toBe("sam@acme.test");
    expect(url.searchParams.get("next")).toBe("/orgs/1?view=mine");
    expect(new URL(ssoStartUrl("sam@acme.test", "https://evil.example")).searchParams.get("next")).toBe("/dashboard");
  });

  test("an SSO_REQUIRED error sends people to login with the organisation's name", () => {
    const err = new ApiError(401, "Acme requires SSO", "SSO_REQUIRED", undefined, { organisation: { name: "Acme & Co", slug: "acme" } });
    const url = new URL(ssoRequiredLoginUrl(err, "/orgs/1"), "http://app.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("sso")).toBe("required");
    expect(url.searchParams.get("org")).toBe("Acme & Co");
    expect(url.searchParams.get("next")).toBe("/orgs/1");
  });
});

describe("groupSecret", () => {
  test("splits a base32 key into groups of four for manual entry", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
  });
});
