"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWRInfinite from "swr/infinite";
import { ScrollText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { api, errorMessage } from "@/lib/api";
import { fetcher, useOrg } from "@/lib/hooks";
import type { AuditLog } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, InlineAlert, Skeleton } from "@/components/ui/feedback";
import { fullDate, relativeTime } from "@/lib/utils";

function describe(log: AuditLog) {
  const m = (log.metadata ?? {}) as Record<string, any>;
  const map: Record<string, string> = {
    "organisation.created": "created the organisation",
    "organisation.updated": `updated settings (${Object.keys(m).join(", ")})`,
    "member.role_changed": `changed a member's role from ${m.from} to ${m.to}`,
    "member.removed": `removed a ${String(m.role ?? "member").toLowerCase()}`,
    "member.left": "left the organisation",
    "invitation.created": `invited ${m.email} as ${String(m.role).toLowerCase()}`,
    "invitation.revoked": `revoked the invitation for ${m.email}`,
    "invitation.resent": "resent an invitation",
    "invitation.accepted": `accepted an invitation${m.autoApproved ? " (auto-approved)" : " — awaiting approval"}`,
    "invitation.approved": `approved ${m.email} to join as ${String(m.role).toLowerCase()}`,
    "invitation.rejected": `rejected ${m.email}'s join request`,
    "invitation.declined": "declined an invitation",
    "team.created": `created team ${m.name}`,
    "team.deleted": `deleted team ${m.name}`,
    "team.member_added": "added someone to a team",
    "team.member_removed": "removed someone from a team",
    "board.deleted": `deleted board ${m.name}`,
    "ticket.deleted": `deleted ticket ${m.key}`,
    "expense.approved": `approved expense "${m.title}"`,
    "expense.rejected": `rejected expense "${m.title}"`,
    "expense.deleted": `deleted approved expense "${m.title}"`,
    "goal.deleted": `deleted goal "${m.title}"`,
  };
  return map[log.action] ?? log.action;
}

export default function SettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { org, isAdmin, isOwner, mutate: reloadOrg } = useOrg(orgId);
  const [form, setForm] = useState({ name: "", description: "", ticketPrefix: "", currency: "", requireJoinApproval: true });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");

  useEffect(() => {
    if (org) setForm({ name: org.name, description: org.description ?? "", ticketPrefix: org.ticketPrefix, currency: org.currency, requireJoinApproval: org.requireJoinApproval });
  }, [org]);

  const { data: logPages, size, setSize, isLoading: logsLoading } = useSWRInfinite<{ items: AuditLog[]; nextCursor: string | null }>(
    (i, prev) => (!isAdmin || (prev && !prev.nextCursor) ? null : `/organisations/${orgId}/audit-logs?limit=25${i ? `&cursor=${prev!.nextCursor}` : ""}`),
    fetcher
  );
  const logs = logPages?.flatMap((p) => p.items) ?? [];

  if (org && !isAdmin) {
    return (
      <Page className="max-w-3xl">
        <EmptyState icon={ShieldAlert} title="Only owners and admins can manage settings" />
      </Page>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/organisations/${orgId}`, { ...form, description: form.description || null });
      await Promise.all([reloadOrg(), mutate("/organisations")]);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page className="max-w-4xl">
      <PageHeader eyebrow={org?.name} title="Settings" description="Organisation profile, access policy and audit trail." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="General" />
          <form onSubmit={save} className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Organisation name" htmlFor="s-name">
              <Input id="s-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="URL slug" htmlFor="s-slug" hint="Slugs can't be changed.">
              <Input id="s-slug" value={org?.slug ?? ""} disabled />
            </Field>
            <Field label="Description" htmlFor="s-desc" className="sm:col-span-2">
              <Textarea id="s-desc" rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Ticket key prefix" htmlFor="s-prefix" hint={`Tickets look like ${form.ticketPrefix || "TKT"}-42`}>
              <Input id="s-prefix" required maxLength={6} value={form.ticketPrefix} onChange={(e) => setForm({ ...form, ticketPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
            </Field>
            <Field label="Currency" htmlFor="s-currency" hint="3-letter ISO code, used for new expenses">
              <Input id="s-currency" required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={form.requireJoinApproval} onChange={(e) => setForm({ ...form, requireJoinApproval: e.target.checked })} />
              <span>
                <span className="block text-[13px] font-medium text-ink">Require admin approval for new members</span>
                <span className="block text-xs text-ink-muted">
                  When on, people who accept an invitation wait for an owner or admin to approve them. Invitations sent by regular members always require approval.
                </span>
              </span>
            </label>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" loading={saving}>
                Save settings
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Audit log" description="Security-relevant changes: roles, membership, approvals and deletions." />
          {logsLoading ? (
            <div className="p-4">
              <Skeleton className="h-32" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState icon={ScrollText} title="No audit events yet" />
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((log) => (
                <li key={log.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Avatar name={log.actor?.name ?? "System"} src={log.actor?.avatarUrl} size={24} />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="text-ink-muted">
                      <span className="font-medium text-ink">{log.actor?.name ?? "System"}</span> {describe(log)}
                    </p>
                    <p className="font-mono text-2xs text-ink-faint">
                      {log.action}
                      {log.ip ? ` · ${log.ip}` : ""}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-2xs text-ink-faint" title={fullDate(log.createdAt)}>
                    {relativeTime(log.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {logPages?.[logPages.length - 1]?.nextCursor && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setSize(size + 1)}>
                Load older events
              </Button>
            </div>
          )}
        </Card>

        {isOwner && (
          <Card className="border-danger/30">
            <CardHeader title={<span className="text-danger">Danger zone</span>} />
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[13px] text-ink-muted">
                <p className="font-medium text-ink">Delete this organisation</p>
                <p className="text-xs">Permanently deletes tickets, projects, expenses, goals and memberships. This cannot be undone.</p>
              </div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete organisation
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => (setDeleteOpen(o), setConfirmSlug(""))}
        title={`Delete ${org?.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmSlug !== org?.slug}
              onClick={async () => {
                try {
                  await api.delete(`/organisations/${orgId}`, { confirmSlug });
                  await mutate("/organisations");
                  toast.success("Organisation deleted");
                  router.push("/orgs");
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <InlineAlert tone="danger" className="mb-4">
          Every member loses access immediately.
        </InlineAlert>
        <Field label={`Type ${org?.slug} to confirm`} htmlFor="confirm-slug">
          <Input id="confirm-slug" autoComplete="off" value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} />
        </Field>
      </Dialog>
    </Page>
  );
}
