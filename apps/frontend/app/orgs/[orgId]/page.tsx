"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, Download, LifeBuoy, ShieldCheck, Target, UserX, Wallet } from "lucide-react";
import { toast } from "sonner";
import { downloadFile, errorMessage } from "@/lib/api";
import { useApi, useOrg } from "@/lib/hooks";
import type { ActivityItem, OrgOverview, Priority, TicketStats } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { StatTile } from "@/components/charts/stat-tile";
import { TrendChart } from "@/components/charts/trend-chart";
import { BarList } from "@/components/charts/bar-list";
import { ProgressMeter } from "@/components/charts/progress";
import { HEALTH_META, HealthBadge, PRIORITY_META, STATUS_META } from "@/components/tickets/badges";
import { money, number, relativeTime, titleCase } from "@/lib/utils";

const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

function activityText(a: ActivityItem) {
  const m = a.metadata ?? {};
  if (a.source === "ticket") {
    switch (a.type) {
      case "CREATED":
        return "raised";
      case "ASSIGNED":
        return `assigned to ${m.to?.name ?? "someone"}`;
      case "UNASSIGNED":
        return "unassigned";
      case "STATUS_CHANGED":
        return `moved to ${STATUS_META[m.to as keyof typeof STATUS_META]?.label ?? m.to}`;
      case "PRIORITY_CHANGED":
        return `set priority ${String(m.to).toLowerCase()} on`;
      default:
        return "updated";
    }
  }
  return { TASK_CREATED: "created task", TASK_STATUS_CHANGED: `moved to ${m.toName ?? "a new column"}`, TASK_ASSIGNED: `assigned ${m.name ?? "someone"} to`, COMMENT_ADDED: "commented on" }[a.type] ?? "updated";
}

