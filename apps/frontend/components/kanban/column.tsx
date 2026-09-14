"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { Task, TaskStatusCol } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SortableTaskCard } from "./task-card";

const TYPE_DOT: Record<string, string> = {
  TODO: "bg-ink-faint",
  IN_PROGRESS: "bg-warning",
  IN_REVIEW: "bg-info",
  BLOCKED: "bg-danger",
  COMPLETED: "bg-success",
  APPROVED: "bg-success",
  REJECTED: "bg-danger",
};

export function Column({ status, tasks, onOpenTask, onQuickAdd }: { status: TaskStatusCol; tasks: Task[]; onOpenTask: (id: string) => void; onQuickAdd: (statusId: string, title: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status.id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  function submit() {
    if (title.trim()) onQuickAdd(status.id, title.trim());
    setTitle("");
    setAdding(false);
  }

  return (
    <section className={cn("flex max-h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-muted/60", isOver && "border-accent/40 bg-accent-soft/40")} aria-label={status.name}>
      <header className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", TYPE_DOT[status.type])} />
          <h3 className="text-[13px] font-semibold text-ink">{status.name}</h3>
          <span className="tabular text-xs text-ink-faint">{tasks.length}</span>
        </div>
        <button onClick={() => setAdding(true)} className="rounded p-1 text-ink-faint hover:bg-surface-hover hover:text-ink" aria-label={`Add task to ${status.name}`}>
          <Plus size={15} />
        </button>
      </header>
      <div ref={setNodeRef} className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {adding && (
          <Input
            autoFocus
            maxLength={200}
            placeholder="Task title — Enter to add"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") (setTitle(""), setAdding(false));
            }}
          />
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}
