import { describe, expect, test } from "bun:test";
import { CATEGORIES, categoryFor, resolveSettings } from "../../domain/notifications";
import { unsubscribeToken, verifyUnsubscribeToken } from "../../lib/unsubscribe";
import { renderNotificationEmail } from "../../services/emailTemplates";
import { retryDelayMs } from "../../services/emailQueue";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.com", name: "Ada <script>" };
const item = (over: Partial<Parameters<typeof renderNotificationEmail>[1][number]> = {}) => ({
  notificationId: null,
  category: "ASSIGNMENTS" as const,
  title: "Marcus assigned ACME-1 to you",
  body: "Printer <b>on fire</b>",
  link: "/orgs/x/tickets/1",
  organisationName: "Acme & Co",
  createdAt: new Date().toISOString(),
  ...over,
});

describe("categories", () => {
  test("every known type maps to a category; unknown types stay deliverable", () => {
    expect(categoryFor("TICKET_ASSIGNED")).toBe("ASSIGNMENTS");
    expect(categoryFor("MENTIONED")).toBe("MENTIONS");
    expect(categoryFor("TICKET_COMMENTED")).toBe("TICKET_UPDATES");
    expect(categoryFor("JOIN_REQUEST")).toBe("APPROVALS");
    expect(categoryFor("EXPENSE_REJECTED")).toBe("ACCOUNT");
    expect(categoryFor("SOMETHING_NEW")).toBe("ACCOUNT");
  });

  test("defaults: everything in-app; email on except noisy ticket activity; rows override", () => {
    const defaults = resolveSettings([]);
    expect(Object.values(defaults).every((s) => s.inApp)).toBe(true);
    expect(defaults.TICKET_UPDATES.email).toBe(false);
    expect(defaults.MENTIONS.email).toBe(true);
    const custom = resolveSettings([{ category: "MENTIONS", inApp: false, email: false }]);
    expect(custom.MENTIONS).toEqual({ inApp: false, email: false });
    expect(Object.keys(custom)).toHaveLength(CATEGORIES.length);
  });
});

describe("unsubscribe tokens", () => {
  test("round-trip and reject tampering", () => {
    const token = unsubscribeToken(user.id, "MENTIONS");
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: user.id, scope: "MENTIONS" });
    expect(verifyUnsubscribeToken(token.replace("MENTIONS", "ALL"))).toBeNull();
    expect(verifyUnsubscribeToken(token.replace(user.id, "22222222-2222-4222-8222-222222222222"))).toBeNull();
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });
});

describe("email rendering", () => {
  test("single notification: specific subject, CTA, escaped content, one-click unsubscribe headers", () => {
    const msg = renderNotificationEmail(user, [item()]);
    expect(msg.subject).toBe("Marcus assigned ACME-1 to you");
    expect(msg.html).toContain("Open in perigo");
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).not.toContain("<b>on fire</b>");
    expect(msg.html).toContain("Acme &amp; Co");
    expect(msg.text).toContain("http://localhost:3000/orgs/x/tickets/1");
    expect(msg.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = /<(.*)>/.exec(msg.headers!["List-Unsubscribe"]!)![1]!;
    const token = new URL(url).searchParams.get("token")!;
    expect(verifyUnsubscribeToken(token)?.scope).toBe("ASSIGNMENTS");
  });

  test("several notifications become a digest; mixed categories unsubscribe from all", () => {
    const msg = renderNotificationEmail(user, [item(), item({ category: "MENTIONS", title: "Sam mentioned you" }), item({ title: "Third" })]);
    expect(msg.subject).toBe("3 new updates in perigo");
    expect(msg.text).toContain("Sam mentioned you");
    const token = new URL(/<(.*)>/.exec(msg.headers!["List-Unsubscribe"]!)![1]!).searchParams.get("token")!;
    expect(verifyUnsubscribeToken(token)?.scope).toBe("ALL");
  });

  test("links that aren't app paths fall back to the inbox", () => {
    const msg = renderNotificationEmail(user, [item({ link: "https://evil.example/phish" })]);
    expect(msg.html).not.toContain("evil.example");
    expect(msg.text).toContain("http://localhost:3000/notifications");
  });
});

describe("retry backoff", () => {
  test("grows exponentially and is capped", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(50)).toBe(60 * 60 * 1000);
  });
});
