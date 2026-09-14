"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { addDays, format } from "date-fns";
import { LineChart, MoreHorizontal, Plus, Target, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi, useOrg } from "@/lib/hooks";
import type { Goal, GoalHealth, GoalType, Member, Team } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { EmptyState, InlineAlert, Skeleton } from "@/components/ui/feedback";
import { ProgressMeter } from "@/components/charts/progress";
import { StatTile } from "@/components/charts/stat-tile";
import { HEALTH_META, HealthBadge } from "@/components/tickets/badges";
import { money, number, relativeTime, shortDate } from "@/lib/utils";

const TYPE_COPY: Record<GoalType, { label: string; help: string }> = {
  METRIC: { label: "Metric", help: "Any number you track manually with check-ins (customers onboarded, NPS, deals closed…)." },
  TICKETS_RESOLVED: { label: "Tickets resolved", help: "Counts resolved tickets automatically — for a team, or for the owner if no team is set." },
  BUDGET: { label: "Budget", help: "Stay under a spending limit. Tracks approved expenses automatically." },
};

function formatValue(goal: Goal, value: number, currency: string) {
  if (goal.type === "BUDGET") return money(value, currency);
  return `${number(value, 2)}${goal.unit ? ` ${goal.unit}` : goal.type === "TICKETS_RESOLVED" ? " tickets" : ""}`;
}

