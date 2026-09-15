import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

/**
 * Time-based one-time passwords (RFC 6238 / RFC 4226), compatible with
 * Google Authenticator, 1Password, Authy, Microsoft Authenticator…
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, as RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, secret).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const timeStep = (ms: number) => Math.floor(ms / 1000 / TOTP_PERIOD_SEC);

export function totpAt(secretBase32: string, ms: number): string {
  return hotp(base32Decode(secretBase32), timeStep(ms));
}

/**
 * Checks a code against the current step and one step either side (clock
 * drift). Returns the matching step, or null. Steps at or before `lastUsedStep`
 * are rejected, so an intercepted code can't be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, { now = Date.now(), lastUsedStep = null as number | null } = {}): number | null {
  const normalised = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalised)) return null;
  const secret = base32Decode(secretBase32);
  const current = timeStep(now);
  let matched: number | null = null;
  // Check every candidate (no early exit) to keep timing independent of which step matched.
  for (const step of [current - 1, current, current + 1]) {
    const candidate = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(candidate, Buffer.from(normalised)) && (lastUsedStep === null || step > lastUsedStep)) {
      matched = matched ?? step;
    }
  }
  return matched;
}

export function otpauthUri({ secret, account, issuer }: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SEC) });
  return `otpauth://totp/${label}?${params}`;
}

/** Ten single-use recovery codes like "k3vq9-m2x7p". */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
