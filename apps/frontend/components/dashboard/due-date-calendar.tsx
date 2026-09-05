"use client";

import { useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarTask } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const PRIORITY_TONE: Record<string, "urgent" | "high" | "medium" | "low"> = {
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export function DueDateCalendar({
  month,
  onMonthChange,
  tasks,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  tasks: CalendarTask[];
}) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const tasksByDay = new Map<string, CalendarTask[]>();
  for (const t of tasks) {
    const key = t.dueDate.slice(0, 10);
    (tasksByDay.get(key) ?? tasksByDay.set(key, []).get(key)!).push(t);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => onMonthChange(subMonths(month, 1))} className="rounded p-1 hover:bg-surface">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-ink">{format(month, "MMMM yyyy")}</span>
        <button onClick={() => onMonthChange(addMonths(month, 1))} className="rounded p-1 hover:bg-surface">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayTasks = tasksByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-[64px] rounded border p-1 text-left ${
                isSameMonth(day, month) ? "border-border" : "border-transparent opacity-40"
              } ${isToday(day) ? "bg-accent/5 border-accent" : ""}`}
            >
              <span className="text-[11px] text-ink-faint">{format(day, "d")}</span>
              <div className="mt-0.5 space-y-0.5">
                {dayTasks.slice(0, 2).map((t) => (
                  <div key={t.id} className="truncate text-[10px] text-ink" title={t.title}>
                    {t.title}
                  </div>
                ))}
                {dayTasks.length > 2 && (
                  <span className="text-[10px] text-ink-faint">+{dayTasks.length - 2} more</span>
                )}
                {dayTasks[0] && (
                  <Badge tone={PRIORITY_TONE[dayTasks[0].priority]} className="scale-90">
                    {dayTasks.length}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
