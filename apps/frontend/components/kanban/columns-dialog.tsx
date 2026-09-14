"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { TaskStatusCol, TaskStatusType } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

const TYPES: Array<{ value: TaskStatusType; label: string }> = [
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "COMPLETED", label: "Completed (stamps done date)" },
  { value: "APPROVED", label: "Approved (admins only)" },
  { value: "REJECTED", label: "Rejected (admins only)" },
];

/** Admin-only column editor. Every change is saved immediately and syncs live to everyone on the board. */
export function ColumnsDialog({
  boardId,
  columns,
  taskCounts,
  open,
  onOpenChange,
  onChanged,
}: {
  boardId: string;
  columns: TaskStatusCol[];
  taskCounts: Record<string, number>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<TaskStatusType>("TODO");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) setNames(Object.fromEntries(columns.map((c) => [c.id, c.name])));
  }, [open, columns]);

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      onChanged();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const column = columns[index]!;
    const target = index + direction;
    // Dropping above the item at `target` (moving up) or below it (moving down).
    const before = direction === -1 ? columns[target - 1] : columns[target];
    const after = direction === -1 ? columns[target] : columns[target + 1];
    run(`move-${column.id}`, () => api.patch(`/boards/${boardId}/statuses/${column.id}/reorder`, { beforeId: before?.id ?? null, afterId: after?.id ?? null }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Board columns" description="Changes save instantly and update live for everyone on this board.">
      <ul className="space-y-2">
        {columns.map((c, i) => {
          const count = taskCounts[c.id] ?? 0;
          return (
            <li key={c.id} className="grid grid-cols-[auto_1fr_190px_auto] items-center gap-2 rounded-md border border-border p-2">
              <div className="flex flex-col">
                <button className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label={`Move ${c.name} left`}>
                  <ArrowUp size={13} />
                </button>
                <button className="rounded p-0.5 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === columns.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label={`Move ${c.name} right`}>
                  <ArrowDown size={13} />
                </button>
              </div>
              <Input
                aria-label="Column name"
                maxLength={60}
                value={names[c.id] ?? c.name}
                onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))}
                onBlur={() => {
                  const name = (names[c.id] ?? "").trim();
                  if (name && name !== c.name) run(`rename-${c.id}`, () => api.patch(`/boards/${boardId}/statuses/${c.id}`, { name }), "Column renamed");
                  else setNames((n) => ({ ...n, [c.id]: c.name }));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <Select aria-label="Column type" value={c.type} onChange={(e) => run(`type-${c.id}`, () => api.patch(`/boards/${boardId}/statuses/${c.id}`, { type: e.target.value }))}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${c.name}`}
                title={count ? `Move its ${count} task${count === 1 ? "" : "s"} first` : columns.length <= 1 ? "A board needs at least one column" : "Delete column"}
                disabled={count > 0 || columns.length <= 1 || !!busy}
                onClick={() => run(`delete-${c.id}`, () => api.delete(`/boards/${boardId}/statuses/${c.id}`), `Deleted “${c.name}”`)}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-4 grid grid-cols-[1fr_190px_auto] gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          run("create", () => api.post(`/boards/${boardId}/statuses`, { name: newName.trim(), type: newType }), "Column added").then(() => setNewName(""));
        }}
      >
        <Input aria-label="New column name" placeholder="New column name" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Select aria-label="New column type" value={newType} onChange={(e) => setNewType(e.target.value as TaskStatusType)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={busy === "create"} disabled={!newName.trim()}>
          <Plus size={14} /> Add
        </Button>
      </form>
    </Dialog>
  );
}
