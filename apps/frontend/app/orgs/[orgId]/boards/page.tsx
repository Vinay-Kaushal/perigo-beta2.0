"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Kanban, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useApi, useOrg } from "@/lib/hooks";
import type { Board, Team } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, InlineAlert, Skeleton } from "@/components/ui/feedback";
import { relativeTime } from "@/lib/utils";

export default function BoardsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { org, isAdmin } = useOrg(orgId);
  const { data: boards, isLoading } = useApi<Board[]>(`/organisations/${orgId}/boards`);
  const { data: teams } = useApi<Team[]>(`/organisations/${orgId}/teams`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", teamId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const board = await api.post<Board>(`/organisations/${orgId}/boards`, { name: form.name, description: form.description || undefined, teamId: form.teamId || undefined });
      router.push(`/boards/${board.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        eyebrow={org?.name}
        title="Projects"
        description={isAdmin ? "Kanban boards for planned work. Admins see every board." : "Kanban boards you've been added to."}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> New board
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !boards?.length ? (
        <Card>
          <EmptyState icon={Kanban} title="No boards yet" description="Create a board to plan work in columns — changes sync live for everyone on it." action={<Button onClick={() => setOpen(true)}>Create board</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Link key={b.id} href={`/boards/${b.id}`} className="group">
              <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
                    <Kanban size={17} />
                  </span>
                  {b.team && <Badge>{b.team.name}</Badge>}
                </div>
                <p className="mt-3 font-semibold text-ink group-hover:text-accent-ink">{b.name}</p>
                <p className="line-clamp-2 flex-1 text-[13px] text-ink-muted">{b.description || "No description"}</p>
                <p className="mt-3 border-t border-border pt-3 text-xs text-ink-faint">
                  {b._count?.tasks ?? 0} tasks · {b._count?.members ?? 0} members{b.updatedAt ? ` · updated ${relativeTime(b.updatedAt)}` : ""}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New board"
        description="Starts with To Do, In Progress, In Review and Done columns."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="board-form" loading={busy} disabled={!form.name.trim()}>
              Create board
            </Button>
          </>
        }
      >
        <form id="board-form" onSubmit={create} className="space-y-4">
          <Field label="Name" htmlFor="b-name">
            <Input id="b-name" autoFocus required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="b-desc">
            <Textarea id="b-desc" rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Team" htmlFor="b-team">
            <Select id="b-team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
              <option value="">No team</option>
              {teams?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </form>
      </Dialog>
    </Page>
  );
}
