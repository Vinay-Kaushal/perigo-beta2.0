"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Board, Priority, Task } from "@/lib/types";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/feedback";
import { PRIORITY_META } from "@/components/tickets/badges";
import { relativeTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { RichText } from "@/components/rich-text";
import { MentionTextarea, type MentionTextareaHandle } from "@/components/mention-textarea";

export function TaskDialog({ taskId, board, onClose, onChanged }: { taskId: string | null; board: Board; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { data: task, mutate } = useApi<Task>(taskId ? `/tasks/${taskId}` : null);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const composer = useRef<MentionTextareaHandle>(null);
  // Only people who can see this board are suggested (admins can see every board).
  const candidates = useMemo(() => (board.members ?? []).map((m) => ({ id: m.userId, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl })), [board.members]);

  useEffect(() => {
    if (task) setDraft({ title: task.title, description: task.description ?? "" });
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const assignable = (board.members ?? []).filter((m) => !task?.assignees.some((a) => a.userId === m.userId));
  const isAdmin = board.myRole === "OWNER" || board.myRole === "ADMIN";

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()} size="lg" title={task ? <span className="text-ink-muted">{task.status?.name} · {board.name}</span> : "Task"}>
      {!task ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_200px]">
          <div className="min-w-0 space-y-4">
            <Input
              aria-label="Title"
              value={draft.title}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={() => draft.title.trim() && draft.title !== task.title && run(() => api.patch(`/tasks/${task.id}`, { title: draft.title }))}
              className="border-transparent px-1 text-base font-semibold shadow-none hover:border-border"
            />
            <Textarea
              aria-label="Description"
              rows={5}
              maxLength={10000}
              placeholder="Add a description…"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onBlur={() => draft.description !== (task.description ?? "") && run(() => api.patch(`/tasks/${task.id}`, { description: draft.description || null }))}
            />

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Comments</h3>
              <ul className="space-y-3">
                {task.comments?.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar name={c.user.name} src={c.user.avatarUrl} size={24} />
                    <div className="min-w-0 flex-1 rounded-md border border-border bg-surface-muted/50 px-3 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-ink">{c.user.name}</span>
                        <span className="flex items-center gap-1 text-ink-faint">
                          {relativeTime(c.createdAt)}
                          {(c.userId === user?.id || isAdmin) && (
                            <button aria-label="Delete comment" className="rounded p-0.5 hover:text-danger" onClick={() => run(() => api.delete(`/tasks/${task.id}/comments/${c.id}`))}>
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                      <RichText text={c.content} currentUserId={user?.id} className="mt-1 text-[13px] text-ink" />
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const content = composer.current?.serialize() ?? comment;
                  if (!content.trim()) return;
                  run(() => api.post(`/tasks/${task.id}/comments`, { content })).then(() => setComment(""));
                }}
              >
                <div className="flex-1">
                  <MentionTextarea
                    ref={composer}
                    rows={1}
                    className="min-h-[36px]"
                    value={comment}
                    maxLength={5000}
                    onValueChange={setComment}
                    candidates={candidates}
                    placeholder="Write a comment… Type @ to mention"
                    aria-label="Comment"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                      }
                    }}
                  />
                </div>
                <Button type="submit" disabled={!comment.trim()}>
                  Send
                </Button>
              </form>
            </div>

            {task.activities && task.activities.length > 0 && (
              <details className="text-xs text-ink-faint">
                <summary className="cursor-pointer">History ({task.activities.length})</summary>
                <ul className="mt-2 space-y-1">
                  {task.activities.map((a) => (
                    <li key={a.id}>
                      {a.user?.name ?? "Someone"} · {a.type.replace(/_/g, " ").toLowerCase()} · {relativeTime(a.createdAt)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="space-y-4">
            <Field label="Priority" htmlFor="task-priority">
              <Select id="task-priority" value={task.priority} onChange={(e) => run(() => api.patch(`/tasks/${task.id}`, { priority: e.target.value as Priority }))}>
                {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="task-due">
              <Input
                id="task-due"
                type="date"
                value={task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : ""}
                onChange={(e) => run(() => api.patch(`/tasks/${task.id}`, { dueDate: e.target.value ? new Date(`${e.target.value}T17:00:00`).toISOString() : null }))}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium text-ink">Assignees</span>
              <ul className="space-y-1.5">
                {task.assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[13px] text-ink">
                    <Avatar name={a.user.name} src={a.user.avatarUrl} size={20} />
                    <span className="flex-1 truncate">{a.user.name}</span>
                    <button aria-label={`Unassign ${a.user.name}`} className="rounded p-0.5 text-ink-faint hover:text-danger" onClick={() => run(() => api.delete(`/tasks/${task.id}/assignees/${a.userId}`))}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              {assignable.length > 0 && (
                <DropdownMenu>
                  <DropdownTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2">
                      <UserPlus size={13} /> Add assignee
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent align="start">
                    {assignable.map((m) => (
                      <DropdownItem key={m.userId} onSelect={() => run(() => api.post(`/tasks/${task.id}/assignees`, { userId: m.userId }))}>
                        <Avatar name={m.user.name} size={18} /> {m.user.name}
                      </DropdownItem>
                    ))}
                  </DropdownContent>
                </DropdownMenu>
              )}
            </div>
            <Button variant="danger-ghost" size="sm" className="-ml-2" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Delete task
            </Button>
          </aside>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Delete this task?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/tasks/${taskId}`);
            onChanged();
            onClose();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Dialog>
  );
}
