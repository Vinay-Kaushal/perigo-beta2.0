"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api, ApiError } from "@/lib/api";
import type { Board, Task } from "@/lib/types";
import { useBoardSocket, type ServerMessage } from "@/hooks/use-board-socket";
import { TopBar } from "@/components/top-bar";
import { Column } from "@/components/kanban/column";
import { TaskCard } from "@/components/kanban/task-card";
import { TaskDialog } from "@/components/kanban/task-dialog";
import { PresenceBar, type PresenceUser } from "@/components/kanban/presence-bar";

type ColumnMap = Record<string, Task[]>;

function groupByStatus(tasks: Task[]): ColumnMap {
  const map: ColumnMap = {};
  for (const t of tasks) {
    (map[t.statusId] ??= []).push(t);
  }
  for (const list of Object.values(map)) list.sort((a, b) => a.position - b.position);
  return map;
}

export default function BoardPage() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;

  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [cursors, setCursors] = useState<Record<string, { name: string; color: string; x: number; y: number }>>({});
  const lastCursorSent = useRef(0);

  const { connected, subscribe, send } = useBoardSocket(boardId ?? null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const refresh = useCallback(async () => {
    try {
      const [boardRes, tasksRes] = await Promise.all([
        api.get<Board>(`/boards/${boardId}`),
        api.get<Task[]>(`/boards/${boardId}/tasks`),
      ]);
      setBoard(boardRes);
      setColumns(groupByStatus(tasksRes));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load board");
    }
  }, [boardId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: board mutations from any client (including this one) arrive
  // here and get folded into local state, plus the presence roster.
  useEffect(() => {
    return subscribe((msg: ServerMessage) => {
      if (msg.type === "presence:sync") {
        setPresence(msg.users);
        return;
      }

      if (msg.type === "presence:cursor") {
        setCursors((prev) => ({
          ...prev,
          [msg.userId]: { name: msg.name, color: msg.color, x: msg.x, y: msg.y },
        }));
        return;
      }

      if (msg.type === "presence:left") {
        setCursors((prev) => {
          const next = { ...prev };
          delete next[msg.userId];
          return next;
        });
        return;
      }

      if (msg.type === "board:event") {
        const { type } = msg.payload;
        switch (type) {
          case "TASK_CREATED":
          case "TASK_UPDATED":
          case "TASK_MOVED":
          case "TASK_DELETED":
          case "TASK_ASSIGNEE_CHANGED":
          case "COMMENT_ADDED":
          case "COMMENT_UPDATED":
          case "COMMENT_DELETED":
          case "STATUS_CREATED":
          case "STATUS_UPDATED":
          case "STATUS_REORDERED":
          case "STATUS_DELETED":
          case "BOARD_UPDATED":
          case "MEMBER_ADDED":
          case "MEMBER_REMOVED":
            // Simplest-correct option: refetch on any board mutation rather
            // than hand-patching local state per event type. Fine at this
            // scale; see README for the finer-grained (no full refetch)
            // version once a board has enough traffic for that to matter.
            refresh();
            break;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, refresh]);

  function findContainer(taskId: string) {
    return Object.keys(columns).find((statusId) => columns[statusId]?.some((t) => t.id === taskId));
  }

  function onDragStart(event: DragStartEvent) {
    const task = Object.values(columns)
      .flat()
      .find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  // Live-reflow as the card crosses into another column, so the drop target
  // is visually correct before the drop even happens (standard dnd-kit
  // multi-container pattern).
  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const fromStatus = findContainer(activeId);
    const toStatus = overId.startsWith("column:")
      ? overId.slice("column:".length)
      : findContainer(overId);

    if (!fromStatus || !toStatus || fromStatus === toStatus) return;

    setColumns((prev) => {
      const fromList = prev[fromStatus] ?? [];
      const toList = prev[toStatus] ?? [];
      const activeIndex = fromList.findIndex((t) => t.id === activeId);
      if (activeIndex === -1) return prev;

      const [moved] = fromList.slice(activeIndex, activeIndex + 1);
      const overIndex = toList.findIndex((t) => t.id === overId);
      const insertAt = overIndex === -1 ? toList.length : overIndex;

      return {
        ...prev,
        [fromStatus]: fromList.filter((t) => t.id !== activeId),
        [toStatus]: [
          ...toList.slice(0, insertAt),
          { ...moved, statusId: toStatus },
          ...toList.slice(insertAt),
        ],
      };
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const statusId = overId.startsWith("column:") ? overId.slice("column:".length) : findContainer(overId);
    if (!statusId) return;

    setColumns((prev) => {
      const list = prev[statusId] ?? [];
      const oldIndex = list.findIndex((t) => t.id === activeId);
      const overIndex = list.findIndex((t) => t.id === overId);
      if (oldIndex === -1) return prev;

      const newIndex = overIndex === -1 ? list.length - 1 : overIndex;
      const reordered = [...list];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const beforeTaskId = reordered[newIndex - 1]?.id ?? null;
      const afterTaskId = reordered[newIndex + 1]?.id ?? null;

      api
        .patch(`/tasks/${activeId}/move`, { statusId, beforeTaskId, afterTaskId })
        .catch((err) => {
          // server rejected it (permission denied, stale neighbour, etc.) —
          // resync the board to truth and let the person know why it snapped back
          setError(err instanceof ApiError ? err.message : "Failed to move task");
          refresh();
        });

      return { ...prev, [statusId]: reordered };
    });
  }

  async function onQuickAdd(statusId: string, title: string) {
    try {
      await api.post(`/boards/${boardId}/tasks`, { statusId, title });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
    }
  }

  function onBoardMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const now = Date.now();
    if (now - lastCursorSent.current < 50) return; // throttle to ~20/sec
    lastCursorSent.current = now;
    const rect = e.currentTarget.getBoundingClientRect();
    send({
      type: "presence:cursor",
      boardId,
      x: e.clientX - rect.left + e.currentTarget.scrollLeft,
      y: e.clientY - rect.top,
    });
  }

  const sortedStatuses = useMemo(
    () => [...(board?.taskStatuses ?? [])].sort((a, b) => a.position - b.position),
    [board]
  );

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        crumbs={[
          { label: board?.name ?? "…" },
        ]}
      />
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-medium text-ink">{board?.name}</h1>
        <PresenceBar users={presence} connected={connected} />
      </div>

      {error && <p className="px-4 py-2 text-sm text-urgent">{error}</p>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="relative flex flex-1 gap-3 overflow-x-auto p-4" onMouseMove={onBoardMouseMove}>
          {sortedStatuses.map((status) => (
            <Column
              key={status.id}
              status={status}
              tasks={columns[status.id] ?? []}
              onOpenTask={setOpenTaskId}
              onQuickAdd={onQuickAdd}
            />
          ))}

          {Object.entries(cursors).map(([userId, c]) => (
            <div
              key={userId}
              className="pointer-events-none absolute z-40 flex items-center gap-1 transition-[left,top] duration-100"
              style={{ left: c.x, top: c.y }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill={c.color}>
                <path d="M1 1l6 13.5L9 9l5.5-2z" />
              </svg>
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: c.color }}
              >
                {c.name}
              </span>
            </div>
          ))}
        </div>

        <DragOverlay>{activeTask && <TaskCard task={activeTask} onOpen={() => {}} />}</DragOverlay>
      </DndContext>

      <TaskDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} onUpdated={refresh} />
    </div>
  );
}
