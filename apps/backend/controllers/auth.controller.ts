import type { Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";
import type { Request } from "express";

const TOKEN_TTL = "7d";

function signToken(user: { id: string; email: string; name: string }) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET!, {
    expiresIn: TOKEN_TTL,
  });
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(120),
});

export async function register(req: Request, res: Response) {
  const body = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: { email: body.email, name: body.name, passwordHash },
  });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  });
}

export async function me(req: AuthedRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });
}

const updateMeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
});

export async function updateMe(req: AuthedRequest, res: Response) {
  const body = updateMeSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id: req.user.id }, data: body });
  res.json({ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

export async function changePassword(req: AuthedRequest, res: Response) {
  const body = changePasswordSchema.parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await bcrypt.hash(body.newPassword, 10);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
  res.status(204).send();
}

const googleAuthSchema = z.object({ idToken: z.string().min(1) });

let _googleClient: import("google-auth-library").OAuth2Client | null = null;
async function googleClient() {
  if (_googleClient) return _googleClient;
  const { OAuth2Client } = await import("google-auth-library");
  _googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return _googleClient;
}

export async function googleAuth(req: Request, res: Response) {
  const body = googleAuthSchema.parse(req.body);

  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: "Google sign-in isn't configured on this server yet" });
  }

  const client = await googleClient();
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: body.idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "Invalid Google credential" });
  }

  if (!payload?.email) {
    return res.status(401).json({ error: "Google account has no verified email" });
  }

  // Match by email regardless of how the account was originally created —
  // someone who registered with a password can still use "Sign in with
  // Google" later on the same address, and vice versa.
  let user = await prisma.user.findUnique({ where: { email: payload.email } });

  if (!user) {
    // OAuth-only accounts still need *some* passwordHash since the column
    // is NOT NULL — this hash matches no possible input, so password login
    // simply always fails for this user until they set one via /auth/me.
    const unusablePasswordHash = await bcrypt.hash(`google-oauth:${payload.sub}:${Date.now()}`, 10);
    user = await prisma.user.create({
      data: {
        email: payload.email,
        name: payload.name ?? payload.email.split("@")[0],
        avatarUrl: payload.picture ?? null,
        passwordHash: unusablePasswordHash,
      },
    });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  });
}
