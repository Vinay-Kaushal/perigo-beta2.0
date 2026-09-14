"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, LogOut, Mail, MoreHorizontal, Plus, RotateCw, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApi, useOrg } from "@/lib/hooks";
import type { Invitation, Member, OrganisationRole, Team } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, DropdownCheckItem } from "@/components/ui/dropdown";
import { EmptyState, InlineAlert } from "@/components/ui/feedback";
import { relativeTime, shortDate, titleCase } from "@/lib/utils";

const ROLE_TONE = { OWNER: "accent", ADMIN: "info", MEMBER: "neutral" } as const;

function InviteDialog({ orgId, open, onOpenChange, canInviteAdmins, requiresApproval }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void; canInviteAdmins: boolean; requiresApproval: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganisationRole>("MEMBER");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      setEmail("");
      setMessage("");
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<Invitation>(`/organisations/${orgId}/invitations`, { email, role, message: message || undefined }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={result ? "Invitation sent" : "Invite people"}
      description={result ? undefined : "They'll get an email link. Joining requires accepting the invite" + (requiresApproval || !canInviteAdmins ? " and admin approval." : ".")}
      footer={
        result ? (
          <Button onClick={() => close(false)}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={busy} disabled={!email.trim()}>
              <Mail size={14} /> Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <InlineAlert tone="success">
            {result.emailed ? `We emailed ${result.email}.` : `Email delivery isn't configured — share this link with ${result.email}.`}
          </InlineAlert>
          <Field label="Invitation link" htmlFor="invite-link" hint="Only works for the invited email address. Expires in 7 days.">
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={result.inviteUrl} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" aria-label="Copy invitation link" onClick={() => navigator.clipboard.writeText(result.inviteUrl!).then(() => toast.success("Link copied"))}>
                <Copy size={14} />
              </Button>
            </div>
          </Field>
        </div>
      ) : (
        <form id="invite-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Email address" htmlFor="inv-email">
              <Input id="inv-email" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as OrganisationRole)}>
                <option value="MEMBER">Member</option>
                {canInviteAdmins && <option value="ADMIN">Admin</option>}
              </Select>
            </Field>
          </div>
          <Field label="Personal message (optional)" htmlFor="inv-msg">
            <Textarea id="inv-msg" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </form>
      )}
    </Dialog>
  );
}

function MembersInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { org, isAdmin, isOwner } = useOrg(orgId);
  const { data: members, mutate: reloadMembers } = useApi<Member[]>(`/organisations/${orgId}/members`);
  const { data: invites, mutate: reloadInvites } = useApi<Invitation[]>(isAdmin ? `/organisations/${orgId}/invitations` : null);
  const { data: teams, mutate: reloadTeams } = useApi<Team[]>(`/organisations/${orgId}/teams`);
  const [tab, setTab] = useState(params.get("tab") ?? "members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Invitation | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);

  const requests = invites?.filter((i) => i.status === "AWAITING_APPROVAL") ?? [];
  const pendingInvites = invites?.filter((i) => i.status === "PENDING") ?? [];
  const me = members?.find((m) => m.userId === user?.id);

  async function act(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      toast.success(success);
      await Promise.all([reloadMembers(), reloadInvites(), reloadTeams()]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const canRemove = (m: Member) => m.userId !== user?.id && (isOwner || (me?.role === "ADMIN" && m.role === "MEMBER"));

  return (
    <Page>
      <PageHeader
        eyebrow={org?.name}
        title="People"
        description="Members, teams and access requests. People can only join by invitation."
        actions={
          <>
            {me && (
              <Button variant="ghost" onClick={() => setLeaveOpen(true)}>
                <LogOut size={14} /> Leave
              </Button>
            )}
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus size={15} /> Invite
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => (setTab(v), router.replace(`/orgs/${orgId}/members${v === "members" ? "" : `?tab=${v}`}`))}>
        <TabsList className="mb-4">
          <TabsTrigger value="members" count={members?.length}>
            Members
          </TabsTrigger>
          <TabsTrigger value="teams" count={teams?.length}>
            Teams
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="requests" count={requests.length}>
              Join requests
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="invitations" count={pendingInvites.length}>
              Pending invitations
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {members?.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {m.user.name} {m.userId === user?.id && <span className="text-ink-faint">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-ink-faint">
                      {m.user.email} · joined {shortDate(m.joinedAt)}
                      {m.teams.length > 0 && <> · {m.teams.map((t) => t.name).join(", ")}</>}
                    </p>
                  </div>
                  <Badge tone={ROLE_TONE[m.role]}>{titleCase(m.role)}</Badge>
                  {(isOwner || canRemove(m)) && m.userId !== user?.id && (
                    <DropdownMenu>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Manage ${m.user.name}`}>
                          <MoreHorizontal size={16} />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent>
                        {isOwner && (
                          <>
                            <DropdownLabel>Role</DropdownLabel>
                            {(["OWNER", "ADMIN", "MEMBER"] as OrganisationRole[]).map((r) => (
                              <DropdownCheckItem
                                key={r}
                                checked={m.role === r}
                                onSelect={() => m.role !== r && act(() => api.patch(`/organisations/${orgId}/members/${m.id}`, { role: r }), `${m.user.name} is now ${titleCase(r).toLowerCase()}`)}
                              >
                                {titleCase(r)}
                              </DropdownCheckItem>
                            ))}
                            <DropdownSeparator />
                          </>
                        )}
                        {canRemove(m) && (
                          <DropdownItem destructive onSelect={() => setRemoveTarget(m)}>
                            <Trash2 size={14} /> Remove from organisation
                          </DropdownItem>
                        )}
                      </DropdownContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="teams">
          <div className="mb-3 flex justify-end">
            {isAdmin && (
              <Button variant="secondary" onClick={() => setTeamOpen(true)}>
                <Plus size={14} /> New team
              </Button>
            )}
          </div>
          {!teams?.length ? (
            <Card>
              <EmptyState icon={Users} title="No teams yet" description="Teams act as ticket queues — route tickets to a team and its members are notified." />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {teams.map((team) => (
                <Card key={team.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{team.name}</p>
                      <p className="text-xs text-ink-faint">
                        {team.members.length} members · {team.openTickets} open tickets
                      </p>
                    </div>
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Manage ${team.name}`}>
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent className="max-h-80 overflow-y-auto">
                          <DropdownLabel>Members</DropdownLabel>
                          {members?.map((m) => {
                            const inTeam = team.members.some((tm) => tm.id === m.userId);
                            return (
                              <DropdownCheckItem
                                key={m.userId}
                                checked={inTeam}
                                onSelect={(e) => {
                                  e.preventDefault();
                                  act(
                                    () => (inTeam ? api.delete(`/organisations/${orgId}/teams/${team.id}/members/${m.userId}`) : api.post(`/organisations/${orgId}/teams/${team.id}/members`, { userId: m.userId })),
                                    inTeam ? `Removed ${m.user.name}` : `Added ${m.user.name}`
                                  );
                                }}
                              >
                                {m.user.name}
                              </DropdownCheckItem>
                            );
                          })}
                          <DropdownSeparator />
                          <DropdownItem destructive onSelect={() => act(() => api.delete(`/organisations/${orgId}/teams/${team.id}`), "Team deleted")}>
                            <Trash2 size={14} /> Delete team
                          </DropdownItem>
                        </DropdownContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {team.members.map((tm) => (
                      <span key={tm.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted py-0.5 pl-0.5 pr-2 text-xs text-ink">
                        <Avatar name={tm.name} src={tm.avatarUrl} size={18} /> {tm.name}
                      </span>
                    ))}
                    {team.members.length === 0 && <span className="text-xs text-ink-faint">No members yet</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="requests">
            <Card className="overflow-hidden">
              {requests.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="No pending join requests" description="When someone accepts an invitation, they wait here for your approval." />
              ) : (
                <ul className="divide-y divide-border">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Avatar name={r.acceptedBy?.name ?? r.email} src={r.acceptedBy?.avatarUrl} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">
                          {r.acceptedBy?.name ?? r.email} <Badge className="ml-1">{titleCase(r.role)}</Badge>
                        </p>
                        <p className="text-xs text-ink-faint">
                          {r.email} · invited by {r.invitedBy.name} · accepted {r.acceptedAt ? relativeTime(r.acceptedAt) : ""}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => setRejectTarget(r)}>
                        <X size={14} /> Reject
                      </Button>
                      <Button size="sm" onClick={() => act(() => api.post(`/organisations/${orgId}/invitations/${r.id}/approve`), `${r.acceptedBy?.name ?? r.email} approved`)}>
                        <Check size={14} /> Approve
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="invitations">
            <Card className="overflow-hidden">
              {pendingInvites.length === 0 ? (
                <EmptyState icon={Mail} title="No outstanding invitations" />
              ) : (
                <ul className="divide-y divide-border">
                  {pendingInvites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-muted text-ink-faint">
                        <Mail size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">{i.email}</p>
                        <p className="text-xs text-ink-faint">
                          {titleCase(i.role)} · invited by {i.invitedBy.name} {relativeTime(i.createdAt)} · expires {shortDate(i.expiresAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          act(async () => {
                            const res = await api.post<Invitation>(`/organisations/${orgId}/invitations/${i.id}/resend`);
                            if (res.inviteUrl) await navigator.clipboard.writeText(res.inviteUrl).catch(() => {});
                          }, "Invitation resent (new link copied)")
                        }
                      >
                        <RotateCw size={13} /> Resend
                      </Button>
                      <Button variant="danger-ghost" size="sm" onClick={() => act(() => api.delete(`/organisations/${orgId}/invitations/${i.id}`), "Invitation revoked")}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <InviteDialog orgId={orgId} open={inviteOpen} onOpenChange={(o) => (setInviteOpen(o), !o && reloadInvites())} canInviteAdmins={isAdmin} requiresApproval={org?.requireJoinApproval ?? true} />

      <Dialog
        open={teamOpen}
        onOpenChange={setTeamOpen}
        title="New team"
        size="sm"
        footer={
          <Button
            disabled={!teamName.trim()}
            onClick={() =>
              act(() => api.post(`/organisations/${orgId}/teams`, { name: teamName }), "Team created").then(() => {
                setTeamName("");
                setTeamOpen(false);
              })
            }
          >
            Create team
          </Button>
        }
      >
        <Field label="Team name" htmlFor="team-name">
          <Input id="team-name" autoFocus maxLength={120} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. IT Support" />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        destructive
        title={`Remove ${removeTarget?.user.name}?`}
        description="They lose access immediately. Their open tickets become unassigned."
        confirmLabel="Remove member"
        onConfirm={() => act(() => api.delete(`/organisations/${orgId}/members/${removeTarget!.id}`), "Member removed")}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => !o && (setRejectTarget(null), setRejectReason(""))}
        destructive
        title={`Reject ${rejectTarget?.acceptedBy?.name ?? rejectTarget?.email}?`}
        description="They'll be notified that their request was declined."
        confirmLabel="Reject request"
        onConfirm={() => act(() => api.post(`/organisations/${orgId}/invitations/${rejectTarget!.id}/reject`, { reason: rejectReason || undefined }), "Request rejected")}
      >
        <Field label="Reason (optional, shared with them)" htmlFor="reject-reason">
          <Textarea id="reject-reason" rows={2} maxLength={500} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        destructive
        title={`Leave ${org?.name}?`}
        description="You'll need a new invitation to rejoin."
        confirmLabel="Leave organisation"
        onConfirm={async () => {
          try {
            await api.delete(`/organisations/${orgId}/members/me`);
            toast.success(`You left ${org?.name}`);
            router.push("/orgs");
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Page>
  );
}

export default function MembersPage() {
  return (
    <Suspense>
      <MembersInner />
    </Suspense>
  );
}
