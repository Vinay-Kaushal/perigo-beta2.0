"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarClock, Clock, Inbox, LifeBuoy, ShieldCheck, Target } from "lucide-react";
import { useSWRConfig } from "swr";
import { useAuth } from "@/lib/auth-context";
import { useApi } from "@/lib/hooks";
import { useChannelEvents } from "@/lib/realtime";
import type { MyDashboard } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatTile } from "@/components/charts/stat-tile";
import { ProgressMeter } from "@/components/charts/progress";
import { HEALTH_META, HealthBadge, PriorityLabel, SlaLabel, StatusBadge } from "@/components/tickets/badges";
import { money, number, shortDate, titleCase } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: reload } = useApi<MyDashboard>("/me/dashboard");

  // Anything assigned to me or needing my approval arrives as a notification — refresh the summary.
  useChannelEvents(null, (e) => e.type === "NOTIFICATION_CREATED" && mutate("/me/dashboard"), { personal: true });

  const approvals = (data?.approvals.joinRequests ?? 0) + (data?.approvals.expenses ?? 0);

  return (
    <Page>
      <PageHeader title={`${greeting()}${user ? `, ${user.name.split(" ")[0]}` : ""}`} description="Here's what needs your attention across your organisations." />

      {error && <ErrorState message="Couldn't load your dashboard." onRetry={() => reload()} />}

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[106px]" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {data.pendingJoinRequests.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] text-ink">
              <Clock size={16} className="shrink-0 text-warning" />
              Waiting for approval to join {data.pendingJoinRequests.map((r) => r.organisation.name).join(", ")}.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Assigned to me" value={number(data.tickets.assignedOpen)} icon={LifeBuoy} hint={`${data.tickets.requestedOpen} open that I requested`} />
            <StatTile
              label="SLA breached"
              value={number(data.tickets.breached)}
              icon={AlertTriangle}
              tone={data.tickets.breached ? "danger" : "default"}
              hint={`${data.tickets.dueSoon} due in the next 24h`}
            />
            <StatTile label="Tasks overdue" value={number(data.tasks.overdue)} icon={CalendarClock} tone={data.tasks.overdue ? "warning" : "default"} hint={`${data.tasks.dueThisWeek} due this week · ${data.tasks.open} open`} />
            <StatTile label="Awaiting my approval" value={number(approvals)} icon={ShieldCheck} tone={approvals ? "warning" : "default"} hint={`${data.approvals.joinRequests} join · ${data.approvals.expenses} expense`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="My open tickets" description="Highest priority and nearest SLA first" />
              {data.myTickets.length === 0 ? (
                <EmptyState icon={LifeBuoy} title="No tickets assigned to you" description="When someone assigns you a ticket it shows up here — instantly." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.myTickets.map((t) => (
                    <li key={t.id}>
                      <Link href={`/orgs/${t.organisation.id}/tickets/${t.number}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                        <PriorityLabel priority={t.priority} compact />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">{t.title}</p>
                          <p className="text-xs text-ink-faint">
                            <span className="font-mono">{t.key}</span> · {t.organisation.name} · from {t.requester.name}
                          </p>
                        </div>
                        <div className="hidden sm:block">
                          <SlaLabel dueAt={t.dueAt} breached={t.slaBreached} />
                        </div>
                        <StatusBadge status={t.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Upcoming tasks" description="Overdue and due within 7 days" />
              {data.upcomingTasks.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing due soon" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.upcomingTasks.map((t) => (
                    <li key={t.id}>
                      <Link href={`/boards/${t.board.id}?task=${t.id}`} className="block px-4 py-3 hover:bg-surface-hover">
                        <p className="truncate text-[13px] font-medium text-ink">{t.title}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                          <span className={t.overdue ? "font-medium text-danger" : ""}>{t.overdue ? "Overdue · " : ""}{shortDate(t.dueDate)}</span>
                          <span className="truncate">{t.board.name}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="My goals" action={<span className="text-xs text-ink-faint">Goals you own</span>} />
              {data.goals.length === 0 ? (
                <EmptyState icon={Target} title="No active goals" description="Set measurable goals for yourself or your team from an organisation's Goals page." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.goals.map((g) => (
                    <li key={g.id} className="px-4 py-3">
                      <Link href={`/orgs/${g.organisationId}/goals?goal=${g.id}`} className="block">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="truncate text-[13px] font-medium text-ink">{g.title}</p>
                          <HealthBadge health={g.progress.health} />
                        </div>
                        <ProgressMeter percent={g.progress.percent} expected={g.progress.expectedPercent} color={HEALTH_META[g.progress.health].color} />
                        <p className="mt-1.5 text-xs text-ink-faint">
                          {g.type === "BUDGET"
                            ? `${money(g.progress.current)} of ${money(g.progress.target)} budget`
                            : `${number(g.progress.current, 2)} / ${number(g.progress.target, 2)}${g.unit ? ` ${g.unit}` : g.type === "TICKETS_RESOLVED" ? " tickets" : ""}`}{" "}
                          · {Math.round(g.progress.percent)}% · {g.organisation?.name}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Organisations"
                action={
                  <Link href="/orgs">
                    <Button variant="ghost" size="sm">
                      All <ArrowRight size={13} />
                    </Button>
                  </Link>
                }
              />
              {data.orgs.length === 0 ? (
                <EmptyState icon={Building2} title="No organisations yet" action={<Link href="/orgs?new=1"><Button size="sm">Create organisation</Button></Link>} />
              ) : (
                <ul className="divide-y divide-border">
                  {data.orgs.map((o) => (
                    <li key={o.id}>
                      <Link href={`/orgs/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-bold text-accent-ink">{o.name.charAt(0).toUpperCase()}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">{o.name}</p>
                          <p className="text-xs text-ink-faint">
                            {o.openTickets} open tickets · {o.membersCount} members
                          </p>
                        </div>
                        {o.pendingApprovals > 0 ? <Badge tone="warning">{o.pendingApprovals} to review</Badge> : <Badge>{titleCase(o.myRole)}</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <Inbox size={13} /> {data.unreadNotifications} unread notifications
                </span>
                <span>My approved spend this month: {money(data.myExpensesThisMonth)}</span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
