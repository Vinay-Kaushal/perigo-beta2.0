"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWRInfinite from "swr/infinite";
import { CheckCheck, Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { fetcher } from "@/lib/hooks";
import { useChannelEvents } from "@/lib/realtime";
import type { Notification } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { NotificationList } from "@/components/shell/notification-bell";
import { cn } from "@/lib/utils";

type PageData = { items: Notification[]; unreadCount: number; nextCursor: string | null };

export default function NotificationsPage() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, size, setSize, mutate, isLoading } = useSWRInfinite<PageData>(
    (index, prev) => {
      if (prev && !prev.nextCursor) return null;
      const cursor = index === 0 ? "" : `&cursor=${prev!.nextCursor}`;
      return `/me/notifications?limit=30${unreadOnly ? "&unread=true" : ""}${cursor}`;
    },
    fetcher
  );

  useChannelEvents(null, (e) => (e.type === "NOTIFICATION_CREATED" || e.type === "NOTIFICATIONS_READ") && mutate(), { personal: true });

  const items = data?.flatMap((p) => p.items) ?? [];
  const unread = data?.[0]?.unreadCount ?? 0;
  const hasMore = !!data?.[data.length - 1]?.nextCursor;

  async function open(n: Notification) {
    if (!n.readAt) await api.post(`/me/notifications/${n.id}/read`).catch(() => {});
    mutate();
    if (n.link) router.push(n.link);
  }

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Inbox"
        description={unread ? `${unread} unread` : "You're all caught up"}
        actions={
          <Button variant="secondary" size="sm" disabled={!unread} onClick={() => api.post("/me/notifications/read-all").then(() => mutate())}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        }
      />
      <div className="mb-3 inline-flex rounded-md border border-border bg-surface p-0.5 shadow-card">
        {[
          { label: "All", value: false },
          { label: "Unread", value: true },
        ].map((opt) => (
          <button
            key={opt.label}
            onClick={() => setUnreadOnly(opt.value)}
            className={cn("rounded px-3 py-1 text-[13px] font-medium", unreadOnly === opt.value ? "bg-surface-muted text-ink" : "text-ink-muted hover:text-ink")}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title={unreadOnly ? "No unread notifications" : "No notifications yet"} description="Assignments, approvals and replies land here in realtime." />
        ) : (
          <NotificationList items={items} onOpen={open} />
        )}
      </Card>
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => setSize(size + 1)}>
            Load more
          </Button>
        </div>
      )}
    </Page>
  );
}
