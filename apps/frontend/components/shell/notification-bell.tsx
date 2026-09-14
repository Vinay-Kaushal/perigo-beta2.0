"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { useApi, useDebouncedRevalidate } from "@/lib/hooks";
import { useChannelEvents } from "@/lib/realtime";
import type { Notification } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, relativeTime } from "@/lib/utils";

export function NotificationList({ items, onOpen }: { items: Notification[]; onOpen: (n: Notification) => void }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => (
        <li key={n.id}>
          <button onClick={() => onOpen(n)} className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover", !n.readAt && "bg-accent-soft/40")}>
            <Avatar name={n.actor?.name ?? "perigo"} src={n.actor?.avatarUrl} size={28} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px] leading-snug", n.readAt ? "text-ink-muted" : "font-medium text-ink")}>{n.title}</p>
              {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>}
              <p className="mt-1 text-2xs text-ink-faint">
                {n.organisation?.name ? `${n.organisation.name} · ` : ""}
                {relativeTime(n.createdAt)}
              </p>
            </div>
            {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NotificationBell() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: count } = useApi<{ count: number }>("/me/notifications/unread-count");
  const { data: list } = useApi<{ items: Notification[] }>("/me/notifications?limit=8");

  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/me/"));
  const refreshSoon = useDebouncedRevalidate(["/me/"]);

  useChannelEvents(
    null,
    (event) => {
      if (event.type === "NOTIFICATION_CREATED") {
        refreshSoon();
        const n = event.data as Notification;
        toast(n.title, {
          description: n.body ?? undefined,
          action: n.link ? { label: "View", onClick: () => router.push(n.link!) } : undefined,
        });
      } else if (event.type === "NOTIFICATIONS_READ") {
        refreshSoon();
      }
    },
    { personal: true }
  );

  async function open(n: Notification) {
    if (!n.readAt) await api.post(`/me/notifications/${n.id}/read`).catch(() => {});
    refresh();
    if (n.link) router.push(n.link);
  }

  const unread = count?.count ?? 0;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 ring-2 ring-surface items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface shadow-pop data-[state=open]:animate-scale-in">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={() => api.post("/me/notifications/read-all").then(refresh)}>
                <CheckCheck size={14} /> Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {list?.items.length ? (
              <NotificationList items={list.items} onOpen={open} />
            ) : (
              <p className="px-4 py-10 text-center text-[13px] text-ink-faint">You&apos;re all caught up.</p>
            )}
          </div>
          <Popover.Close asChild>
            <Link href="/notifications" className="block border-t border-border px-4 py-2.5 text-center text-[13px] font-medium text-accent-ink hover:bg-surface-hover">
              View all notifications
            </Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
