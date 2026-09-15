"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Globe, KeyRound, PlugZap, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API_URL, api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import type { OrgSecurity } from "@/lib/types";
import { fullDate } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { InlineAlert, Skeleton } from "@/components/ui/feedback";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy to the clipboard");
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

function Toggle({ label, description, checked, onChange, disabled, reason }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; reason?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{description}</p>
        {disabled && reason && <p className="mt-1 text-xs text-warning">{reason}</p>}
      </div>
      <Switch label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Two-factor policy and single sign-on for an organisation. Owners edit; admins can view. */
export function OrgSecuritySettings({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const { user } = useAuth();
  const { data, mutate, error } = useApi<OrgSecurity>(`/organisations/${orgId}/security`);
  const [confirmMfa, setConfirmMfa] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ issuer: "", clientId: "", clientSecret: "", enabled: false, autoProvision: false, enforce: false });
  const [removeSso, setRemoveSso] = useState(false);

  useEffect(() => {
    if (data?.sso) setForm({ issuer: data.sso.issuer, clientId: data.sso.clientId, clientSecret: "", enabled: data.sso.enabled, autoProvision: data.sso.autoProvision, enforce: data.sso.enforce });
  }, [data?.sso]);

  if (error) return <InlineAlert tone="danger">{errorMessage(error, "Couldn't load security settings")}</InlineAlert>;
  if (!data) return <Skeleton className="h-64" />;

  async function act(key: string, fn: () => Promise<OrgSecurity>, success?: string) {
    setBusy(key);
    try {
      await mutate(await fn(), { revalidate: false });
      if (success) toast.success(success);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const setMfaPolicy = (requireMfa: boolean) => act("mfa", () => api.patch<OrgSecurity>(`/organisations/${orgId}/security`, { requireMfa }), requireMfa ? "Two-factor authentication is now required" : "Two-factor authentication is now optional");

  const sso = data.sso;
  const verifiedDomains = data.domains.filter((d) => d.verifiedAt);
  const credentialsDirty = !sso || form.issuer !== sso.issuer || form.clientId !== sso.clientId || form.clientSecret !== "";
  const dirty = credentialsDirty || form.enabled !== sso.enabled || form.autoProvision !== sso.autoProvision || form.enforce !== sso.enforce;
  const enforceBlocker = !form.enabled
    ? "Turn SSO on first."
    : credentialsDirty || !sso?.testedAt
      ? "Save and test the connection first."
      : verifiedDomains.length === 0
        ? "Verify a domain first."
        : null;

  async function saveSso(e: React.FormEvent) {
    e.preventDefault();
    const { clientSecret, ...rest } = form;
    const ok = await act("sso", () => api.put<OrgSecurity>(`/organisations/${orgId}/sso`, { ...rest, ...(clientSecret ? { clientSecret } : {}) }), "Single sign-on settings saved");
    if (ok) setForm((f) => ({ ...f, clientSecret: "" }));
  }

  return (
    <>
      <Card id="mfa-policy" className="scroll-mt-6">
        <CardHeader title="Two-factor authentication" description="Require members to protect their accounts with an authenticator app." />
        <div className="space-y-4 p-4">
          <Toggle
            label="Require two-factor authentication"
            description="Members without it can't open this organisation until they turn it on. Members signed in through your SSO are covered by your identity provider."
            checked={data.requireMfa}
            disabled={!isOwner || busy === "mfa" || (!data.requireMfa && !user?.mfaEnabledAt)}
            reason={!isOwner ? "Only owners can change this." : !user?.mfaEnabledAt ? "Turn on two-factor authentication for your own account first." : null}
            onChange={(on) => (on && data.mfa.withoutMfa.length ? setConfirmMfa(true) : setMfaPolicy(on))}
          />
          {!user?.mfaEnabledAt && isOwner && (
            <Link href="/profile#security" className="inline-block text-xs font-medium text-accent-ink hover:underline">
              Set up two-factor authentication →
            </Link>
          )}
          <div className="rounded-md border border-border bg-canvas px-3 py-2 text-xs text-ink-muted">
            {data.mfa.withoutMfa.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <ShieldCheck size={13} /> Every member has two-factor authentication on.
              </span>
            ) : (
              <details>
                <summary className="cursor-pointer">
                  {data.mfa.withoutMfa.length} of {data.mfa.members} members don&apos;t have two-factor authentication yet
                </summary>
                <ul className="mt-2 space-y-0.5">
                  {data.mfa.withoutMfa.map((m) => (
                    <li key={m.id}>
                      <span className="text-ink">{m.name}</span> · {m.email}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </Card>

      <Card id="sso" className="scroll-mt-6">
        <CardHeader
          title="Single sign-on"
          description="Let people on your company's email domains sign in through your identity provider (Okta, Microsoft Entra ID, Google Workspace, Auth0 — any OpenID Connect provider)."
          action={sso ? sso.enforce ? <Badge tone="accent">Required</Badge> : sso.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge> : null}
        />

        <section className="space-y-3 p-4" aria-labelledby="domains-heading">
          <div>
            <h3 id="domains-heading" className="text-[13px] font-medium text-ink">
              1. Verify your email domains
            </h3>
            <p className="text-xs text-ink-muted">SSO only signs in people whose email is on a domain you&apos;ve proven you own, by adding a DNS TXT record.</p>
          </div>
          {data.domainVerification === "skip" && <InlineAlert tone="warning">DNS checks are switched off on this server (development only), so domains verify without a record.</InlineAlert>}
          {data.domains.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.domains.map((d) => (
                <li key={d.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Globe size={14} className="text-ink-faint" />
                    <span className="flex-1 font-mono text-[13px] text-ink">{d.domain}</span>
                    {d.verifiedAt ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Pending</Badge>}
                    {isOwner && !d.verifiedAt && (
                      <Button size="sm" variant="secondary" loading={busy === `verify:${d.id}`} onClick={() => act(`verify:${d.id}`, () => api.post<OrgSecurity>(`/organisations/${orgId}/domains/${d.id}/verify`), `${d.domain} verified`)}>
                        Verify
                      </Button>
                    )}
                    {isOwner && (
                      <Button size="icon" variant="ghost" aria-label={`Remove ${d.domain}`} loading={busy === `remove:${d.id}`} onClick={() => act(`remove:${d.id}`, () => api.delete<OrgSecurity>(`/organisations/${orgId}/domains/${d.id}`), `${d.domain} removed`)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                  {!d.verifiedAt && (
                    <dl className="grid items-center gap-x-2 gap-y-1 rounded bg-canvas p-2 text-xs sm:grid-cols-[80px_1fr]">
                      <dt className="text-ink-faint">Type</dt>
                      <dd className="font-mono text-ink">TXT</dd>
                      <dt className="text-ink-faint">Name</dt>
                      <dd className="flex min-w-0 items-center gap-1 font-mono text-ink">
                        <span className="truncate">{d.record.name}</span>
                        <CopyButton value={d.record.name} label="record name" />
                      </dd>
                      <dt className="text-ink-faint">Value</dt>
                      <dd className="flex min-w-0 items-center gap-1 font-mono text-ink">
                        <span className="truncate">{d.record.value}</span>
                        <CopyButton value={d.record.value} label="record value" />
                      </dd>
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOwner && (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act("domain", () => api.post<OrgSecurity>(`/organisations/${orgId}/domains`, { domain }))) setDomain("");
              }}
            >
              <Field label="Domain" htmlFor="sso-domain" className="flex-1">
                <Input id="sso-domain" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
              </Field>
              <Button type="submit" variant="secondary" loading={busy === "domain"}>
                Add domain
              </Button>
            </form>
          )}
        </section>

        <section className="space-y-4 border-t border-border p-4" aria-labelledby="idp-heading">
          <div>
            <h3 id="idp-heading" className="text-[13px] font-medium text-ink">
              2. Connect your identity provider
            </h3>
            <p className="text-xs text-ink-muted">Create an OpenID Connect web application in your provider with this redirect URI, then paste its details below.</p>
          </div>
          <Field label="Redirect URI" htmlFor="sso-callback">
            <div className="flex items-center gap-1">
              <Input id="sso-callback" readOnly value={data.callbackUrl} className="font-mono text-xs" />
              <CopyButton value={data.callbackUrl} label="redirect URI" />
            </div>
          </Field>
          <form onSubmit={saveSso} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issuer URL" htmlFor="sso-issuer" className="sm:col-span-2" hint="e.g. https://your-company.okta.com or https://login.microsoftonline.com/<tenant>/v2.0">
                <Input id="sso-issuer" type="url" required disabled={!isOwner} value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value.trim() })} />
              </Field>
              <Field label="Client ID" htmlFor="sso-client-id">
                <Input id="sso-client-id" required disabled={!isOwner} autoComplete="off" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value.trim() })} />
              </Field>
              <Field label="Client secret" htmlFor="sso-client-secret" hint={sso?.hasClientSecret ? "Stored encrypted. Leave blank to keep it." : undefined}>
                <Input
                  id="sso-client-secret"
                  type="password"
                  autoComplete="new-password"
                  required={!sso}
                  disabled={!isOwner}
                  placeholder={sso?.hasClientSecret ? "••••••••" : ""}
                  value={form.clientSecret}
                  onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <Toggle label="Enable single sign-on" description="Show “Sign in with SSO” for your verified domains." checked={form.enabled} disabled={!isOwner} onChange={(enabled) => setForm({ ...form, enabled, enforce: enabled && form.enforce })} />
              <Toggle
                label="Create accounts automatically"
                description="People on your verified domains who sign in through SSO for the first time join as members, without an invitation."
                checked={form.autoProvision}
                disabled={!isOwner}
                onChange={(autoProvision) => setForm({ ...form, autoProvision })}
              />
              <Toggle
                label="Require single sign-on"
                description="People on your verified domains can no longer use a password or Google; existing sessions that didn't come through SSO end. Owners keep password access for emergencies."
                checked={form.enforce}
                disabled={!isOwner || (!!enforceBlocker && !form.enforce)}
                reason={isOwner ? enforceBlocker : null}
                onChange={(enforce) => setForm({ ...form, enforce })}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-ink-faint">
                {sso ? (sso.testedAt && !credentialsDirty ? `Last tested ${fullDate(sso.testedAt)}` : "Not tested since the last change") : "Not set up yet"}
                {sso ? ` · ${sso.linkedAccounts} linked account${sso.linkedAccounts === 1 ? "" : "s"}` : ""}
              </p>
              {isOwner && (
                <div className="flex flex-wrap gap-2">
                  {sso && (
                    <Button type="button" variant="danger-ghost" onClick={() => setRemoveSso(true)}>
                      Remove
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!sso || credentialsDirty}
                    title={credentialsDirty ? "Save your changes before testing" : undefined}
                    onClick={() => {
                      window.location.href = `${API_URL}/organisations/${orgId}/sso/test`;
                    }}
                  >
                    <PlugZap size={14} /> Test connection
                  </Button>
                  <Button type="submit" loading={busy === "sso"} disabled={!dirty}>
                    <KeyRound size={14} /> Save
                  </Button>
                </div>
              )}
            </div>
          </form>
        </section>
      </Card>

      <ConfirmDialog
        open={confirmMfa}
        onOpenChange={setConfirmMfa}
        title="Require two-factor authentication?"
        description={`${data.mfa.withoutMfa.length} member${data.mfa.withoutMfa.length === 1 ? "" : "s"} will lose access to this organisation until they turn it on.`}
        confirmLabel="Require it"
        onConfirm={async () => {
          await setMfaPolicy(true);
        }}
      />
      <ConfirmDialog
        open={removeSso}
        onOpenChange={setRemoveSso}
        title="Remove single sign-on?"
        description="People will sign in with their passwords again. Accounts created through SSO will need a password reset."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await act("sso", () => api.delete<OrgSecurity>(`/organisations/${orgId}/sso`), "Single sign-on removed");
          setForm({ issuer: "", clientId: "", clientSecret: "", enabled: false, autoProvision: false, enforce: false });
        }}
      />
    </>
  );
}
