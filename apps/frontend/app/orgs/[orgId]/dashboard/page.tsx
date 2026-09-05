"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import { api, ApiError, getToken } from "@/lib/api";
import type { Organisation, AnalyticsOverview, ActivityItem, CalendarTask } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { OrgTabs } from "@/components/org-tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { DueDateCalendar } from "@/components/dashboard/due-date-calendar";
import { Download, FolderKanban, Users, CheckCircle2, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "#F2545B",
  HIGH: "#FB923C",
  MEDIUM: "#FBBF24",
  LOW: "#94A3B8",
};

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

export default function DashboardPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [org, setOrg] = useState<Organisation | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [month, setMonth] = useState(new Date());
  const [calendarTasks, setCalendarTasks] = useState<CalendarTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(() => format(new Date(new Date().setDate(1)), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.get<Organisation>(`/organisations/${orgId}`).then(setOrg).catch(() => {});
  }, [orgId]);

  useEffect(() => {
    Promise.all([
      api.get<AnalyticsOverview>(`/organisations/${orgId}/analytics/overview`),
      api.get<ActivityItem[]>(`/organisations/${orgId}/analytics/activity?limit=30`),
    ])
      .then(([o, a]) => {
        setOverview(o);
        setActivity(a);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load dashboard"));
  }, [orgId]);

  useEffect(() => {
    const monthKey = format(month, "yyyy-MM");
    api
      .get<CalendarTask[]>(`/organisations/${orgId}/analytics/calendar?month=${monthKey}`)
      .then(setCalendarTasks)
      .catch(() => {});
  }, [orgId, month]);

  async function downloadReport() {
    setDownloading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(
        `${API_URL}/organisations/${orgId}/analytics/report.pdf?from=${from}&to=${to}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) throw new Error("Failed to generate report");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${org?.slug ?? "report"}-${from}_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download report");
    } finally {
      setDownloading(false);
    }
  }

  const maxStatusCount = Math.max(1, ...(overview?.tasksByStatus.map((s) => s.count) ?? [0]));

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: org?.name ?? "…", href: `/orgs/${orgId}` }, { label: "Dashboard" }]} />
      <OrgTabs orgId={orgId} />

      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        {error && <p className="text-sm text-urgent">{error}</p>}

        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={FolderKanban} label="Boards" value={overview.totalBoards} />
            <StatCard icon={Users} label="Members" value={overview.totalMembers} />
            <StatCard icon={CheckCircle2} label="Completed" value={overview.completedCount} />
            <StatCard icon={AlertTriangle} label="Overdue" value={overview.overdueCount} />
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {overview && overview.tasksByStatus.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium text-ink">Tasks by status</h2>
              <div className="space-y-2.5">
                {overview.tasksByStatus.map((s) => (
                  <div key={s.statusId}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-ink-muted">{s.name}</span>
                      <span className="text-ink-faint">{s.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface">
                      <div
                        className="h-1.5 rounded-full bg-accent"
                        style={{ width: `${(s.count / maxStatusCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {overview && overview.tasksByPriority.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-medium text-ink">Tasks by priority</h2>
              <div className="flex h-32 items-end gap-3">
                {overview.tasksByPriority.map((p) => {
                  const maxP = Math.max(1, ...overview.tasksByPriority.map((x) => x.count));
                  return (
                    <div key={p.priority} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${(p.count / maxP) * 100}%`,
                          backgroundColor: PRIORITY_COLORS[p.priority],
                          minHeight: 4,
                        }}
                      />
                      <span className="text-[10px] text-ink-faint">{p.priority}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {overview && overview.memberWorkload.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-ink">Member workload</h2>
            <div className="space-y-2">
              {overview.memberWorkload.map((m) => (
                <div key={m.userId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} size={22} />
                    <span className="text-sm text-ink">{m.name}</span>
                  </div>
                  <span className="text-xs text-ink-faint">
                    {m.assigned} assigned · {m.completed} completed
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-ink">Due dates</h2>
          <DueDateCalendar month={month} onMonthChange={setMonth} tasks={calendarTasks} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-ink">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-faint">No activity yet.</p>
          ) : (
            <div className="space-y-2.5">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-sm">
                  <Avatar name={a.user?.name ?? "?"} size={20} />
                  <div>
                    <span className="text-ink">
                      {a.user?.name ?? "Someone"} {describeActivity(a.type)}{" "}
                      <span className="font-medium">{a.task.title}</span>
                    </span>
                    <p className="text-xs text-ink-faint">
                      {a.task.board.name} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-ink">Export report</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-ink-faint">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-faint">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button size="sm" onClick={downloadReport} disabled={downloading}>
              <Download size={14} /> {downloading ? "Generating…" : "Download PDF"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function describeActivity(type: string) {
  const map: Record<string, string> = {
    TASK_CREATED: "created",
    TASK_UPDATED: "updated",
    TASK_STATUS_CHANGED: "moved",
    TASK_ASSIGNED: "assigned someone to",
    TASK_UNASSIGNED: "unassigned someone from",
    COMMENT_ADDED: "commented on",
  };
  return map[type] ?? "acted on";
}
