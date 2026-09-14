"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCorners, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ArrowLeft, Columns3, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useChannelEvents, useFrames, useRealtime } from "@/lib/realtime";
import type { Board, Member, Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { Column } from "@/components/kanban/column";
import { TaskCardView } from "@/components/kanban/task-card";
import { TaskDialog } from "@/components/kanban/task-dialog";
import { ColumnsDialog } from "@/components/kanban/columns-dialog";

type ColumnMap = Record<string, Task[]>;
type Presence = { userId: string; name: string; color: string };

function group(tasks: Task[]): ColumnMap {
  const map: ColumnMap = {};
  for (const t of tasks) (map[t.statusId] ??= []).push(t);
  for (const list of Object.values(map)) list.sort((a, b) => a.position - b.position);
  return map;
}

function BoardInner() {
  const { boardId } = useParams<{ boardId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const channel = `board:${boardId}`;
  const { data: board, error, mutate: reloadBoard } = useApi<Board>(`/boards/${boardId}`);
  const { data: tasks, mutate: reloadTasks } = useApi<Task[]>(`/boards/${boardId}/tasks`);
  const isAdmin = board?.myRole === "OWNER" || board?.myRole === "ADMIN";
  const { data: orgMembers } = useApi<Member[]>(board && isAdmin ? `/organisations/${board.organisationId}/members` : null);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [active, setActive] = useState<Task | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [cursors, setCursors] = useState<Record<string, Presence & { x: number; y: number }>>({});
  const { send } = useRealtime();
  const lastCursor = useRef(0);
  const dragging = useRef(false);
  const openTask = params.get("task");

  // Server truth replaces local state — except mid-drag, so a remote update doesn't yank the card.
  useEffect(() => {
    if (tasks && !dragging.current) setColumns(group(tasks));
  }, [tasks]);

  const refresh = useCallback(() => Promise.all([reloadBoard(), reloadTasks()]), [reloadBoard, reloadTasks]);

  useChannelEvents(channel, (e) => {
    if (e.type === "BOARD_DELETED") {
      toast.error("This board was deleted");
      return router.push("/orgs");
    }
    if (e.type.startsWith("STATUS_") || e.type.startsWith("MEMBER_") || e.type === "BOARD_UPDATED") reloadBoard();
    reloadTasks();
  });

  useFrames((f) => {
    if (!("channel" in f) || f.channel !== channel) return;
    if (f.type === "presence:sync") setPresence(f.users);
    if (f.type === "presence:cursor") setCursors((c) => ({ ...c, [f.userId]: { userId: f.userId, name: f.name, color: f.color, x: f.x, y: f.y } }));
    if (f.type === "presence:left") setCursors(({ [f.userId]: _gone, ...rest }) => rest);
    if (f.type === "subscribe_denied") toast.error("Live updates unavailable for this board");
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }));
  const statuses = useMemo(() => [...(board?.taskStatuses ?? [])].sort((a, b) => a.position - b.position), [board]);
  const findColumn = (id: string) => (id.startsWith("column:") ? id.slice(7) : Object.keys(columns).find((s) => columns[s]?.some((t) => t.id === id)));

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    setActive(Object.values(columns).flat().find((t) => t.id === e.active.id) ?? null);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const moving = prev[from]?.find((t) => t.id === active.id);
      if (!moving) return prev;
      const target = prev[to] ?? [];
      const overIndex = target.findIndex((t) => t.id === over.id);
      const at = overIndex === -1 ? target.length : overIndex;
      return { ...prev, [from]: prev[from]!.filter((t) => t.id !== active.id), [to]: [...target.slice(0, at), { ...moving, statusId: to }, ...target.slice(at)] };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActive(null);
    dragging.current = false;
    if (!over) return void reloadTasks();
    const statusId = findColumn(String(over.id));
    if (!statusId) return;
    const list = [...(columns[statusId] ?? [])];
    const from = list.findIndex((t) => t.id === active.id);
    if (from === -1) return;
    const overIndex = list.findIndex((t) => t.id === over.id);
    const to = overIndex === -1 ? list.length - 1 : overIndex;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved!);
    setColumns((prev) => ({ ...prev, [statusId]: list }));
    api
      .patch(`/tasks/${active.id}/move`, { statusId, beforeTaskId: list[to - 1]?.id ?? null, afterTaskId: list[to + 1]?.id ?? null })
      .then(() => reloadTasks())
      .catch((err) => {
        toast.error(errorMessage(err, "Couldn't move the task"));
        reloadTasks();
      });
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const now = Date.now();
    if (now - lastCursor.current < 60) return;
    lastCursor.current = now;
    const rect = e.currentTarget.getBoundingClientRect();
    send({ type: "presence:cursor", channel, x: e.clientX - rect.left + e.currentTarget.scrollLeft, y: e.clientY - rect.top + e.currentTarget.scrollTop });
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={errorMessage(error, "Couldn't load this board")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="min-w-0">
          {board && (
            <Link href={`/orgs/${board.organisationId}/boards`} className="mb-0.5 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
              <ArrowLeft size={12} /> Projects
            </Link>
          )}
          <h1 className="truncate text-lg font-semibold text-ink">{board?.name ?? <Skeleton className="h-6 w-48" />}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1.5" aria-label="People viewing this board">
            {presence.map((p) => (
              <Tooltip key={p.userId} content={`${p.name} is viewing`}>
                <span>
                  <Avatar name={p.name} size={26} ring={p.color} className="ring-2 ring-surface" />
                </span>
              </Tooltip>
            ))}
          </div>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setColumnsOpen(true)}>
              <Columns3 size={14} /> Columns
            </Button>
          )}
          {isAdmin && orgMembers && (
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button variant="secondary" size="sm">
                  <UserPlus size={14} /> Members
                </Button>
              </DropdownTrigger>
              <DropdownContent className="max-h-80 overflow-y-auto">
                <DropdownLabel>Board access</DropdownLabel>
                {orgMembers.map((m) => {
                  const onBoard = board?.members?.some((bm) => bm.userId === m.userId);
                  return (
                    <DropdownItem
                      key={m.userId}
                      onSelect={(e) => {
                        e.preventDefault();
                        (onBoard ? api.delete(`/boards/${boardId}/members/${m.userId}`) : api.post(`/boards/${boardId}/members`, { userId: m.userId }))
                          .then(() => reloadBoard())
                          .catch((err) => toast.error(errorMessage(err)));
                      }}
                    >
                      <input type="checkbox" readOnly checked={!!onBoard} className="pointer-events-none" aria-hidden />
                      <span className="flex-1">{m.user.name}</span>
                      <span className="text-2xs text-ink-faint">{m.role === "MEMBER" ? "" : "sees all"}</span>
                    </DropdownItem>
                  );
                })}
              </DropdownContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {!board || !tasks ? (
        <div className="flex gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => ((dragging.current = false), setActive(null), reloadTasks())}>
          <div className="relative flex min-h-0 flex-1 gap-3 overflow-auto p-4 sm:p-6" onMouseMove={onMouseMove}>
            {statuses.map((s) => (
              <Column
                key={s.id}
                status={s}
                tasks={columns[s.id] ?? []}
                onOpenTask={(id) => router.replace(`/boards/${boardId}?task=${id}`)}
                onQuickAdd={(statusId, title) =>
                  api
                    .post(`/boards/${boardId}/tasks`, { statusId, title })
                    .then(() => reloadTasks())
                    .catch((err) => toast.error(errorMessage(err)))
                }
              />
            ))}
            {Object.values(cursors).map((c) => (
              <div key={c.userId} className="pointer-events-none absolute z-40 flex items-start gap-1 transition-[left,top] duration-75" style={{ left: c.x, top: c.y }} aria-hidden>
                <svg width="14" height="14" viewBox="0 0 16 16" fill={c.color}>
                  <path d="M1 1l6 13.5L9 9l5.5-2z" />
                </svg>
                <span className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: c.color }}>
                  {c.name}
                </span>
              </div>
            ))}
          </div>
          <DragOverlay>{active && <TaskCardView task={active} dragging />}</DragOverlay>
        </DndContext>
      )}

      {board && isAdmin && (
        <ColumnsDialog
          boardId={boardId}
          columns={statuses}
          taskCounts={Object.fromEntries(statuses.map((st) => [st.id, (tasks ?? []).filter((t) => t.statusId === st.id).length]))}
          open={columnsOpen}
          onOpenChange={setColumnsOpen}
          onChanged={refresh}
        />
      )}
      {board && <TaskDialog taskId={openTask} board={board} onClose={() => router.replace(`/boards/${boardId}`)} onChanged={refresh} />}
    </div>
  );
}

export default function BoardPage() {
  return (
    <Suspense>
      <BoardInner />
    </Suspense>
  );
}
