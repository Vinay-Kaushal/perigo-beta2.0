"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Organisation, OrganisationMember, Invitation, OrganisationRole } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { OrgTabs } from "@/components/org-tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Copy, UserPlus, X } from "lucide-react";

export default function MembersPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { user } = useAuth();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<OrganisationMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganisationRole>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  async function refresh() {
    try {
      const [orgRes, invitesRes] = await Promise.all([
        api.get<Organisation & { members: OrganisationMember[] }>(`/organisations/${orgId}`),
        api.get<Invitation[]>(`/organisations/${orgId}/invitations`),
      ]);
      setOrg(orgRes);
      setMembers(orgRes.members ?? []);
      setInvitations(invitesRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load members");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const myMembership = members.find((m) => m.userId === user?.id);
  const canManage = myMembership?.role === "OWNER" || myMembership?.role === "ADMIN";

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      const res = await api.post<Invitation>(`/organisations/${orgId}/invitations`, { email, role });
      setEmail("");
      setLastInviteUrl(res.inviteUrl ?? null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(memberId: string, newRole: OrganisationRole) {
    try {
      await api.patch(`/organisations/${orgId}/members/${memberId}`, { role: newRole });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update role");
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("Remove this member from the organisation?")) return;
    try {
      await api.delete(`/organisations/${orgId}/members/${memberId}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    }
  }

  async function revokeInvite(invitationId: string) {
    try {
      await api.delete(`/organisations/${orgId}/invitations/${invitationId}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke invite");
    }
  }

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: org?.name ?? "…", href: `/orgs/${orgId}` }, { label: "Members" }]} />
      <OrgTabs orgId={orgId} />

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        {error && <p className="text-sm text-urgent">{error}</p>}

        {canManage && (
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
              <UserPlus size={15} /> Invite someone
            </h2>
            <form onSubmit={sendInvite} className="flex gap-2">
              <Input
                type="email"
                required
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={role} onChange={(e) => setRole(e.target.value as OrganisationRole)} className="w-32">
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </Select>
              <Button type="submit" size="sm" disabled={inviting || !email.trim()}>
                {inviting ? "Sending…" : "Invite"}
              </Button>
            </form>

            {lastInviteUrl && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-surface p-2.5 text-xs">
                <span className="truncate text-ink-muted">{lastInviteUrl}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(lastInviteUrl)}
                  className="flex shrink-0 items-center gap-1 text-accent hover:underline"
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-faint">
              No email is sent yet — copy this link and share it with them directly.
            </p>
          </Card>
        )}

        <div>
          <h2 className="mb-3 text-sm font-medium text-ink">Members ({members.length})</h2>
          <div className="space-y-2">
            {members.map((m) => (
              <Card key={m.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={m.user.name} size={28} />
                  <div>
                    <p className="text-sm text-ink">{m.user.name}</p>
                    <p className="text-xs text-ink-faint">{m.user.email}</p>
                  </div>
                </div>
                {canManage && m.userId !== user?.id ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as OrganisationRole)}
                      className="w-28"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                    </Select>
                    <button
                      onClick={() => removeMember(m.id)}
                      className="rounded p-1.5 text-ink-faint hover:bg-surface hover:text-urgent"
                      aria-label="Remove member"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <Badge tone="low">{m.role}</Badge>
                )}
              </Card>
            ))}
          </div>
        </div>

        {invitations.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-ink">Pending invites ({invitations.length})</h2>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <Card key={inv.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm text-ink">{inv.email}</p>
                    <p className="text-xs text-ink-faint">
                      Invited as {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => revokeInvite(inv.id)}
                      className="rounded p-1.5 text-ink-faint hover:bg-surface hover:text-urgent"
                      aria-label="Revoke invite"
                    >
                      <X size={14} />
                    </button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
