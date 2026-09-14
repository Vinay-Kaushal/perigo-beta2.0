"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Building2, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { InvitationPreview } from "@/lib/types";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { InlineAlert, Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { shortDate, titleCase } from "@/lib/utils";

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const { data, error, isLoading, mutate } = useApi<InvitationPreview>(`/invitations/${token}`, { shouldRetryOnError: false });
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<{ status: string; organisationId: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const here = `/invitations/${token}`;

  async function act(kind: "accept" | "decline") {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "accept") setResult(await api.post(`/invitations/${token}/accept`));
      else {
        await api.post(`/invitations/${token}/decline`);
        await mutate();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || authLoading) {
    return (
      <AuthLayout title="Loading invitation…">
        <Skeleton className="h-32 w-full" />
      </AuthLayout>
    );
  }

  if (error || !data) {
    return (
      <AuthLayout title="Invitation unavailable" subtitle="This link is invalid or has expired. Ask the person who invited you to send a new one.">
        <Link href="/dashboard" className="text-sm font-medium text-accent-ink hover:underline">
          Go to perigo
        </Link>
      </AuthLayout>
    );
  }

  if (result) {
    const approved = result.status === "ACCEPTED";
    return (
      <AuthLayout title={approved ? `Welcome to ${data.organisationName}` : "Request sent for approval"}>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
          <div className="flex gap-3">
            {approved ? <CheckCircle2 className="shrink-0 text-success" /> : <Clock className="shrink-0 text-warning" />}
            <p className="text-sm text-ink-muted">
              {approved
                ? "You're now a member. Jump in and get to work."
                : `An owner or admin of ${data.organisationName} will review your request. We'll notify you as soon as it's approved.`}
            </p>
          </div>
          <Button className="mt-5 w-full" onClick={() => router.push(approved ? `/orgs/${result.organisationId}` : "/dashboard")}>
            {approved ? "Open organisation" : "Go to home"}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const wrongAccount = user && user.email.toLowerCase() !== data.email.toLowerCase();
  const pending = data.status === "PENDING";

  return (
    <AuthLayout title={`Join ${data.organisationName}`} subtitle={`${data.invitedByName} invited ${data.email} to collaborate.`}>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
            <Building2 size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{data.organisationName}</p>
            <p className="text-xs text-ink-faint">Expires {shortDate(data.expiresAt)}</p>
          </div>
          <Badge tone="accent" className="ml-auto">
            {titleCase(data.role)}
          </Badge>
        </div>
        {data.message && <blockquote className="mt-4 border-l-2 border-border pl-3 text-sm italic text-ink-muted">“{data.message}”</blockquote>}
        {data.requiresApproval && pending && (
          <p className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent-ink" />
            This organisation reviews new members. After you accept, an admin approves your access.
          </p>
        )}

        <div className="mt-5 space-y-3">
          {!pending && <InlineAlert tone="warning">This invitation is {titleCase(data.status).toLowerCase()}.</InlineAlert>}
          {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}

          {pending && !user && (
            <>
              <Button className="w-full" onClick={() => router.push(`/register?email=${encodeURIComponent(data.email)}&next=${encodeURIComponent(here)}`)}>
                Create account to accept
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => router.push(`/login?next=${encodeURIComponent(here)}`)}>
                I already have an account
              </Button>
            </>
          )}

          {pending && wrongAccount && (
            <>
              <InlineAlert tone="warning">
                You&apos;re signed in as <strong>{user.email}</strong>. This invitation is for <strong>{data.email}</strong>.
              </InlineAlert>
              <Button variant="secondary" className="w-full" onClick={logout}>
                Sign in with a different account
              </Button>
            </>
          )}

          {pending && user && !wrongAccount && (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" loading={busy === "decline"} disabled={!!busy} onClick={() => act("decline")}>
                Decline
              </Button>
              <Button className="flex-1" loading={busy === "accept"} disabled={!!busy} onClick={() => act("accept")}>
                Accept invitation
              </Button>
            </div>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
