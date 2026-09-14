"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, MessageSquare } from "lucide-react";
import type { Task } from "@/lib/types";
import { AvatarStack } from "@/components/ui/avatar";
import { PriorityLabel } from "@/components/tickets/badges";
import { cn, shortDate } from "@/lib/utils";

/** Presentational card. Interactivity lives on the sortable wrapper, so there's one focusable control per card. */
export function TaskCardView({ task, dragging }: { task: Task; dragging?: boolean }) {
  const overdue = task.dueDate && !task.completedAt && new Date(task.dueDate) < new Date();
  return (
    <div
      className={cn(
        "space-y-2.5 rounded-md border border-border bg-surface p-3 text-left shadow-card transition-colors hover:border-border-strong",
        dragging && "rotate-1 shadow-pop"
      )}
    >
      <p className="text-[13px] font-medium leading-snug text-ink">{task.title}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-xs text-ink-faint">
          <PriorityLabel priority={task.priority} compact />
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && "font-medium text-danger")}>
              <CalendarClock size={12} /> {shortDate(task.dueDate)}
            </span>
          )}
          {(task._count?.comments ?? 0) > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare size={12} /> {task._count!.comments}
            </span>
          )}
        </div>
        {task.assignees.length > 0 && <AvatarStack users={task.assignees.map((a) => a.user)} size={20} />}
      </div>
    </div>
  );
}

export function SortableTaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: "task" } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={task.title}
      onClick={onOpen}
      // Space picks the card up (dnd-kit keyboard sensor); Enter opens it.
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
        else listeners?.onKeyDown?.(e);
      }}
      className={cn("touch-none rounded-md outline-offset-2", isDragging && "opacity-40")}
    >
      <TaskCardView task={task} />
    </div>
  );
}
