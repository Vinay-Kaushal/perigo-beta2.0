"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { MyDashboard } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Building2, ListTodo, AlertTriangle, CalendarClock, Plus } from "lucide-react";

const PRIORITY_TONE: Record<string, "urgent" | "high" | "medium" | "low"> = {
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function GlobalDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<MyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MyDashboard>("/me/dashboard")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load dashboard"));
  }, []);

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[]} />

      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-lg font-medium text-ink">Welcome back{user ? `, ${user.name}` : ""}</h1>
          <p className="text-sm text-ink-faint">Here&apos;s what&apos;s happening across all your organisations.</p>
        </div>

        {error && <p className="text-sm text-urgent">{error}</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={Building2} label="Organisations" value={data.orgs.length} />
              <StatCard icon={ListTodo} label="Your open tasks" value={data.myTasks.total} />
              <StatCard icon={AlertTriangle} label="Overdue" value={data.myTasks.overdueCount} />
              <StatCard icon={CalendarClock} label="Due this week" value={data.myTasks.dueThisWeekCount} />
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-ink">Your organisations</h2>
                  <Link href="/orgs">
                    <Button variant="ghost" size="sm">
                      <Plus size={14} /> New / browse
                    </Button>
                  </Link>
                </div>
                {data.orgs.length === 0 ? (
                  <p className="text-sm text-ink-faint">
                    You&apos;re not part of an organisation yet. <Link href="/orgs" className="text-accent">Create one</Link>.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.orgs.map((org) => (
                      <Link key={org.id} href={`/orgs/${org.id}/dashboard`}>
                        <div className="flex items-center justify-between rounded-md p-2 hover:bg-surface">
                          <div>
                            <p className="text-sm text-ink">{org.name}</p>
                            <p className="text-xs text-ink-faint">
                              {org.boardsCount} boards · {org.membersCount} members
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {org.overdueCount > 0 && <Badge tone="urgent">{org.overdueCount} overdue</Badge>}
                            <Badge tone="low">{org.myRole}</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 text-sm font-medium text-ink">Due this week</h2>
                {data.upcomingTasks.length === 0 ? (
                  <p className="text-sm text-ink-faint">Nothing due in the next 7 days.</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.upcomingTasks.map((t) => (
                      <div key={t.id} className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{t.title}</p>
                          <p className="text-xs text-ink-faint">
                            {t.orgName} / {t.boardName} · {format(new Date(t.dueDate), "MMM d")}
                          </p>
                        </div>
                        <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium text-ink">
                Expenses this month <span className="text-ink-faint">(orgs you own or admin)</span>
              </h2>
              <p className="text-2xl font-medium text-ink">{money(data.expensesThisMonth)}</p>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium text-ink">Recent activity</h2>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-ink-faint">No recent activity.</p>
              ) : (
                <div className="space-y-2.5">
                  {data.recentActivity.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-sm">
                      <Avatar name={a.user?.name ?? "?"} size={20} />
                      <div>
                        <span className="text-ink">
                          {a.user?.name ?? "Someone"} on <span className="font-medium">{a.task.title}</span>
                        </span>
                        <p className="text-xs text-ink-faint">
                          {a.task.orgName} / {a.task.board.name} ·{" "}
                          {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="rounded-md bg-surface p-2 text-accent">
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xl font-medium text-ink">{value}</p>
        <p className="text-xs text-ink-faint">{label}</p>
      </div>
    </Card>
  );
}
