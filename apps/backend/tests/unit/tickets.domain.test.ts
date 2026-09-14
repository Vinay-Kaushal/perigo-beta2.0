import { describe, expect, test } from "bun:test";
import type { TicketStatus } from "db/client";
import {
  SLA_HOURS,
  TRANSITIONS,
  canAssignTicket,
  canEditTicket,
  canTransition,
  checkStatusChange,
  isSlaBreached,
  slaDueAt,
  ticketKey,
} from "../../domain/tickets";

const requester = "req";
const assignee = "asg";
const bystander = "other";
const base = { requesterId: requester, assigneeId: assignee as string | null };

describe("SLA", () => {
  test("due date is derived from priority", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(slaDueAt("URGENT", from).toISOString()).toBe("2026-01-01T04:00:00.000Z");
    expect(slaDueAt("LOW", from).getTime() - from.getTime()).toBe(SLA_HOURS.LOW * 3_600_000);
  });

  test("breach only counts for open tickets past due", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-03T00:00:00Z");
    expect(isSlaBreached({ status: "OPEN", dueAt: past }, now)).toBe(true);
    expect(isSlaBreached({ status: "OPEN", dueAt: future }, now)).toBe(false);
    expect(isSlaBreached({ status: "RESOLVED", dueAt: past }, now)).toBe(false);
    expect(isSlaBreached({ status: "NEW", dueAt: null }, now)).toBe(false);
  });
});

describe("workflow", () => {
  test("every status has a transition list and never transitions to itself", () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      expect(tos).not.toContain(from as TicketStatus);
    }
  });

  test("closed tickets can only be reopened", () => {
    expect(TRANSITIONS.CLOSED).toEqual(["OPEN"]);
    expect(canTransition("CLOSED", "RESOLVED")).toBe(false);
    expect(canTransition("NEW", "CLOSED")).toBe(false);
  });

  test("resolving requires a note", () => {
    const actor = { userId: assignee, role: "MEMBER" as const };
    expect(checkStatusChange(actor, { ...base, status: "IN_PROGRESS" }, "RESOLVED")?.kind).toBe("INVALID_TRANSITION");
    expect(checkStatusChange(actor, { ...base, status: "IN_PROGRESS" }, "RESOLVED", "  ")?.kind).toBe("INVALID_TRANSITION");
    expect(checkStatusChange(actor, { ...base, status: "IN_PROGRESS" }, "RESOLVED", "Fixed")).toBeNull();
  });

  test("invalid transitions are rejected before permissions", () => {
    const admin = { userId: bystander, role: "OWNER" as const };
    expect(checkStatusChange(admin, { ...base, status: "NEW" }, "CLOSED")?.kind).toBe("INVALID_TRANSITION");
    expect(checkStatusChange(admin, { ...base, status: "OPEN" }, "OPEN")?.kind).toBe("INVALID_TRANSITION");
  });

  test("requester can cancel, confirm or reopen — nothing else", () => {
    const actor = { userId: requester, role: "MEMBER" as const };
    expect(checkStatusChange(actor, { ...base, status: "OPEN" }, "CANCELLED")).toBeNull();
    expect(checkStatusChange(actor, { ...base, status: "RESOLVED" }, "CLOSED")).toBeNull();
    expect(checkStatusChange(actor, { ...base, status: "RESOLVED" }, "OPEN")).toBeNull();
    expect(checkStatusChange(actor, { ...base, status: "OPEN" }, "IN_PROGRESS")?.kind).toBe("FORBIDDEN");
    expect(checkStatusChange(actor, { ...base, status: "OPEN" }, "RESOLVED", "done")?.kind).toBe("FORBIDDEN");
  });

  test("only admins reopen closed or cancelled tickets", () => {
    const member = { userId: assignee, role: "MEMBER" as const };
    const admin = { userId: bystander, role: "ADMIN" as const };
    expect(checkStatusChange({ userId: requester, role: "MEMBER" }, { ...base, status: "CLOSED" }, "OPEN")?.kind).toBe("FORBIDDEN");
    expect(checkStatusChange(member, { ...base, status: "CANCELLED" }, "OPEN")?.kind).toBe("FORBIDDEN");
    expect(checkStatusChange(admin, { ...base, status: "CLOSED" }, "OPEN")).toBeNull();
  });

  test("bystanders can't change status", () => {
    const actor = { userId: bystander, role: "MEMBER" as const };
    expect(checkStatusChange(actor, { ...base, status: "OPEN" }, "IN_PROGRESS")?.kind).toBe("FORBIDDEN");
  });
});

describe("permissions", () => {
  test("edit: requester, assignee, admins", () => {
    expect(canEditTicket({ userId: requester, role: "MEMBER" }, base)).toBe(true);
    expect(canEditTicket({ userId: assignee, role: "MEMBER" }, base)).toBe(true);
    expect(canEditTicket({ userId: bystander, role: "ADMIN" }, base)).toBe(true);
    expect(canEditTicket({ userId: bystander, role: "MEMBER" }, base)).toBe(false);
  });

  test("assign: anyone on unassigned tickets; requester/assignee/admin otherwise", () => {
    expect(canAssignTicket({ userId: bystander, role: "MEMBER" }, { ...base, assigneeId: null })).toBe(true);
    expect(canAssignTicket({ userId: bystander, role: "MEMBER" }, base)).toBe(false);
    expect(canAssignTicket({ userId: requester, role: "MEMBER" }, base)).toBe(true);
    expect(canAssignTicket({ userId: assignee, role: "MEMBER" }, base)).toBe(true);
    expect(canAssignTicket({ userId: bystander, role: "OWNER" }, base)).toBe(true);
  });

  test("ticket keys", () => {
    expect(ticketKey("TKT", 42)).toBe("TKT-42");
  });
});
