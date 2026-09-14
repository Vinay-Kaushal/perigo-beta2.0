"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Member, Priority, Team, Ticket, TicketType } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/feedback";
import { PRIORITY_META, TYPE_META } from "./badges";
import { useAuth } from "@/lib/auth-context";

const SLA_COPY: Record<Priority, string> = { URGENT: "4 hours", HIGH: "1 day", MEDIUM: "3 days", LOW: "5 days" };

export function CreateTicketDialog({ orgId, open, onOpenChange }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data: members } = useApi<Member[]>(open ? `/organisations/${orgId}/members` : null);
  const { data: teams } = useApi<Team[]>(open ? `/organisations/${orgId}/teams` : null);
  const [form, setForm] = useState({ title: "", description: "", type: "INCIDENT" as TicketType, priority: "MEDIUM" as Priority, category: "", assigneeId: "", teamId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.post<Ticket>(`/organisations/${orgId}/tickets`, {
        title: form.title,
        description: form.description || undefined,
        type: form.type,
        priority: form.priority,
        category: form.category || undefined,
        assigneeId: form.assigneeId || undefined,
        teamId: form.teamId || undefined,
      });
      toast.success(`${ticket.key} created`, { description: ticket.assignee ? `Assigned to ${ticket.assignee.name}` : undefined });
      setForm({ title: "", description: "", type: "INCIDENT", priority: "MEDIUM", category: "", assigneeId: "", teamId: "" });
      onOpenChange(false);
      router.push(`/orgs/${orgId}/tickets/${ticket.number}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Raise a ticket"
      description="Describe the issue or request. The assignee is notified instantly."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-ticket" loading={busy} disabled={form.title.trim().length < 3}>
            Create ticket
          </Button>
        </>
      }
    >
      <form id="create-ticket" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="t-title" className="sm:col-span-2">
          <Input id="t-title" autoFocus required minLength={3} maxLength={200} placeholder="e.g. VPN disconnects every 10 minutes" value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="t-desc" className="sm:col-span-2">
          <Textarea id="t-desc" rows={5} maxLength={20000} placeholder="What happened, who's affected, steps to reproduce…" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="t-type">
          <Select id="t-type" value={form.type} onChange={(e) => set("type", e.target.value as TicketType)}>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="t-priority" hint={`Resolution SLA: ${SLA_COPY[form.priority]}`}>
          <Select id="t-priority" value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assignee" htmlFor="t-assignee">
          <Select id="t-assignee" value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
            <option value="">Unassigned</option>
            {members?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
                {m.userId === user?.id ? " (me)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team queue" htmlFor="t-team">
          <Select id="t-team" value={form.teamId} onChange={(e) => set("teamId", e.target.value)}>
            <option value="">No team</option>
            {teams?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="t-cat" className="sm:col-span-2">
          <Input id="t-cat" maxLength={60} placeholder="e.g. Network, Hardware, Access" value={form.category} onChange={(e) => set("category", e.target.value)} />
        </Field>
        {error && (
          <InlineAlert tone="danger" className="sm:col-span-2">
            {error}
          </InlineAlert>
        )}
      </form>
    </Dialog>
  );
}
