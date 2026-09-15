import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { randomToken, sha256, type AuthMethod } from "../lib/tokens";
import { generateRecoveryCodes, normaliseRecoveryCode, verifyTotp } from "../lib/totp";

export const MFA_CHALLENGE_TTL_SEC = 5 * 60;
export const MFA_MAX_ATTEMPTS = 5;
export const MFA_SETUP_TTL_SEC = 10 * 60;

// ---------------------------------------------------------------- login challenge

interface Challenge {
  userId: string;
  tokenVersion: number;
  method: Extract<AuthMethod, "pwd" | "google">;
}

const challengeKey = (token: string) => `mfa:challenge:${sha256(token)}`;

/** After the first factor succeeds: a short-lived, single-use token that stands in for "password was correct". */
export async function createMfaChallenge(user: { id: string; tokenVersion: number }, method: Challenge["method"]) {
  const token = randomToken();
  const value: Challenge = { userId: user.id, tokenVersion: user.tokenVersion, method };
  await redis().set(challengeKey(token), JSON.stringify(value), "EX", MFA_CHALLENGE_TTL_SEC);
  return token;
}

export type ChallengeLookup = { ok: true; challenge: Challenge } | { ok: false; reason: "invalid" | "too_many_attempts" };

/** Counts an attempt; the challenge is destroyed after too many wrong codes, forcing a fresh sign-in. */
export async function loadMfaChallenge(token: string): Promise<ChallengeLookup> {
  if (token.length < 20 || token.length > 128) return { ok: false, reason: "invalid" };
  const key = challengeKey(token);
  const [[, raw], [, attempts]] = (await redis().multi().get(key).incr(`${key}:attempts`).expire(`${key}:attempts`, MFA_CHALLENGE_TTL_SEC).exec()) as [
    [unknown, string | null],
    [unknown, number],
    unknown,
  ];
  if (!raw) return { ok: false, reason: "invalid" };
  if (attempts > MFA_MAX_ATTEMPTS) {
    await redis().del(key);
    return { ok: false, reason: "too_many_attempts" };
  }
  return { ok: true, challenge: JSON.parse(raw) as Challenge };
}

/** Single use: returns false if another request already redeemed it. */
export async function consumeMfaChallenge(token: string) {
  const key = challengeKey(token);
  const removed = await redis().del(key);
  await redis().del(`${key}:attempts`);
  return removed === 1;
}

// ---------------------------------------------------------------- setup

const setupKey = (userId: string) => `mfa:setup:${userId}`;

export async function storePendingSecret(userId: string, secret: string) {
  await redis().set(setupKey(userId), encryptSecret(secret), "EX", MFA_SETUP_TTL_SEC);
}

export async function pendingSecret(userId: string) {
  const raw = await redis().get(setupKey(userId));
  return raw ? decryptSecret(raw) : null;
}

export const clearPendingSecret = (userId: string) => redis().del(setupKey(userId));

export async function replaceRecoveryCodes(userId: string, tx: Pick<typeof prisma, "mfaRecoveryCode"> = prisma) {
  const codes = generateRecoveryCodes();
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: sha256(normaliseRecoveryCode(code)) })) });
  return codes;
}

// ---------------------------------------------------------------- verification

/**
 * Verifies a TOTP code or a recovery code for a user with 2FA on. A TOTP step
 * is claimed with a conditional update, so the same code can't be used twice
 * even by concurrent requests; a recovery code is burned the same way.
 */
export async function verifySecondFactor(userId: string, input: { code?: string; recoveryCode?: string }): Promise<"otp" | "rec" | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true } });
  if (!user?.mfaEnabledAt || !user.mfaSecret) return null;

  if (input.code) {
    const step = verifyTotp(decryptSecret(user.mfaSecret), input.code, { lastUsedStep: user.mfaLastStep });
    if (step === null) return null;
    const claimed = await prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    return claimed.count === 1 ? "otp" : null;
  }

  if (input.recoveryCode) {
    const normalised = normaliseRecoveryCode(input.recoveryCode);
    if (normalised.length !== 10) return null;
    const burned = await prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: sha256(normalised), usedAt: null },
      data: { usedAt: new Date() },
    });
    return burned.count === 1 ? "rec" : null;
  }
  return null;
}

export const remainingRecoveryCodes = (userId: string) => prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
