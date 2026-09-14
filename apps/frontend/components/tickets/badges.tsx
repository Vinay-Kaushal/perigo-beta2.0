import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUp, Minus, Bug, HelpCircle, Layers, RefreshCcw, Wrench, Clock } from "lucide-react";
import type { GoalHealth, Priority, TicketStatus, TicketType } from "@/lib/types";
import { Badge, Dot, type BadgeTone } from "@/components/ui/badge";
import { cn, dueLabel } from "@/lib/utils";

export const STATUS_META: Record<TicketStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: "New", tone: "info" },
  OPEN: { label: "Open", tone: "accent" },
  IN_PROGRESS: { label: "In progress", tone: "warning" },
  ON_HOLD: { label: "On hold", tone: "neutral" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const PRIORITY_META: Record<Priority, { label: string; icon: React.ElementType; className: string }> = {
  URGENT: { label: "Urgent", icon: ChevronsUp, className: "text-danger" },
  HIGH: { label: "High", icon: ArrowUp, className: "text-warning" },
  MEDIUM: { label: "Medium", icon: Minus, className: "text-info" },
  LOW: { label: "Low", icon: ArrowDown, className: "text-ink-faint" },
};

export const TYPE_META: Record<TicketType, { label: string; icon: React.ElementType }> = {
  INCIDENT: { label: "Incident", icon: Bug },
  SERVICE_REQUEST: { label: "Service request", icon: Wrench },
  PROBLEM: { label: "Problem", icon: Layers },
  CHANGE: { label: "Change", icon: RefreshCcw },
  QUESTION: { label: "Question", icon: HelpCircle },
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone}>
      <Dot />
      {meta.label}
    </Badge>
  );
}

export function PriorityLabel({ priority, compact }: { priority: Priority; compact?: boolean }) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-ink" title={`${meta.label} priority`}>
      <Icon size={14} className={meta.className} strokeWidth={2.5} />
      {!compact && meta.label}
    </span>
  );
}

export function TypeLabel({ type }: { type: TicketType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
      <Icon size={13} />
      {meta.label}
    </span>
  );
}

export function SlaLabel({ dueAt, breached, done }: { dueAt: string | null; breached: boolean; done?: boolean }) {
  if (!dueAt || done) return <span className="text-[13px] text-ink-faint">—</span>;
  const label = dueLabel(dueAt)!;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", breached ? "font-medium text-danger" : "text-ink-muted")}>
      {breached ? <AlertTriangle size={13} /> : <Clock size={13} />}
      {label.text}
    </span>
  );
}

export const HEALTH_META: Record<GoalHealth, { label: string; tone: BadgeTone; color: string }> = {
  ON_TRACK: { label: "On track", tone: "success", color: "var(--status-good)" },
  AT_RISK: { label: "At risk", tone: "warning", color: "var(--status-warning)" },
  OFF_TRACK: { label: "Off track", tone: "danger", color: "var(--status-critical)" },
  ACHIEVED: { label: "Achieved", tone: "success", color: "var(--status-good)" },
  MISSED: { label: "Missed", tone: "danger", color: "var(--status-critical)" },
  NOT_STARTED: { label: "Not started", tone: "neutral", color: "rgb(var(--ink-faint))" },
};

export function HealthBadge({ health }: { health: GoalHealth }) {
  const meta = HEALTH_META[health];
  return (
    <Badge tone={meta.tone}>
      <Dot />
      {meta.label}
    </Badge>
  );
}
