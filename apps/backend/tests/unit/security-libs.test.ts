import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { resetEnvCache } from "../../lib/env";
import { assertSafeUrl, isPrivateAddress, setHostResolver } from "../../lib/netGuard";
import { safeNextPath } from "../../controllers/sso.controller";

const originalEnv = { ...process.env };
function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  resetEnvCache();
}
afterEach(() => {
  for (const k of ["DATA_ENCRYPTION_KEY", "SSO_ALLOW_PRIVATE_NETWORK", "SSO_ALLOW_HTTP_ISSUERS", "NODE_ENV", "SSO_DOMAIN_VERIFICATION"]) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  resetEnvCache();
  setHostResolver(null);
});
afterAll(() => resetEnvCache());

describe("encryptSecret", () => {
  test("round-trips, uses a fresh IV each time, and detects tampering", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP");
    const b = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(a)).toBe("JBSWY3DPEHPK3PXP");

    const parts = a.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([parts[0], parts[1], parts[2], flipped.toString("base64url")].join("."))).toThrow();
    expect(() => decryptSecret("v2.x.y.z")).toThrow("Unrecognised");
  });

  test("a different key can't decrypt", () => {
    const sealed = encryptSecret("client-secret");
    withEnv({ DATA_ENCRYPTION_KEY: "ab".repeat(32) });
    expect(() => decryptSecret(sealed)).toThrow();
    const sealedWithKey = encryptSecret("client-secret");
    expect(decryptSecret(sealedWithKey)).toBe("client-secret");
  });

  test("production refuses to start without a key, or with unsafe SSO settings", () => {
    const { env } = require("../../lib/env") as typeof import("../../lib/env");
    withEnv({ NODE_ENV: "production", DATA_ENCRYPTION_KEY: undefined });
    expect(() => env()).toThrow("DATA_ENCRYPTION_KEY");
    withEnv({ NODE_ENV: "production", DATA_ENCRYPTION_KEY: "ab".repeat(32), SSO_DOMAIN_VERIFICATION: "skip" });
    expect(() => env()).toThrow("SSO_DOMAIN_VERIFICATION");
    withEnv({ NODE_ENV: "test", DATA_ENCRYPTION_KEY: "too-short" });
    expect(() => env()).toThrow("32 bytes");
  });
});

describe("SSRF guard", () => {
  test("classifies private, reserved and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      expect({ ip, private: isPrivateAddress(ip) }).toEqual({ ip, private: true });
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.1.1", "2606:4700::1111"]) {
      expect({ ip, private: isPrivateAddress(ip) }).toEqual({ ip, private: false });
    }
  });

  test("blocks http, credentials and hostnames that resolve internally", async () => {
    withEnv({ SSO_ALLOW_PRIVATE_NETWORK: "false", SSO_ALLOW_HTTP_ISSUERS: "false" });
    const zone: Record<string, string[]> = { "idp.example.com": ["93.184.216.34"], "sneaky.example.com": ["93.184.216.34", "10.0.0.5"], "metadata.example.com": ["169.254.169.254"] };
    setHostResolver(async (host) => zone[host] ?? []);

    await expect(assertSafeUrl("https://idp.example.com/.well-known/openid-configuration")).resolves.toBeUndefined();
    await expect(assertSafeUrl("http://idp.example.com")).rejects.toThrow("https");
    await expect(assertSafeUrl("https://user:pw@idp.example.com")).rejects.toThrow("credentials");
    await expect(assertSafeUrl("https://sneaky.example.com")).rejects.toThrow("private");
    await expect(assertSafeUrl("https://metadata.example.com")).rejects.toThrow("private");
    await expect(assertSafeUrl("https://127.0.0.1")).rejects.toThrow("private");
    await expect(assertSafeUrl("https://[::1]")).rejects.toThrow("private");
    await expect(assertSafeUrl("https://nowhere.example.com")).rejects.toThrow("private");
  });

  test("operators can allow a self-hosted IdP on the private network", async () => {
    withEnv({ SSO_ALLOW_PRIVATE_NETWORK: "true", SSO_ALLOW_HTTP_ISSUERS: "false" });
    await expect(assertSafeUrl("https://10.0.0.5")).resolves.toBeUndefined();
    await expect(assertSafeUrl("http://10.0.0.5")).rejects.toThrow("https");
  });
});

describe("post-login redirects", () => {
  test("only same-app relative paths survive", () => {
    expect(safeNextPath("/orgs/1/tickets?view=mine")).toBe("/orgs/1/tickets?view=mine");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", undefined, 42, "/a\r\nSet-Cookie: x"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});
