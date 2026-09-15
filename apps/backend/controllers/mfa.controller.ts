import type { Request, Response } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/crypto";
import { HttpError, conflict } from "../lib/http";
import { securityAlertEmail, sendMail } from "../lib/mailer";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";
import { currentUser } from "../middleware/auth";
import { clearPendingSecret, pendingSecret, remainingRecoveryCodes, replaceRecoveryCodes, storePendingSecret, verifySecondFactor } from "../services/mfa";
import { frontendUrl, session } from "./auth.controller";

const ISSUER = "perigo";

async function alert(email: string, subject: string, intro: string) {
  await sendMail(securityAlertEmail(email, { subject, intro, url: frontendUrl("/profile#security") }));
}

export async function getMfaStatus(req: Request, res: Response) {
  const { id } = currentUser(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { mfaEnabledAt: true } });
  res.json({
    enabled: !!user.mfaEnabledAt,
    enabledAt: user.mfaEnabledAt,
    recoveryCodesRemaining: user.mfaEnabledAt ? await remainingRecoveryCodes(id) : 0,
  });
}

/** Step 1: a fresh secret, held for ten minutes until the user proves their app generates matching codes. */
export async function beginMfaSetup(req: Request, res: Response) {
  const me = currentUser(req);
  if (me.mfaEnabled) throw conflict("Two-factor authentication is already on");
  const secret = generateTotpSecret();
  await storePendingSecret(me.id, secret);
  const uri = otpauthUri({ secret, account: me.email, issuer: ISSUER });
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.json({ secret, otpauthUri: uri, qrSvg });
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });

/** Step 2: confirm a code, switch 2FA on and hand out recovery codes (shown once). */
export async function enableMfa(req: Request, res: Response) {
  const me = currentUser(req);
  const { code } = codeSchema.parse(req.body);
  if (me.mfaEnabled) throw conflict("Two-factor authentication is already on");

  const secret = await pendingSecret(me.id);
  if (!secret) throw new HttpError(400, "Setup expired. Start again to get a new QR code.", "MFA_SETUP_EXPIRED");
  const step = verifyTotp(secret, code);
  if (step === null) throw new HttpError(400, "That code doesn't match. Check the time on your device and try again.", "INVALID_MFA_CODE");

  const { user, recoveryCodes } = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: me.id, mfaEnabledAt: null },
      data: { mfaSecret: encryptSecret(secret), mfaEnabledAt: new Date(), mfaLastStep: step },
    });
    if (updated.count !== 1) throw conflict("Two-factor authentication is already on");
    const recoveryCodes = await replaceRecoveryCodes(me.id, tx);
    return { user: await tx.user.findUniqueOrThrow({ where: { id: me.id } }), recoveryCodes };
  });
  await clearPendingSecret(me.id);
  await alert(user.email, "Two-factor authentication is on", "Two-factor authentication was turned on for your perigo account. Keep your recovery codes somewhere safe.");

  // This session has now proven the second factor too.
  const context = me.session.amr.includes("otp") ? me.session : { ...me.session, amr: [...me.session.amr, "otp" as const] };
  session(res, user, context);
  res.json({ enabled: true, recoveryCodes });
}

const factorSchema = z
  .object({ code: z.string().trim().max(12).optional(), recoveryCode: z.string().trim().max(32).optional() })
  .refine((b) => !!b.code !== !!b.recoveryCode, "Enter an authentication code or a recovery code");

export async function disableMfa(req: Request, res: Response) {
  const me = currentUser(req);
  const body = factorSchema.parse(req.body);
  if (!me.mfaEnabled) throw conflict("Two-factor authentication is already off");

  const requiring = await prisma.organisation.findMany({
    where: { requireMfa: true, members: { some: { userId: me.id } } },
    select: { name: true },
  });
  if (requiring.length) {
    throw new HttpError(409, `You can't turn off two-factor authentication while ${requiring.map((o) => o.name).join(", ")} require${requiring.length === 1 ? "s" : ""} it`, "MFA_REQUIRED_BY_ORG", {
      organisations: requiring.map((o) => o.name),
    });
  }
  if (!(await verifySecondFactor(me.id, body))) throw new HttpError(400, "That code isn't valid", "INVALID_MFA_CODE");

  await prisma.$transaction([
    prisma.user.update({ where: { id: me.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: me.id } }),
  ]);
  await alert(me.email, "Two-factor authentication is off", "Two-factor authentication was turned off for your perigo account. Your account is now protected by your password alone.");
  res.json({ enabled: false });
}

/** Replaces every recovery code; needs a current authenticator code (not a recovery code). */
export async function regenerateRecoveryCodes(req: Request, res: Response) {
  const me = currentUser(req);
  const { code } = codeSchema.parse(req.body);
  if (!me.mfaEnabled) throw conflict("Turn on two-factor authentication first");
  if ((await verifySecondFactor(me.id, { code })) !== "otp") throw new HttpError(400, "That code isn't valid", "INVALID_MFA_CODE");

  const recoveryCodes = await replaceRecoveryCodes(me.id);
  await alert(me.email, "New recovery codes were generated", "New two-factor recovery codes were generated for your perigo account. The old codes no longer work.");
  res.json({ recoveryCodes });
}
