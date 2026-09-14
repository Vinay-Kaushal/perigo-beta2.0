"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, LifeBuoy, Plus, Search, UserX, User as UserIcon, Users, Inbox } from "lucide-react";
import { useApi, useOrg } from "@/lib/hooks";
import type { Paginated, Priority, Ticket, TicketStats } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PRIORITY_META, PriorityLabel, SlaLabel, StatusBadge, TYPE_META } from "@/components/tickets/badges";
import { CreateTicketDialog } from "@/components/tickets/create-ticket-dialog";
import { cn, relativeTime } from "@/lib/utils";

const VIEWS = [
  { id: "open", label: "All open", icon: Inbox, params: { status: "open" } },
  { id: "mine", label: "Assigned to me", icon: UserIcon, params: { status: "open", assignee: "me" } },
  { id: "unassigned", label: "Unassigned", icon: UserX, params: { status: "open", assignee: "unassigned" } },
  { id: "team", label: "My teams", icon: Users, params: { status: "open", team: "mine" } },
  { id: "requested", label: "Raised by me", icon: LifeBuoy, params: { requester: "me" } },
  { id: "breached", label: "SLA breached", icon: AlertTriangle, params: { breached: "true" } },
  { id: "done", label: "Resolved & closed", icon: Inbox, params: { status: "done" } },
] as const;

function TicketsInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { org } = useOrg(orgId);
  const [createOpen, setCreateOpen] = useState(false);

  const view = VIEWS.find((v) => v.id === params.get("view")) ?? VIEWS[0];
  const page = Number(params.get("page") ?? 1);
  const priority = params.get("priority") ?? "";
  const type = params.get("type") ?? "";
  const sort = params.get("sort") ?? "updatedAt";
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    if (params.get("new") === "1") {
      setCreateOpen(true);
      const next = new URLSearchParams(params);
      next.delete("new");
      router.replace(`${pathname}?${next}`);
    }
  }, [params, pathname, router]);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next}`);
  }

  // Debounced search into the URL, so views are shareable.
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get("q") ?? "") ? update({ q: q.trim() || null }) : undefined), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useMemo(() => {
    const s = new URLSearchParams({ ...view.params, page: String(page), pageSize: "25", sort, order: sort === "dueAt" ? "asc" : "desc" });
    if (priority) s.set("priority", priority);
    if (type) s.set("type", type);
    if (params.get("q")) s.set("q", params.get("q")!);
    return s.toString();
  }, [view, page, priority, type, sort, params]);

  const { data, error, isLoading, isValidating, mutate } = useApi<Paginated<Ticket>>(`/organisations/${orgId}/tickets?${query}`);
  const { data: stats } = useApi<TicketStats>(`/organisations/${orgId}/tickets/stats`);
  const counts: Record<string, number | undefined> = { open: stats?.open, mine: stats?.assignedToMe, unassigned: stats?.unassigned, breached: stats?.breached };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const done = (t: Ticket) => ["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status);

  return (
    <Page wide>
      <PageHeader
        eyebrow={org?.name}
        title="Service desk"
        description="Track incidents and requests from report to resolution."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New ticket
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Ticket views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => update({ view: v.id === "open" ? null : v.id })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
                view.id === v.id ? "bg-surface text-ink shadow-card ring-1 ring-border" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
              )}
            >
              <v.icon size={15} className={view.id === v.id ? "text-accent" : "text-ink-faint"} />
              <span className="flex-1 text-left">{v.label}</span>
              {counts[v.id] !== undefined && <span className={cn("tabular text-2xs", v.id === "breached" && counts[v.id] ? "font-semibold text-danger" : "text-ink-faint")}>{counts[v.id]}</span>}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search title or key (${org?.ticketPrefix ?? "TKT"}-12)`} className="pl-8" aria-label="Search tickets" />
            </div>
            <Select aria-label="Priority" value={priority} onChange={(e) => update({ priority: e.target.value || null })} className="w-auto">
              <option value="">Any priority</option>
              {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
            <Select aria-label="Type" value={type} onChange={(e) => update({ type: e.target.value || null })} className="w-auto">
              <option value="">Any type</option>
              {Object.entries(TYPE_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value === "updatedAt" ? null : e.target.value })} className="w-auto">
              <option value="updatedAt">Recently updated</option>
              <option value="createdAt">Newest</option>
              <option value="priority">Priority</option>
              <option value="dueAt">SLA due soonest</option>
            </Select>
          </div>

          {error && <ErrorState message="Couldn't load tickets." onRetry={() => mutate()} />}

          <Card className={cn("overflow-hidden transition-opacity", isValidating && data && "opacity-80")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed text-left">
                <colgroup>
                  <col />
                  <col className="w-[128px]" />
                  <col className="w-[104px]" />
                  <col className="w-[170px]" />
                  <col className="w-[128px]" />
                  <col className="w-[120px]" />
                </colgroup>
                <thead className="border-b border-border bg-surface-muted/60 text-2xs font-medium uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Ticket</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Assignee</th>
                    <th className="px-3 py-2.5 font-medium">SLA</th>
                    <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={6} className="px-4 py-3">
                          <Skeleton className="h-8" />
                        </td>
                      </tr>
                    ))}
                  {data?.items.map((t) => (
                    <tr key={t.id} className="group cursor-pointer hover:bg-surface-hover" onClick={() => router.push(`/orgs/${orgId}/tickets/${t.number}`)}>
                      <td className="px-4 py-2.5">
                        <Link href={`/orgs/${orgId}/tickets/${t.number}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
                          <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent-ink">{t.title}</span>
                          <span className="block truncate whitespace-nowrap text-xs text-ink-faint">
                            <span className="font-mono text-ink-muted">{t.key}</span> · {TYPE_META[t.type].label}
                            {t.team ? ` · ${t.team.name}` : ""} · {t.requester.name}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <PriorityLabel priority={t.priority} />
                      </td>
                      <td className="px-3 py-2.5">
                        {t.assignee ? (
                          <span className="flex items-center gap-2 text-[13px] text-ink">
                            <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size={22} />
                            <span className="max-w-[120px] truncate">{t.assignee.name}</span>
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-faint">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <SlaLabel dueAt={t.dueAt} breached={t.slaBreached} done={done(t)} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-ink-faint">{relativeTime(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && data.items.length === 0 && (
              <EmptyState
                icon={LifeBuoy}
                title="No tickets in this view"
                description={params.get("q") ? "Try a different search." : "Nice and quiet. Raise a ticket when something needs attention."}
                action={
                  <Button variant="secondary" onClick={() => setCreateOpen(true)}>
                    <Plus size={14} /> New ticket
                  </Button>
                }
              />
            )}
            {data && data.total > data.pageSize && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-ink-muted">
                <span>
                  {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}
                </span>
                <div className="flex gap-1">
                  <Button variant="secondary" size="icon" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} aria-label="Previous page">
                    <ChevronLeft size={15} />
                  </Button>
                  <Button variant="secondary" size="icon" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} aria-label="Next page">
                    <ChevronRight size={15} />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
      <CreateTicketDialog orgId={orgId} open={createOpen} onOpenChange={setCreateOpen} />
    </Page>
  );
}

export default function TicketsPage() {
  return (
    <Suspense>
      <TicketsInner />
    </Suspense>
  );
}
