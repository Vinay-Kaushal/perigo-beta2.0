import { env } from "./env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/** Captured messages — lets tests assert on what would have been sent. */
export const outbox: MailMessage[] = [];

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Transport = (message: MailMessage) => Promise<void>;
let testTransport: Transport | null = null;

/** Tests can simulate provider failures. */
export function setTestTransport(transport: Transport | null) {
  testTransport = transport;
}

let smtp: import("nodemailer").Transporter | null = null;
async function smtpTransport(url: string) {
  if (!smtp) {
    const nodemailer = await import("nodemailer");
    smtp = nodemailer.createTransport(url);
  }
  return smtp;
}

/**
 * Sends one message through the configured provider and throws on failure,
 * so queued deliveries can retry. Order: test outbox, SMTP, Resend, console.
 */
export async function deliverMail(message: MailMessage): Promise<"sent" | "logged"> {
  const { NODE_ENV, SMTP_URL, RESEND_API_KEY, MAIL_FROM } = env();

  if (NODE_ENV === "test") {
    if (testTransport) await testTransport(message);
    outbox.push(message);
    return "sent";
  }

  if (SMTP_URL) {
    const transport = await smtpTransport(SMTP_URL);
    await transport.sendMail({ from: MAIL_FROM, to: message.to, subject: message.subject, text: message.text, html: message.html, headers: message.headers });
    return "sent";
  }

  if (RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: message.to, subject: message.subject, text: message.text, html: message.html, headers: message.headers }),
    });
    if (!res.ok) throw new Error(`Email provider rejected message (${res.status})`);
    return "sent";
  }

  console.info(`[mail] (no provider configured) to=${message.to} subject="${message.subject}"\n${message.text}`);
  return "logged";
}

/**
 * For transactional mail sent inline (invitations, verification, password reset):
 * never throws — callers also expose the link another way or let the user retry.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    return (await deliverMail(message)) === "sent";
  } catch (err) {
    console.error(`[mail] send failed to ${message.to}`, err);
    return false;
  }
}

export function invitationEmail(opts: {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  url: string;
  requiresApproval: boolean;
}): MailMessage {
  const org = escapeHtml(opts.orgName);
  const inviter = escapeHtml(opts.inviterName);
  const approvalLine = opts.requiresApproval
    ? "After you accept, an organisation admin will review and approve your request."
    : "";
  return {
    to: opts.to,
    subject: `${opts.inviterName} invited you to join ${opts.orgName} on perigo`,
    text: `${opts.inviterName} invited you to join ${opts.orgName} as ${opts.role.toLowerCase()}.\n\nAccept the invitation: ${opts.url}\n\n${approvalLine}\nThis link expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111">
  <h2 style="font-weight:600">Join ${org} on perigo</h2>
  <p><strong>${inviter}</strong> invited you to join <strong>${org}</strong> as ${escapeHtml(opts.role.toLowerCase())}.</p>
  <p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
  <p style="color:#555;font-size:13px">${approvalLine}</p>
  <p style="color:#888;font-size:12px">This link expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
</div>`,
  };
}

function actionEmail(opts: { to: string; subject: string; heading: string; intro: string; cta: string; url: string; footer: string }): MailMessage {
  return {
    to: opts.to,
    subject: opts.subject,
    text: `${opts.intro}\n\n${opts.cta}: ${opts.url}\n\n${opts.footer}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111">
  <h2 style="font-weight:600">${escapeHtml(opts.heading)}</h2>
  <p>${escapeHtml(opts.intro)}</p>
  <p><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(opts.cta)}</a></p>
  <p style="color:#888;font-size:12px">${escapeHtml(opts.footer)}</p>
</div>`,
  };
}

export function verificationEmail(to: string, name: string, url: string) {
  return actionEmail({
    to,
    subject: "Verify your email for perigo",
    heading: `Welcome, ${name}`,
    intro: "Confirm this is your email address to finish setting up your account.",
    cta: "Verify email",
    url,
    footer: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
  });
}

export function passwordResetEmail(to: string, url: string) {
  return actionEmail({
    to,
    subject: "Reset your perigo password",
    heading: "Reset your password",
    intro: "Someone (hopefully you) asked to reset the password for this account.",
    cta: "Choose a new password",
    url,
    footer: "This link expires in 1 hour and can be used once. If you didn't ask for this, ignore this email — your password won't change.",
  });
}
