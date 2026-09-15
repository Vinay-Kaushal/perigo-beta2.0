import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { decodeKey, env } from "./env";

/**
 * Authenticated encryption (AES-256-GCM) for secrets we must be able to read
 * back — TOTP seeds and SSO client secrets. Passwords and tokens are hashed
 * instead. Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
const VERSION = "v1";
let cachedKey: { source: string; key: Buffer } | null = null;

function key(): Buffer {
  const { DATA_ENCRYPTION_KEY, JWT_SECRET } = env();
  const source = DATA_ENCRYPTION_KEY ?? `derived:${JWT_SECRET}`;
  if (cachedKey?.source === source) return cachedKey.key;
  const key = DATA_ENCRYPTION_KEY
    ? decodeKey(DATA_ENCRYPTION_KEY)!
    : // Development/test only (env() refuses production without a key).
      Buffer.from(hkdfSync("sha256", JWT_SECRET, "perigo", "data-encryption-key", 32));
  cachedKey = { source, key };
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Throws if the value was tampered with or encrypted under a different key. */
export function decryptSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
