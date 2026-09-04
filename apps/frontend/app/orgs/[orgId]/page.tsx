"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Board, Organisation } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { Plus, Kanban } from "lucide-react";

export default function OrgBoardsPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [org, setOrg] = useState<Organisation | null>(null);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    try {
      const [orgRes, boardsRes] = await Promise.all([
        api.get<Organisation>(`/organisations/${orgId}`),
        api.get<Board[]>(`/organisations/${orgId}/boards`),
      ]);
      setOrg(orgRes);
      setBoards(boardsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load boards");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: org?.name ?? "…" }]} />

      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-medium text-ink">Boards</h1>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus size={15} /> New board
          </Button>
        </div>

        {error && <p className="mb-4 text-sm text-urgent">{error}</p>}

        {boards === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : boards.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Kanban className="text-ink-faint" size={28} />
            <p className="text-sm text-ink-muted">No boards yet in {org?.name}.</p>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus size={15} /> New board
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {boards.map((board) => (
              <Link key={board.id} href={`/boards/${board.id}`}>
                <Card className="flex h-full flex-col gap-1 p-4 transition-colors hover:border-border-hover">
                  <div className="flex items-center gap-2">
                    <Kanban size={16} className="text-accent" />
                    <span className="font-medium text-ink">{board.name}</span>
                  </div>
                  {board.description && (
                    <p className="line-clamp-2 text-sm text-ink-muted">{board.description}</p>
                  )}
                  {board._count && (
                    <span className="mt-auto pt-2 text-xs text-ink-faint">
                      {board._count.tasks} tasks · {board._count.members} members
                    </span>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateBoardDialog
        orgId={orgId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function CreateBoardDialog({
  orgId,
  open,
  onClose,
  onCreated,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/organisations/${orgId}/boards`, { name });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create board");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <h2 className="text-sm font-medium text-ink">New board</h2>
        <div className="space-y-1.5">
          <Label htmlFor="board-name">Name</Label>
          <Input id="board-name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <p className="text-xs text-ink-faint">
          Ships with four default columns — To Do, In Progress, In Review, Done.
        </p>
        {error && <p className="text-sm text-urgent">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
