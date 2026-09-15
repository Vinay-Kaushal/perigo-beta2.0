import { describe, expect, test } from "bun:test";
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hotp, normaliseRecoveryCode, otpauthUri, timeStep, totpAt, verifyTotp } from "../../lib/totp";

const RFC_SECRET = Buffer.from("12345678901234567890");

describe("base32", () => {
  test("RFC 4648 vectors and round-trips", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
    const random = generateTotpSecret();
    expect(base32Encode(base32Decode(random))).toBe(random);
    expect(base32Decode(random)).toHaveLength(20);
    expect(() => base32Decode("not base32!")).toThrow();
  });
});

describe("HOTP / TOTP", () => {
  test("RFC 4226 HOTP vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  test("RFC 6238 SHA-1 vectors (8 digits)", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, code] of vectors) expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(code);
  });

  test("accepts the current step and one either side, nothing further", () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 8, 16, 12, 0, 10);
    expect(verifyTotp(secret, totpAt(secret, now), { now })).toBe(timeStep(now));
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), { now })).toBe(timeStep(now) - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), { now })).toBe(timeStep(now) + 1);
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), { now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now + 90_000), { now })).toBeNull();
  });

  test("rejects replays, malformed input and other secrets", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totpAt(secret, now);
    const step = verifyTotp(secret, code, { now })!;
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { now })).toBe(step);
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a"]) expect(verifyTotp(secret, bad, { now })).toBeNull();
    expect(verifyTotp(generateTotpSecret(), code, { now })).toBeNull();
  });

  test("otpauth URI for authenticator apps", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "sam@acme.test", issuer: "perigo" });
    expect(uri).toBe("otpauth://totp/perigo%3Asam%40acme.test?secret=JBSWY3DPEHPK3PXP&issuer=perigo&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  test("ten distinct, readable codes that normalise for comparison", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    expect(normaliseRecoveryCode(" ABCDE-fghjk ")).toBe("abcdefghjk");
  });
});
