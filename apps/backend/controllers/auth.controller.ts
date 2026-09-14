import type { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { redis } from "../lib/redis";
import { randomToken, sha256, signAccessToken } from "../lib/tokens";
import { HttpError } from "../lib/http";
import { clearSessionCookie, setSessionCookie } from "../lib/session";
import { passwordResetEmail, sendMail, verificationEmail } from "../lib/mailer";
import { currentUser } from "../middleware/auth";

const rounds = () => env().BCRYPT_ROUNDS;
// Compared against when the email doesn't exist, so a miss costs the same
// time as a hit and response timing doesn't reveal which emails are registered.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("perigo-timing-equaliser", rounds()));

export const WS_TICKET_TTL_SEC = 30;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters") // bcrypt ignores bytes past 72
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), "Must be an http(s) URL");

type UserRow = { id: string; email: string; name: string; avatarUrl: string | null; tokenVersion: number; emailVerifiedAt: Date | null };

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Issues a session: the httpOnly cookie is what browsers use; the token in the
 * body is for non-browser API clients (the web app never stores it).
 */
function session(res: Response, user: UserRow) {
  const token = signAccessToken(user);
  setSessionCookie(res, token);
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, emailVerifiedAt: user.emailVerifiedAt },
  };
}

const frontendUrl = (path: string) => `${env().FRONTEND_URL.replace(/\/$/, "")}${path}`;

/** Creates a single-use token (only its hash is stored), invalidating earlier unused ones of the same type. */
async function issueAuthToken(userId: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlMs: number) {
  const token = randomToken();
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return token;
}

/** Atomically consumes a valid token; returns its userId or null. */
async function consumeAuthToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
  if (token.length < 20 || token.length > 128) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
  // updateMany with usedAt: null guards against two concurrent redemptions.
  const claimed = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? row.userId : null;
}

async function sendVerification(user: { id: string; email: string; name: string }) {
  const token = await issueAuthToken(user.id, "EMAIL_VERIFICATION", VERIFY_TTL_MS);
  await sendMail(verificationEmail(user.email, user.name, frontendUrl(`/verify-email?token=${token}`)));
}

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
});

export async function register(req: Request, res: Response) {
  const body = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw new HttpError(409, "An account with this email already exists", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(body.password, rounds());
  const user = await prisma.user.create({
    data: { email: body.email, name: body.name, passwordHash, lastLoginAt: new Date() },
  });
  await sendVerification(user);

  res.status(201).json(session(res, user));
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const valid = await bcrypt.compare(body.password, user?.passwordHash ?? getDummyHash());
  if (!user || !valid) throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");

  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json(session(res, updated));
}

export async function me(req: Request, res: Response) {
  const { id } = currentUser(req);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true, lastLoginAt: true, emailVerifiedAt: true },
  });
  res.json(user);
}

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatarUrl: httpsUrl.nullable().optional(),
});

