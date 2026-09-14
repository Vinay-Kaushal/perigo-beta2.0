import type { NotificationCategory } from "db/client";
import { env } from "../lib/env";
import { escapeHtml, type MailMessage } from "../lib/mailer";
import { unsubscribeToken } from "../lib/unsubscribe";
import { CATEGORIES } from "../domain/notifications";

export interface EmailItem {
  notificationId: string | null;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  organisationName: string | null;
  createdAt: string;
}

const absolute = (link: string | null) => `${env().FRONTEND_URL.replace(/\/$/, "")}${link && link.startsWith("/") ? link : "/notifications"}`;

/**
 * One email for a batch of notifications. A single item gets its own subject
 * and call to action; several become a short digest. All user-provided text is
 * escaped, and every email carries RFC 8058 one-click unsubscribe headers.
 */
export function renderNotificationEmail(user: { id: string; email: string; name: string }, items: EmailItem[]): MailMessage {
  const categories = [...new Set(items.map((i) => i.category))];
  const scope = categories.length === 1 ? categories[0]! : "ALL";
  const token = unsubscribeToken(user.id, scope);
  const oneClick = `${env().API_PUBLIC_URL.replace(/\/$/, "")}/email/unsubscribe?token=${encodeURIComponent(token)}`;
  const unsubscribePage = `${env().FRONTEND_URL.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;
  const preferences = `${env().FRONTEND_URL.replace(/\/$/, "")}/profile#notifications`;
  const scopeLabel = scope === "ALL" ? "all notification" : `${CATEGORIES.find((c) => c.category === scope)?.label.toLowerCase()}`;

  const single = items.length === 1 ? items[0]! : null;
  const subject = single ? single.title : `${items.length} new updates in perigo`;

  const textLines = items.map((i) => `• ${i.title}${i.body ? `\n  ${i.body}` : ""}\n  ${absolute(i.link)}`);
  const text = [
    `Hi ${user.name},`,
    "",
    single ? "You have a new notification:" : `You have ${items.length} new notifications:`,
    "",
    ...textLines,
    "",
    `Manage notification emails: ${preferences}`,
    `Unsubscribe from ${scopeLabel} emails: ${unsubscribePage}`,
  ].join("\n");

  const rows = items
    .map(
      (i) => `<tr><td style="padding:12px 0;border-bottom:1px solid #eee">
  <a href="${escapeHtml(absolute(i.link))}" style="color:#111;font-weight:600;text-decoration:none">${escapeHtml(i.title)}</a>
  ${i.body ? `<div style="color:#555;font-size:13px;margin-top:4px">${escapeHtml(i.body)}</div>` : ""}
  ${i.organisationName ? `<div style="color:#999;font-size:12px;margin-top:4px">${escapeHtml(i.organisationName)}</div>` : ""}
</td></tr>`
    )
    .join("");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#111">
  <p>Hi ${escapeHtml(user.name)},</p>
  <p>${single ? "You have a new notification:" : `You have ${items.length} new notifications:`}</p>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
  ${single ? `<p style="margin-top:20px"><a href="${escapeHtml(absolute(single.link))}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in perigo</a></p>` : `<p style="margin-top:20px"><a href="${escapeHtml(absolute("/notifications"))}" style="color:#4f46e5">View all notifications</a></p>`}
  <p style="color:#999;font-size:12px;margin-top:28px">
    <a href="${escapeHtml(preferences)}" style="color:#999">Notification preferences</a> ·
    <a href="${escapeHtml(unsubscribePage)}" style="color:#999">Unsubscribe from ${escapeHtml(scopeLabel)} emails</a>
  </p>
</div>`;

  return {
    to: user.email,
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
