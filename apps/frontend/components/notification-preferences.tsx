"use client";

import { Bell, Mail } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { InlineAlert, Skeleton } from "@/components/ui/feedback";

export interface NotificationPreferences {
  emailVerified: boolean;
  categories: Array<{ category: string; label: string; description: string; inApp: boolean; email: boolean }>;
}

export function NotificationPreferencesCard() {
  const { data, mutate } = useApi<NotificationPreferences>("/me/notification-preferences");

  async function update(category: string, channel: "inApp" | "email", value: boolean) {
    if (!data) return;
    const optimistic = { ...data, categories: data.categories.map((c) => (c.category === category ? { ...c, [channel]: value } : c)) };
    try {
      await mutate(api.patch<NotificationPreferences>("/me/notification-preferences", { categories: [{ category, [channel]: value }] }), {
        optimisticData: optimistic,
        rollbackOnError: true,
        revalidate: false,
      });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your preference"));
    }
  }

  return (
    <Card id="notifications" className="scroll-mt-6">
      <CardHeader title="Notifications" description="Choose what reaches you in the app and by email. Emails are grouped into a single message when several things happen at once." />
      {!data ? (
        <div className="p-4">
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          {!data.emailVerified && (
            <div className="px-4 pt-4">
              <InlineAlert tone="warning">Emails are paused until you verify your email address.</InlineAlert>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <thead className="text-2xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="w-24 px-2 py-2.5 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Bell size={12} /> In-app
                    </span>
                  </th>
                  <th className="w-24 px-4 py-2.5 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Mail size={12} /> Email
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                {data.categories.map((c) => (
                  <tr key={c.category}>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-ink">{c.label}</p>
                      <p className="text-xs text-ink-muted">{c.description}</p>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <Switch checked={c.inApp} onCheckedChange={(v) => update(c.category, "inApp", v)} label={`${c.label} in-app notifications`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={c.email} onCheckedChange={(v) => update(c.category, "email", v)} label={`${c.label} emails`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
