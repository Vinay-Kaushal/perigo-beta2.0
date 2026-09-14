import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "./env";

const ISSUER = "perigo";
const AUDIENCE = "perigo-api";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  tv: number;
}

export function signAccessToken(user: { id: string; email: string; name: string; tokenVersion: number }) {
  return jwt.sign({ email: user.email, name: user.name, tv: user.tokenVersion }, env().JWT_SECRET, {
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
  return decoded as unknown as AccessTokenClaims;
}

/** URL-safe, 256 bits of entropy. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