export default function OrgOverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { org, isAdmin } = useOrg(orgId);
  const { data: overview } = useApi<OrgOverview>(`/organisations/${orgId}/analytics/overview`);
  const { data: stats } = useApi<TicketStats>(`/organisations/${orgId}/tickets/stats`);
  const { data: activity } = useApi<ActivityItem[]>(`/organisations/${orgId}/analytics/activity?limit=15`);

  async function exportReport() {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    try {
      await downloadFile(`/organisations/${orgId}/analytics/report.pdf?from=${from.toISOString()}&to=${to.toISOString()}`, `${org?.slug ?? "org"}-report-${format(to, "yyyy-MM-dd")}.pdf`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const loading = !overview || !stats;
  const base = `/orgs/${orgId}`;

  return (
    <Page wide>
      <PageHeader
        eyebrow="Overview"
        title={org?.name ?? "…"}
        description={org?.description || "Live health of your service desk, projects, goals and spend."}
        actions={
          isAdmin && (
            <Button variant="secondary" onClick={exportReport}>
              <Download size={14} /> 30-day report (PDF)
            </Button>
          )
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[106px]" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Open tickets" value={number(stats.open)} icon={LifeBuoy} href={`${base}/tickets`} hint={`${stats.total} all-time`} />
            <StatTile label="SLA breached" value={number(stats.breached)} icon={AlertTriangle} tone={stats.breached ? "danger" : "default"} href={`${base}/tickets?view=breached`} hint="Open past their due time" />
            <StatTile label="Unassigned" value={number(stats.unassigned)} icon={UserX} tone={stats.unassigned ? "warning" : "default"} href={`${base}/tickets?view=unassigned`} hint="Waiting for an owner" />
            <StatTile
              label="SLA compliance (30d)"
              value={stats.slaCompliance === null ? "—" : `${stats.slaCompliance}%`}
              icon={CheckCircle2}
              tone={stats.slaCompliance !== null && stats.slaCompliance < 80 ? "warning" : "success"}
              hint={stats.avgResolutionHours === null ? "No resolutions yet" : `Avg. resolution ${number(stats.avgResolutionHours, 1)}h`}
            />
          </div>

          {isAdmin && overview.finance && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Approved spend (month)" value={money(overview.finance.approvedThisMonth, overview.finance.currency)} icon={Wallet} href={`${base}/expenses`} />
              <StatTile
                label="Expenses to approve"
                value={number(overview.finance.pendingExpenses)}
                icon={Clock}
                tone={overview.finance.pendingExpenses ? "warning" : "default"}
                href={`${base}/expenses?tab=approvals`}
                hint={money(overview.finance.pendingAmount, overview.finance.currency)}
              />
              <StatTile label="Join requests" value={number(overview.finance.pendingJoinRequests)} icon={ShieldCheck} tone={overview.finance.pendingJoinRequests ? "warning" : "default"} href={`${base}/members?tab=requests`} hint="Accepted invites awaiting approval" />
              <StatTile label="Tasks overdue" value={number(overview.tasks.overdue)} icon={Target} tone={overview.tasks.overdue ? "warning" : "default"} href={`${base}/boards`} hint={`${overview.tasks.completed}/${overview.tasks.total} tasks done`} />
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Ticket flow" description="Tickets created vs resolved per day, last 14 days" />
              <div className="p-4">
                <TrendChart
                  ariaLabel="Tickets created and resolved per day over the last 14 days"
                  data={stats.trend}
                  series={[
                    { key: "created", label: "Created", color: "var(--series-1)" },
                    { key: "resolved", label: "Resolved", color: "var(--series-2)" },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Open by priority" />
              <div className="p-4">
                <BarList
                  ariaLabel="Open tickets by priority"
                  emptyLabel="No open tickets"
                  items={PRIORITIES.map((p) => ({ key: p, label: PRIORITY_META[p].label, value: stats.byPriority[p] ?? 0 }))}
                />
                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-3 text-xs font-medium text-ink-muted">By status</p>
                  <BarList
                    ariaLabel="All tickets by status"
                    items={(Object.keys(stats.byStatus) as Array<keyof typeof STATUS_META>)
                      .filter((s) => stats.byStatus[s] > 0)
                      .map((s) => ({ key: s, label: STATUS_META[s].label, value: stats.byStatus[s] }))}
                  />
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader title="Team workload" description="Open tickets and tasks per person" />
              <ul className="divide-y divide-border">
                {overview.workload.slice(0, 8).map((w) => (
                  <li key={w.user.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={w.user.name} src={w.user.avatarUrl} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{w.user.name}</p>
                      <p className="text-2xs text-ink-faint">{titleCase(w.role)}</p>
                    </div>
                    <span className="tabular text-right text-xs text-ink-muted">
                      <span className="font-semibold text-ink">{w.openTickets}</span> tickets · <span className="font-semibold text-ink">{w.openTasks}</span> tasks
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader
                title="Goals"
                description={`${overview.goals.total} active`}
                action={
                  <Link href={`${base}/goals`}>
                    <Button variant="ghost" size="sm">
                      View all
                    </Button>
                  </Link>
                }
              />
              {overview.goals.items.length === 0 ? (
                <EmptyState icon={Target} title="No active goals" description="Track budgets, metrics and resolution targets." />
              ) : (
                <ul className="divide-y divide-border">
                  {overview.goals.items.map((g) => (
                    <li key={g.id} className="px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{g.title}</span>
                        <HealthBadge health={g.progress.health} />
                      </div>
                      <ProgressMeter percent={g.progress.percent} expected={g.progress.expectedPercent} color={HEALTH_META[g.progress.health].color} />
                      <p className="mt-1 text-2xs text-ink-faint">{Math.round(g.progress.percent)}% of target</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Recent activity" />
              {!activity?.length ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                      <Avatar name={a.actor?.name ?? "System"} src={a.actor?.avatarUrl} size={22} />
                      <div className="min-w-0 text-[13px]">
                        <p className="text-ink-muted">
                          <span className="font-medium text-ink">{a.actor?.name ?? "System"}</span> {activityText(a)}{" "}
                          {a.source === "ticket" ? (
                            <Link href={`${base}/tickets/${a.subject.number}`} className="font-medium text-ink hover:text-accent-ink">
                              {a.subject.key}
                            </Link>
                          ) : (
                            <Link href={`/boards/${a.subject.board?.id}?task=${a.subject.id}`} className="font-medium text-ink hover:text-accent-ink">
                              {a.subject.title}
                            </Link>
                          )}
                        </p>
                        <p className="text-2xs text-ink-faint">
                          {a.source === "ticket" ? a.subject.title : a.subject.board?.name} · {relativeTime(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
