import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "./env";

const ISSUER = "perigo";
const AUDIENCE = "perigo-api";

/**
 * How a session was established (RFC 8176 "amr" values): "pwd" password,
 * "google" Google sign-in, "otp" TOTP second factor, "rec" recovery code,
 * "sso" an organisation's identity provider (then `sso` is the connection id).
 */
export type AuthMethod = "pwd" | "google" | "otp" | "rec" | "sso";

export interface SessionContext {
  amr: AuthMethod[];
  sso?: string;
}

export interface AccessTokenClaims extends SessionContext {
  sub: string;
  email: string;
  name: string;
  tv: number;
}

export function signAccessToken(user: { id: string; email: string; name: string; tokenVersion: number }, context: SessionContext = { amr: ["pwd"] }) {
  const payload = { email: user.email, name: user.name, tv: user.tokenVersion, amr: context.amr, ...(context.sso ? { sso: context.sso } : {}) };
  return jwt.sign(payload, env().JWT_SECRET, {
    algorithm: "HS256",
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env().JWT_TTL as jwt.SignOptions["expiresIn"],
  });
}

/** Throws on a bad signature, wrong alg/issuer/audience, or expiry. */
export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, env().JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof decoded !== "object" || typeof decoded.sub !== "string" || typeof decoded.tv !== "number") {
    throw new Error("Malformed token");
  }
  const claims = decoded as unknown as AccessTokenClaims;
  return { ...claims, amr: Array.isArray(claims.amr) ? claims.amr : [], sso: typeof claims.sso === "string" ? claims.sso : undefined };
}

/** URL-safe, 256 bits of entropy. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
