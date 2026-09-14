"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Bell, BellOff, ChevronDown, Copy, MoreHorizontal, Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApi, useOrg } from "@/lib/hooks";
import { useChannelEvents } from "@/lib/realtime";
import type { Member, Priority, Team, TicketAttachment, TicketComment, TicketDetail, TicketEvent, TicketStatus, TicketType } from "@/lib/types";
import { fromTokens, type MentionCandidate } from "@/lib/mentions";
import { RichText } from "@/components/rich-text";
import { MentionTextarea, type MentionTextareaHandle } from "@/components/mention-textarea";
import { AttachmentChip, FileDropzone, PendingAttachmentChip, UploadProgress, useTicketUploads } from "@/components/tickets/attachments";
import { Page } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PRIORITY_META, PriorityLabel, SlaLabel, STATUS_META, StatusBadge, TYPE_META, TypeLabel } from "@/components/tickets/badges";
import { cn, fullDate, relativeTime, titleCase } from "@/lib/utils";

type TimelineItem = { kind: "comment"; at: string; comment: TicketComment } | { kind: "event"; at: string; event: TicketEvent };

function eventText(e: TicketEvent) {
  const m = e.metadata ?? {};
  switch (e.type) {
    case "CREATED":
      return "raised this ticket";
    case "ASSIGNED":
      return (
        <>
          assigned it to <strong className="font-medium text-ink">{m.to?.name}</strong>
          {m.from ? <> (was {m.from.name})</> : null}
        </>
      );
    case "UNASSIGNED":
      return <>removed the assignee{m.from ? <> ({m.from.name})</> : null}</>;
    case "STATUS_CHANGED":
      return (
        <>
          changed status from <strong className="font-medium text-ink">{STATUS_META[m.from as TicketStatus]?.label}</strong> to{" "}
          <strong className="font-medium text-ink">{STATUS_META[m.to as TicketStatus]?.label}</strong>
        </>
      );
    case "PRIORITY_CHANGED":
      return (
        <>
          changed priority from {PRIORITY_META[m.from as Priority]?.label} to <strong className="font-medium text-ink">{PRIORITY_META[m.to as Priority]?.label}</strong>
        </>
      );
    case "TEAM_CHANGED":
      return m.to ? (
        <>
          moved it to the <strong className="font-medium text-ink">{m.to.name}</strong> queue
        </>
      ) : (
        "removed the team"
      );
    case "ATTACHMENT_ADDED":
      return (
        <>
          attached <strong className="font-medium text-ink">{m.fileName}</strong>
        </>
      );
    case "ATTACHMENT_REMOVED":
      return <>removed the file {m.fileName}</>;
    case "UPDATED":
      return `updated ${(m.fields as string[] | undefined)?.map((f) => (f === "dueAt" ? "SLA due date" : f)).join(", ") ?? "details"}`;
    default:
      return titleCase(e.type);
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 py-1.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export default function TicketDetailPage() {
  const { orgId, number } = useParams<{ orgId: string; number: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const { org } = useOrg(orgId);
  const key = `/organisations/${orgId}/tickets/${number}`;
  const { data: t, error, mutate: reload } = useApi<TicketDetail>(key);
  const { data: members } = useApi<Member[]>(`/organisations/${orgId}/members`);
  const { data: teams } = useApi<Team[]>(`/organisations/${orgId}/teams`);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [composerFiles, setComposerFiles] = useState<TicketAttachment[]>([]);
  const [editMentions, setEditMentions] = useState<MentionCandidate[]>([]);
  const composer = useRef<MentionTextareaHandle>(null);
  const descriptionEditor = useRef<MentionTextareaHandle>(null);

  const candidates = useMemo<MentionCandidate[]>(
    () => (members ?? []).map((m) => ({ id: m.userId, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl })),
    [members]
  );
  const ticketUploads = useTicketUploads(orgId, Number(number), () => reload());
  const composerUploads = useTicketUploads(orgId, Number(number), (a) => setComposerFiles((f) => [...f, a]));

  // Tell me when someone else changes the ticket I'm looking at (the layout already refetches it).
  useChannelEvents(`org:${orgId}`, (e) => {
    if (e.data?.id !== t?.id || e.actorId === user?.id) return;
    if (e.type === "TICKET_DELETED") {
      toast.error("This ticket was deleted");
      router.push(`/orgs/${orgId}/tickets`);
    } else {
      const actor = members?.find((m) => m.userId === e.actorId)?.user.name ?? "Someone";
      toast.info(`${actor} updated ${t?.key}`, { id: `ticket-${t?.id}` });
    }
  });

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!t) return [];
    return [
      ...t.comments.map((c) => ({ kind: "comment" as const, at: c.createdAt, comment: c })),
      ...t.events.map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [t]);

  async function run(label: string, fn: () => Promise<unknown>, success?: string) {
    setPending(label);
    try {
      await fn();
      await reload();
      mutate((k) => typeof k === "string" && k.startsWith(`/organisations/${orgId}/tickets?`));
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  // Only replace the page when there's nothing to show; a failed background refresh keeps the last good data.
  if (error && !t) {
    return (
      <Page className="max-w-5xl">
        <ErrorState message={errorMessage(error, "Couldn't load this ticket")} onRetry={() => reload()} />
      </Page>
    );
  }
  if (!t) {
    return (
      <Page className="max-w-6xl">
        <Skeleton className="mb-4 h-8 w-2/3" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  const perms = t.permissions;
  const isDone = ["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status);
  const patch = (body: Record<string, unknown>, success?: string) => run("patch", () => api.patch(key, body), success);
  const assign = (assigneeId: string | null) =>
    run("assign", () => api.post(`${key}/assign`, { assigneeId }), assigneeId ? `Assigned to ${members?.find((m) => m.userId === assigneeId)?.user.name}` : "Unassigned");
  const setStatus = (status: TicketStatus) => {
    if (status === "RESOLVED") return setResolveOpen(true);
    run("status", () => api.post(`${key}/status`, { status }), `Moved to ${STATUS_META[status].label}`);
  };

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    const body = composer.current?.serialize() ?? comment;
    if (!body.trim() && !composerFiles.length) return;
    setPosting(true);
    try {
      await api.post(`${key}/comments`, { body, attachmentIds: composerFiles.map((f) => f.id) });
      setComment("");
      setComposerFiles([]);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Page wide>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={`/orgs/${orgId}/tickets`} className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft size={14} /> Service desk
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={pending === "watch"}
            onClick={() => run("watch", () => (t.isWatching ? api.delete(`${key}/watch`) : api.post(`${key}/watch`)), t.isWatching ? "Stopped watching" : "You'll be notified about updates")}
          >
            {t.isWatching ? <BellOff size={14} /> : <Bell size={14} />}
            {t.isWatching ? "Unwatch" : "Watch"}
          </Button>
          {perms.allowedStatuses.length > 0 && (
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button size="sm" loading={pending === "status"}>
                  Change status <ChevronDown size={14} />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                {perms.allowedStatuses.map((s) => (
                  <DropdownItem key={s} onSelect={() => setStatus(s)}>
                    <StatusBadge status={s} />
                  </DropdownItem>
                ))}
              </DropdownContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal size={16} />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copied"))}>
                <Copy size={14} /> Copy link
              </DropdownItem>
              {perms.canDelete && (
                <DropdownItem destructive onSelect={() => setDeleteOpen(true)}>
                  <Trash2 size={14} /> Delete ticket
                </DropdownItem>
              )}
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
              <span className="font-mono font-medium text-ink-muted">{t.key}</span>
              <StatusBadge status={t.status} />
              {t.slaBreached && <span className="font-medium text-danger">SLA breached</span>}
            </div>
            {editing ? (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const description = descriptionEditor.current?.serialize() ?? draft.description;
                  await patch({ title: draft.title, description: description || null }, "Ticket updated");
                  setEditing(false);
                }}
              >
                <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} minLength={3} maxLength={200} required className="text-base font-semibold" aria-label="Title" />
                <MentionTextarea
                  ref={descriptionEditor}
                  value={draft.description}
                  onValueChange={(description) => setDraft((d) => ({ ...d, description }))}
                  candidates={candidates}
                  initialMentions={editMentions}
                  rows={8}
                  maxLength={20000}
                  aria-label="Description"
                  placeholder="Describe the issue. Type @ to mention someone."
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" loading={pending === "patch"}>
                    Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="group">
                <div className="flex items-start gap-2">
                  <h1 className="flex-1 text-xl font-semibold tracking-tight text-ink">{t.title}</h1>
                  {perms.canEdit && !["CLOSED", "CANCELLED"].includes(t.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const { text, mentions } = fromTokens(t.description ?? "");
                        setEditMentions(mentions);
                        setDraft({ title: t.title, description: text });
                        setEditing(true);
                      }}
                    >
                      <Pencil size={13} /> Edit
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Raised by {t.requester.name} {relativeTime(t.createdAt)}
                  {t.createdBy.id !== t.requester.id && <> · logged by {t.createdBy.name}</>}
                </p>
              </div>
            )}
          </div>

          {!editing && (
            <Card className="p-4">
              {t.description ? (
                <RichText text={t.description} currentUserId={user?.id} className="text-sm leading-relaxed text-ink" />
              ) : (
                <p className="text-sm italic text-ink-faint">No description provided.</p>
              )}
            </Card>
          )}

          <section aria-label="Attachments" className="space-y-2">
            {(() => {
              const pendingIds = new Set(composerFiles.map((f) => f.id));
              const files = t.attachments.filter((a) => !a.commentId && !pendingIds.has(a.id));
              const open = !["CLOSED", "CANCELLED"].includes(t.status);
              return (
                <>
                  <h2 className="text-sm font-semibold text-ink">
                    Attachments {files.length > 0 && <span className="font-normal text-ink-faint">({files.length})</span>}
                  </h2>
                  {files.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {files.map((a) => (
                        <AttachmentChip
                          key={a.id}
                          orgId={orgId}
                          ticketRef={t.number}
                          attachment={a}
                          onDelete={a.uploader?.id === user?.id || perms.canDelete ? () => run("attachment-del", () => api.delete(`${key}/attachments/${a.id}`), "File removed") : undefined}
                        />
                      ))}
                    </div>
                  )}
                  <UploadProgress pending={ticketUploads.pending} />
                  {open ? (
                    <FileDropzone onFiles={ticketUploads.upload} disabled={ticketUploads.busy} />
                  ) : (
                    files.length === 0 && <p className="text-[13px] text-ink-faint">No files.</p>
                  )}
                </>
              );
            })()}
          </section>

          {t.resolutionNote && (
            <div className="rounded-lg border border-success/25 bg-success/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-success">Resolution</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{t.resolutionNote}</p>
            </div>
          )}

          <section aria-label="Activity">
            <h2 className="mb-3 text-sm font-semibold text-ink">Activity</h2>
            <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
              {timeline.map((item) =>
                item.kind === "event" ? (
                  <li key={item.event.id} className="relative flex items-center gap-3 pl-0.5 text-[13px] text-ink-muted">
                    <span className="z-[1] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-canvas">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
                    </span>
                    <span className="min-w-0">
                      <strong className="font-medium text-ink">{item.event.actor?.name ?? "System"}</strong> {eventText(item.event)}
                      <span className="ml-2 text-xs text-ink-faint" title={fullDate(item.at)}>
                        {relativeTime(item.at)}
                      </span>
                      {item.event.type === "STATUS_CHANGED" && item.event.metadata?.note && (
                        <span className="mt-1 block rounded border border-border bg-surface px-2 py-1 text-xs text-ink">{item.event.metadata.note}</span>
                      )}
                    </span>
                  </li>
                ) : (
                  <li key={item.comment.id} className="relative flex gap-3">
                    <Avatar name={item.comment.author.name} src={item.comment.author.avatarUrl} size={28} className="z-[1] ring-4 ring-canvas" />
                    <Card className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <span className="text-[13px]">
                          <strong className="font-medium text-ink">{item.comment.author.name}</strong>
                          {item.comment.author.id === t.requesterId && <span className="ml-2 text-2xs text-ink-faint">Requester</span>}
                          {item.comment.author.id === t.assigneeId && <span className="ml-2 text-2xs text-ink-faint">Assignee</span>}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-ink-faint" title={fullDate(item.at)}>
                          {relativeTime(item.at)}
                          {item.comment.updatedAt !== item.comment.createdAt && " · edited"}
                          {(item.comment.author.id === user?.id || perms.canDelete) && (
                            <button
                              className="ml-1 rounded p-1 hover:bg-surface-hover hover:text-danger"
                              aria-label="Delete comment"
                              onClick={() => run("comment-del", () => api.delete(`${key}/comments/${item.comment.id}`), "Comment deleted")}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                      {item.comment.body && <RichText text={item.comment.body} currentUserId={user?.id} className="px-3 py-2.5 text-sm leading-relaxed text-ink" />}
                      {item.comment.attachments.length > 0 && (
                        <div className="grid gap-2 border-t border-border p-2 sm:grid-cols-2">
                          {item.comment.attachments.map((a) => (
                            <AttachmentChip key={a.id} orgId={orgId} ticketRef={t.number} attachment={a} />
                          ))}
                        </div>
                      )}
                    </Card>
                  </li>
                )
              )}
            </ol>

            <form onSubmit={postComment} className="mt-5 flex gap-3">
              <Avatar name={user?.name ?? "?"} src={user?.avatarUrl} size={28} />
              <div className="flex-1 space-y-2">
                <MentionTextarea
                  ref={composer}
                  rows={3}
                  maxLength={10000}
                  placeholder="Add a comment… Type @ to mention someone (⌘/Ctrl + Enter to send)"
                  value={comment}
                  onValueChange={setComment}
                  candidates={candidates}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(e);
                  }}
                  aria-label="Comment"
                />
                {composerFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {composerFiles.map((f) => (
                      <PendingAttachmentChip
                        key={f.id}
                        attachment={f}
                        onRemove={() => {
                          setComposerFiles((list) => list.filter((x) => x.id !== f.id));
                          api.delete(`${key}/attachments/${f.id}`).catch(() => {});
                        }}
                      />
                    ))}
                  </div>
                )}
                <UploadProgress pending={composerUploads.pending} />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {!["CLOSED", "CANCELLED"].includes(t.status) && <FileDropzone compact onFiles={composerUploads.upload} disabled={composerUploads.busy} />}
                    <span className="text-xs text-ink-faint">Watchers are notified.</span>
                  </div>
                  <Button type="submit" size="sm" loading={posting} disabled={composerUploads.busy || (!comment.trim() && !composerFiles.length)}>
                    Comment
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Details</h2>
            <dl className="divide-y divide-border">
              <DetailRow label="Assignee">
                {perms.canAssign ? (
                  <div className="space-y-1.5">
                    <Select aria-label="Assignee" value={t.assigneeId ?? ""} disabled={pending === "assign"} onChange={(e) => assign(e.target.value || null)} className="h-8">
                      <option value="">Unassigned</option>
                      {members?.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.name}
                        </option>
                      ))}
                    </Select>
                    {t.assigneeId !== user?.id && (
                      <Button variant="link" size="sm" className="text-xs" onClick={() => assign(user!.id)}>
                        <UserPlus size={12} /> Assign to me
                      </Button>
                    )}
                  </div>
                ) : t.assignee ? (
                  <span className="flex items-center gap-2">
                    <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size={20} /> {t.assignee.name}
                  </span>
                ) : (
                  <span className="text-ink-faint">Unassigned</span>
                )}
              </DetailRow>
              <DetailRow label="Priority">
                {perms.canEdit && !isDone ? (
                  <Select aria-label="Priority" value={t.priority} className="h-8" onChange={(e) => patch({ priority: e.target.value }, "Priority updated")}>
                    {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <PriorityLabel priority={t.priority} />
                )}
              </DetailRow>
              <DetailRow label="Type">
                {perms.canEdit && !isDone ? (
                  <Select aria-label="Type" value={t.type} className="h-8" onChange={(e) => patch({ type: e.target.value as TicketType })}>
                    {Object.entries(TYPE_META).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TypeLabel type={t.type} />
                )}
              </DetailRow>
              <DetailRow label="Team">
                {perms.canEdit && !isDone ? (
                  <Select aria-label="Team" value={t.teamId ?? ""} className="h-8" onChange={(e) => patch({ teamId: e.target.value || null }, "Team updated")}>
                    <option value="">No team</option>
                    {teams?.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  t.team?.name ?? <span className="text-ink-faint">—</span>
                )}
              </DetailRow>
              <DetailRow label="SLA">
                <div>
                  <SlaLabel dueAt={t.dueAt} breached={t.slaBreached} done={isDone} />
                  {t.dueAt && <p className="text-2xs text-ink-faint">{fullDate(t.dueAt)}</p>}
                </div>
              </DetailRow>
              <DetailRow label="Category">{t.category ?? <span className="text-ink-faint">—</span>}</DetailRow>
              <DetailRow label="Requester">
                <span className="flex items-center gap-2">
                  <Avatar name={t.requester.name} src={t.requester.avatarUrl} size={20} /> <span className="truncate">{t.requester.name}</span>
                </span>
              </DetailRow>
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Timeline</h2>
            <dl className="divide-y divide-border">
              <DetailRow label="Created">{fullDate(t.createdAt)}</DetailRow>
              <DetailRow label="First response">{t.firstResponseAt ? fullDate(t.firstResponseAt) : <span className="text-ink-faint">Awaiting</span>}</DetailRow>
              {t.resolvedAt && <DetailRow label="Resolved">{fullDate(t.resolvedAt)}</DetailRow>}
              {t.closedAt && <DetailRow label="Closed">{fullDate(t.closedAt)}</DetailRow>}
            </dl>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Watchers</h2>
              <span className="text-xs text-ink-faint">{t.watchers.length}</span>
            </div>
            <AvatarStack users={t.watchers} max={8} size={26} />
          </Card>
          <p className="px-1 text-2xs text-ink-faint">{org?.name}</p>
        </aside>
      </div>

      <Dialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title={`Resolve ${t.key}`}
        description="Explain what fixed it. The requester and watchers are notified."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending === "status"}
              disabled={!resolutionNote.trim()}
              onClick={async () => {
                await run("status", () => api.post(`${key}/status`, { status: "RESOLVED", resolutionNote }), "Ticket resolved");
                setResolveOpen(false);
                setResolutionNote("");
              }}
            >
              Resolve ticket
            </Button>
          </>
        }
      >
        <Field label="Resolution note" htmlFor="resolution">
          <Textarea id="resolution" rows={5} autoFocus maxLength={5000} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder="e.g. Replaced the faulty docking station; confirmed with the requester." />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete ${t.key}?`}
        description="The ticket, its comments and history are permanently removed. This is recorded in the audit log."
        confirmLabel="Delete ticket"
        onConfirm={async () => {
          try {
            await api.delete(key);
            toast.success(`${t.key} deleted`);
            router.push(`/orgs/${orgId}/tickets`);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Page>
  );
}