function GoalDialog({ orgId, isAdmin, open, onOpenChange, onSaved }: { orgId: string; isAdmin: boolean; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { data: members } = useApi<Member[]>(open ? `/organisations/${orgId}/members` : null);
  const { data: teams } = useApi<Team[]>(open ? `/organisations/${orgId}/teams` : null);
  const initial = () => ({ title: "", description: "", type: "METRIC" as GoalType, targetValue: "", unit: "", category: "", ownerId: "", teamId: "", periodStart: format(new Date(), "yyyy-MM-dd"), periodEnd: format(addDays(new Date(), 90), "yyyy-MM-dd") });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial());
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/organisations/${orgId}/goals`, {
        title: form.title,
        description: form.description || null,
        type: form.type,
        targetValue: Number(form.targetValue),
        unit: form.type === "METRIC" ? form.unit || null : null,
        category: form.type === "BUDGET" ? form.category || null : null,
        ownerId: form.ownerId || undefined,
        teamId: form.teamId || null,
        periodStart: new Date(`${form.periodStart}T00:00:00`).toISOString(),
        periodEnd: new Date(`${form.periodEnd}T23:59:59`).toISOString(),
      });
      toast.success("Goal created");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="New goal"
      description={TYPE_COPY[form.type].help}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="goal-form" loading={busy}>
            Create goal
          </Button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Goal" htmlFor="g-title" className="sm:col-span-2">
          <Input id="g-title" required autoFocus maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Resolve 200 tickets this quarter" />
        </Field>
        <Field label="Type" htmlFor="g-type">
          <Select id="g-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as GoalType })}>
            <option value="METRIC">Metric (manual check-ins)</option>
            <option value="TICKETS_RESOLVED">Tickets resolved (automatic)</option>
            {isAdmin && <option value="BUDGET">Budget (automatic)</option>}
          </Select>
        </Field>
        <Field label={form.type === "BUDGET" ? "Spending limit" : "Target"} htmlFor="g-target">
          <Input id="g-target" type="number" required min="0.01" step="0.01" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })} />
        </Field>
        {form.type === "METRIC" && (
          <Field label="Unit" htmlFor="g-unit" hint="Optional, e.g. customers, %, deals">
            <Input id="g-unit" maxLength={20} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
        )}
        {form.type === "BUDGET" && (
          <Field label="Expense category" htmlFor="g-cat" hint="Leave empty to track all categories">
            <Input id="g-cat" maxLength={60} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
        )}
        <Field label="Owner" htmlFor="g-owner">
          <Select id="g-owner" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
            <option value="">Me</option>
            {members?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="g-team">
          <Select id="g-team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
            <option value="">No team</option>
            {teams?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start" htmlFor="g-start">
          <Input id="g-start" type="date" required value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
        </Field>
        <Field label="End" htmlFor="g-end">
          <Input id="g-end" type="date" required min={form.periodStart} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
        </Field>
        <Field label="Why it matters" htmlFor="g-desc" className="sm:col-span-2">
          <Textarea id="g-desc" rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        {error && (
          <InlineAlert tone="danger" className="sm:col-span-2">
            {error}
          </InlineAlert>
        )}
      </form>
    </Dialog>
  );
}

function GoalDetail({ orgId, goalId, currency, onClose, onChanged }: { orgId: string; goalId: string | null; currency: string; onClose: () => void; onChanged: () => void }) {
  const { data: goal, mutate } = useApi<Goal>(goalId ? `/organisations/${orgId}/goals/${goalId}` : null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/organisations/${orgId}/goals/${goalId}/check-ins`, { value: Number(value), note: note || undefined });
      setValue("");
      setNote("");
      toast.success("Progress updated");
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!goalId} onOpenChange={(o) => !o && onClose()} size="lg" title={goal?.title ?? "Goal"} description={goal?.description ?? undefined}>
      {!goal ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <HealthBadge health={goal.progress.health} />
            <Badge>{TYPE_COPY[goal.type].label}</Badge>
            <span>
              {shortDate(goal.periodStart)} → {shortDate(goal.periodEnd)}
            </span>
            {goal.owner && (
              <span className="flex items-center gap-1">
                · <Avatar name={goal.owner.name} src={goal.owner.avatarUrl} size={16} /> {goal.owner.name}
              </span>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-end justify-between">
              <span className="text-2xl font-semibold text-ink">{formatValue(goal, goal.progress.current, currency)}</span>
              <span className="text-[13px] text-ink-muted">
                of {formatValue(goal, goal.progress.target, currency)} · {Math.round(goal.progress.percent)}%
              </span>
            </div>
            <ProgressMeter percent={goal.progress.percent} expected={goal.progress.expectedPercent} color={HEALTH_META[goal.progress.health].color} className="h-3" />
            <p className="mt-2 text-xs text-ink-faint">
              The tick marks where you&apos;d be with steady progress today ({Math.round(goal.progress.expectedPercent)}%).
              {goal.type === "BUDGET" && " For budgets, staying left of the tick is good."}
            </p>
          </div>

          {goal.type === "METRIC" && goal.canManage && (
            <form onSubmit={checkIn} className="grid gap-3 rounded-lg border border-border bg-surface-muted/50 p-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
              <Field label="New value" htmlFor="ci-value">
                <Input id="ci-value" type="number" step="0.01" min="0" required value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
              <Field label="Note" htmlFor="ci-note">
                <Input id="ci-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What moved the number?" />
              </Field>
              <Button type="submit" loading={busy}>
                <TrendingUp size={14} /> Check in
              </Button>
            </form>
          )}
          {goal.type !== "METRIC" && <InlineAlert>{TYPE_COPY[goal.type].help}</InlineAlert>}

          {goal.type === "METRIC" && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Check-ins</h3>
              {!goal.checkIns?.length ? (
                <p className="text-[13px] text-ink-faint">No check-ins yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {goal.checkIns.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <Avatar name={c.user.name} src={c.user.avatarUrl} size={22} />
                      <div className="min-w-0 flex-1 text-[13px]">
                        <span className="font-semibold text-ink">{formatValue(goal, c.value, currency)}</span>
                        {c.note && <span className="text-ink-muted"> — {c.note}</span>}
                      </div>
                      <span className="text-2xs text-ink-faint">{relativeTime(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function GoalsInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { org, isAdmin } = useOrg(orgId);
  const [filter, setFilter] = useState<"active" | "mine" | "all">("active");
  const key = `/organisations/${orgId}/goals${filter === "active" ? "?active=true" : filter === "mine" ? "?owner=me" : ""}`;
  const { data: goals, isLoading, mutate } = useApi<Goal[]>(key);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const openGoal = params.get("goal");
  const currency = org?.currency ?? "USD";

  const counts = (goals ?? []).reduce<Partial<Record<GoalHealth, number>>>((acc, g) => ({ ...acc, [g.progress.health]: (acc[g.progress.health] ?? 0) + 1 }), {});

  return (
    <Page wide>
      <PageHeader
        eyebrow={org?.name}
        title="Goals"
        description="Measurable targets for teams and individuals, tracked against the calendar."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New goal
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="On track" value={(counts.ON_TRACK ?? 0) + (counts.ACHIEVED ?? 0)} icon={Target} tone="success" hint={`${counts.ACHIEVED ?? 0} achieved`} />
        <StatTile label="At risk" value={counts.AT_RISK ?? 0} tone={counts.AT_RISK ? "warning" : "default"} icon={LineChart} />
        <StatTile label="Off track / missed" value={(counts.OFF_TRACK ?? 0) + (counts.MISSED ?? 0)} tone={counts.OFF_TRACK || counts.MISSED ? "danger" : "default"} icon={LineChart} />
        <StatTile label="Total shown" value={goals?.length ?? 0} icon={Target} />
      </div>

      <div className="mb-3 inline-flex rounded-md border border-border bg-surface p-0.5 shadow-card">
        {(["active", "mine", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded px-3 py-1 text-[13px] font-medium capitalize ${filter === f ? "bg-surface-muted text-ink" : "text-ink-muted hover:text-ink"}`}>
            {f === "mine" ? "Owned by me" : f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : !goals?.length ? (
        <Card>
          <EmptyState icon={Target} title="No goals here yet" description="Set a target — budgets and ticket goals track themselves; metrics update with check-ins." action={<Button onClick={() => setCreateOpen(true)}>Create a goal</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => (
            <Card key={g.id} className="flex flex-col p-4 transition-colors hover:border-border-strong">
              <div className="flex items-start justify-between gap-2">
                <button className="min-w-0 text-left" onClick={() => router.replace(`/orgs/${orgId}/goals?goal=${g.id}`)}>
                  <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint">{TYPE_COPY[g.type].label}{g.team ? ` · ${g.team.name}` : ""}</p>
                  <p className="mt-0.5 line-clamp-2 font-semibold text-ink hover:text-accent-ink">{g.title}</p>
                </button>
                <DropdownMenu>
                  <DropdownTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Goal actions">
                      <MoreHorizontal size={15} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent>
                    <DropdownItem onSelect={() => router.replace(`/orgs/${orgId}/goals?goal=${g.id}`)}>
                      <TrendingUp size={14} /> Open & check in
                    </DropdownItem>
                    <DropdownItem destructive onSelect={() => setDeleteTarget(g)}>
                      <Trash2 size={14} /> Delete
                    </DropdownItem>
                  </DropdownContent>
                </DropdownMenu>
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <span className="text-lg font-semibold text-ink">{formatValue(g, g.progress.current, currency)}</span>
                <span className="text-xs text-ink-faint">of {formatValue(g, g.progress.target, currency)}</span>
              </div>
              <ProgressMeter className="mt-2" percent={g.progress.percent} expected={g.progress.expectedPercent} color={HEALTH_META[g.progress.health].color} />
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                <HealthBadge health={g.progress.health} />
                <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                  {g.owner && <Avatar name={g.owner.name} src={g.owner.avatarUrl} size={18} />}
                  ends {shortDate(g.periodEnd)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <GoalDialog orgId={orgId} isAdmin={isAdmin} open={createOpen} onOpenChange={setCreateOpen} onSaved={() => mutate()} />
      <GoalDetail orgId={orgId} goalId={openGoal} currency={currency} onClose={() => router.replace(`/orgs/${orgId}/goals`)} onChanged={() => mutate()} />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        destructive
        title="Delete goal?"
        description={deleteTarget?.title}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/organisations/${orgId}/goals/${deleteTarget!.id}`);
            toast.success("Goal deleted");
            mutate();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Page>
  );
}

export default function GoalsPage() {
  return (
    <Suspense>
      <GoalsInner />
    </Suspense>
  );
}
