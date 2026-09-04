"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { Task, TaskStatusCol } from "@/lib/types";
import { TaskCard } from "./task-card";
import { Input } from "@/components/ui/input";

export function Column({
  status,
  tasks,
  onOpenTask,
  onQuickAdd,
}: {
  status: TaskStatusCol;
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onQuickAdd: (statusId: string, title: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: `column:${status.id}`, data: { type: "column", statusId: status.id } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  function submit() {
    const trimmed = title.trim();
    if (trimmed) onQuickAdd(status.id, trimmed);
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-surface">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{status.name}</span>
          <span className="text-xs text-ink-faint">{tasks.length}</span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
          aria-label={`Add task to ${status.name}`}
        >
          <Plus size={14} />
        </button>
      </div>

      <div ref={setNodeRef} className="flex min-h-[4px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />
          ))}
        </SortableContext>

        {adding && (
          <Input
            autoFocus
            placeholder="Task title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