export async function updateMe(req: Request, res: Response) {
  const { id } = currentUser(req);
  const body = updateMeSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id },
    data: body,
    select: { id: true, email: true, name: true, avatarUrl: true, emailVerifiedAt: true },
  });
  res.json(user);
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** Rotates tokenVersion, so every other session is signed out; returns a fresh token for this one. */
export async function changePassword(req: Request, res: Response) {
  const { id } = currentUser(req);
  const body = changePasswordSchema.parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!valid) throw new HttpError(400, "Current password is incorrect", "INVALID_CREDENTIALS");
  if (body.currentPassword === body.newPassword) {
    throw new HttpError(400, "New password must be different from the current one");
  }

  const passwordHash = await bcrypt.hash(body.newPassword, rounds());
  const updated = await prisma.user.update({
    where: { id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
  res.json(session(res, updated));
}

/** "Sign out everywhere" — invalidates every token issued so far, including this one. */
export async function logoutAll(req: Request, res: Response) {
  const { id } = currentUser(req);
  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  clearSessionCookie(res);
  res.status(204).send();
}

/** Ends this browser's session. (Public: clearing a cookie needs no auth, and works even if the session already expired.) */
export async function logout(_req: Request, res: Response) {
  clearSessionCookie(res);
  res.status(204).send();
}

const tokenBodySchema = z.object({ token: z.string().min(1).max(200) });

export async function verifyEmail(req: Request, res: Response) {
  const { token } = tokenBodySchema.parse(req.body);
  const userId = await consumeAuthToken(token, "EMAIL_VERIFICATION");
  if (!userId) throw new HttpError(400, "This verification link is invalid or has expired", "INVALID_TOKEN");
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  res.json({ verified: true });
}

export async function resendVerification(req: Request, res: Response) {
  const me = currentUser(req);
  if (me.emailVerified) return res.json({ sent: false, alreadyVerified: true });
  await sendVerification(me);
  res.json({ sent: true });
}

const forgotSchema = z.object({ email: emailSchema });

/** Always 202 with the same body, so the endpoint can't be used to discover which emails have accounts. */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = forgotSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (user) {
    const token = await issueAuthToken(user.id, "PASSWORD_RESET", RESET_TTL_MS);
    await sendMail(passwordResetEmail(user.email, frontendUrl(`/reset-password?token=${token}`)));
  }
  res.status(202).json({ message: "If an account exists for that email, a reset link is on its way." });
}

const resetSchema = z.object({ token: z.string().min(1).max(200), newPassword: passwordSchema });

/** Sets the new password and signs out every existing session. The emailed link also proves inbox ownership. */
export async function resetPassword(req: Request, res: Response) {
  const body = resetSchema.parse(req.body);
  const userId = await consumeAuthToken(body.token, "PASSWORD_RESET");
  if (!userId) throw new HttpError(400, "This reset link is invalid or has expired", "INVALID_TOKEN");

  const passwordHash = await bcrypt.hash(body.newPassword, rounds());
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, tokenVersion: { increment: 1 }, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  await prisma.authToken.updateMany({ where: { userId, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
  clearSessionCookie(res);
  res.status(204).send();
}

/**
 * Short-lived, single-use ticket for opening a websocket. Keeps the
 * long-lived JWT out of websocket URLs (which end up in proxy/access logs).
 */
export async function createWsTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const ticket = randomToken(24);
  await redis().set(
    `ws:ticket:${ticket}`,
    JSON.stringify({ userId: user.id, email: user.email, name: user.name }),
    "EX",
    WS_TICKET_TTL_SEC
  );
  res.status(201).json({ ticket, expiresIn: WS_TICKET_TTL_SEC });
}

const googleAuthSchema = z.object({ idToken: z.string().min(1).max(4096) });

let _googleClient: import("google-auth-library").OAuth2Client | null = null;
async function googleClient() {
  if (_googleClient) return _googleClient;
  const { OAuth2Client } = await import("google-auth-library");
  _googleClient = new OAuth2Client(env().GOOGLE_CLIENT_ID);
  return _googleClient;
}

export async function googleAuth(req: Request, res: Response) {
  const body = googleAuthSchema.parse(req.body);
  const clientId = env().GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(501, "Google sign-in isn't configured on this server", "NOT_CONFIGURED");

  let payload;
  try {
    const ticket = await (await googleClient()).verifyIdToken({ idToken: body.idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "Invalid Google credential", "INVALID_CREDENTIALS");
  }

  // Linking by email is only safe when Google has verified the address —
  // otherwise anyone could claim an existing account's email.
  if (!payload?.email || payload.email_verified !== true) {
    throw new HttpError(401, "Google account email is not verified", "INVALID_CREDENTIALS");
  }

  const email = payload.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // passwordHash is NOT NULL; a hash of random bytes matches no password,
    // so password login stays impossible until the user sets one.
    const unusablePasswordHash = await bcrypt.hash(randomToken(32), rounds());
    user = await prisma.user.create({
      data: {
        email,
        name: payload.name ?? email.split("@")[0]!,
        avatarUrl: payload.picture ?? null,
        passwordHash: unusablePasswordHash,
      },
    });
  }

  // Google verified the address, which is as good as our own verification email.
  user = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  res.json(session(res, user));
}
