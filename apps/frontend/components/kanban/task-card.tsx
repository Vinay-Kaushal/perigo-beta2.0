"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

const PRIORITY_TONE = {
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", statusId: task.statusId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        "cursor-grab space-y-2 rounded-md border border-border bg-surface-raised p-3 text-left shadow-sm active:cursor-grabbing",
        "hover:border-border-hover",
        isDragging && "opacity-40"
      )}
    >
      <p className="text-sm leading-snug text-ink">{task.title}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
          {(task._count?.comments ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-ink-faint">
              <MessageSquare size={11} /> {task._count!.comments}
            </span>
          )}
        </div>

        {task.assignees.length > 0 && (
          <div className="flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((a) => (
              <Avatar key={a.id} name={a.user.name} size={20} className="ring-2 ring-surface-raised" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
