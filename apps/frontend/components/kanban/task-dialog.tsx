"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { api, ApiError } from "@/lib/api";
import type { Task, TaskPriority, Comment } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function TaskDialog({
  taskId,
  onClose,
  onUpdated,
}: {
  taskId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    api
      .get<Task>(`/tasks/${taskId}`)
      .then(setTask)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load task"));
  }, [taskId]);

  async function saveField(patch: Partial<Pick<Task, "title" | "description" | "priority">>) {
    if (!task) return;
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, patch);
      setTask((prev) => (prev ? { ...prev, ...updated } : prev));
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !comment.trim()) return;
    setPostingComment(true);
    try {
      const created = await api.post<Comment>(`/tasks/${task.id}/comments`, { content: comment });
      setTask((prev) => (prev ? { ...prev, comments: [...(prev.comments ?? []), created] } : prev));
      setComment("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <Dialog open={!!taskId} onClose={onClose} className="max-w-2xl">
      {!task ? (
        <div className="p-8 text-sm text-ink-muted">Loading…</div>
      ) : (
        <div className="max-h-[80vh] overflow-y-auto p-5">
          <Input
            defaultValue={task.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && saveField({ title: e.target.value })}
            className="mb-4 h-auto border-none bg-transparent px-0 text-lg font-medium focus-visible:border-none"
          />

          <div className="mb-5 flex items-center gap-4">
            <div>
              <Label className="mb-1 block">Priority</Label>
              <div className="flex gap-1">
                {PRIORITIES.map((p) => (
                  <button key={p} onClick={() => saveField({ priority: p })}>
                    <Badge
                      tone={p.toLowerCase() as any}
                      className={p === task.priority ? "ring-1 ring-accent" : "opacity-50"}
                    >
                      {p}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            {task.assignees.length > 0 && (
              <div>
                <Label className="mb-1 block">Assignees</Label>
                <div className="flex -space-x-1.5">
                  {task.assignees.map((a) => (
                    <Avatar key={a.id} name={a.user.name} size={22} className="ring-2 ring-surface-raised" />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mb-5">
            <Label className="mb-1 block">Description</Label>
            <Textarea
              rows={4}
              defaultValue={task.description ?? ""}
              placeholder="Add a description…"
              onBlur={(e) => {
                if (e.target.value !== (task.description ?? "")) {
                  saveField({ description: e.target.value || null });
                }
              }}
            />
          </div>

          {error && <p className="mb-3 text-sm text-urgent">{error}</p>}

          <div>
            <Label className="mb-2 block">Comments</Label>
            <div className="space-y-3">
              {task.comments?.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <Avatar name={c.user.name} size={22} />
                  <div className="min-w-0 flex-1 rounded-md bg-surface p-2.5">
                    <div className="mb-0.5 flex items-baseline gap-2">
                      <span className="text-xs font-medium text-ink">{c.user.name}</span>
                      <span className="text-[11px] text-ink-faint">
                        {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-ink-muted">{c.content}</p>
                  </div>
                </div>
              ))}
              {(!task.comments || task.comments.length === 0) && (
                <p className="text-sm text-ink-faint">No comments yet.</p>
              )}
            </div>

            <form onSubmit={submitComment} className="mt-3 flex gap-2">
              <Textarea
                rows={2}
                placeholder="Write a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComment(e as unknown as React.FormEvent);
                  }
                }}
              />
              <Button type="submit" size="sm" disabled={postingComment || !comment.trim()}>
                Send
              </Button>
            </form>
          </div>
        </div>
      )}
    </Dialog>
  );
}
