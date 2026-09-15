"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { fullDate } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { InlineAlert, Skeleton } from "@/components/ui/feedback";

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

interface SetupPayload {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

/** Groups a base32 secret for manual entry: ABCD EFGH … */
export const groupSecret = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

function CodeInput({ id, value, onChange, recovery = false }: { id: string; value: string; onChange: (v: string) => void; recovery?: boolean }) {
  return recovery ? (
    <Input id={id} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
  ) : (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      placeholder="123456"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ""))}
      className="font-mono tracking-[0.3em]"
      autoFocus
    />
  );
}

const validCode = (code: string) => /^\d{6}$/.test(code.replace(/\s/g, ""));

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <InlineAlert tone="warning">
        Save these somewhere safe, like a password manager. Each code signs you in once if you lose your device. They won&apos;t be shown again.
      </InlineAlert>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-canvas p-3 font-mono text-[13px] text-ink">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
          } catch {
            toast.error("Couldn't copy — select the codes and copy them manually");
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy codes"}
      </Button>
    </div>
  );
}

export function TwoFactorCard({ onChange }: { onChange?: () => void }) {
  const { data: status, mutate } = useApi<MfaStatus>("/auth/mfa");
  const [dialog, setDialog] = useState<null | "setup" | "codes" | "regenerate" | "disable">(null);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setSetup(null);
    setCode("");
    setCodes(null);
    setError(null);
    setUseRecovery(false);
  };

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    setDialog("setup");
    const payload = await run(() => api.post<SetupPayload>("/auth/mfa/setup"));
    if (payload) setSetup(payload);
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => api.post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code }));
    if (!res) return;
    setCodes(res.recoveryCodes);
    setCode("");
    setDialog("codes");
    await mutate();
    onChange?.();
    toast.success("Two-factor authentication is on");
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => api.post<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { code }));
    if (!res) return;
    setCodes(res.recoveryCodes);
    setCode("");
    setDialog("codes");
    await mutate();
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => api.post("/auth/mfa/disable", useRecovery ? { recoveryCode: code } : { code }));
    if (res === undefined) return;
    close();
    await mutate();
    onChange?.();
    toast.success("Two-factor authentication is off");
  }

  return (
    <Card id="security" className="scroll-mt-6">
      <CardHeader
        title="Two-factor authentication"
        description="Protect your account with a code from an authenticator app, in addition to your password."
        action={status && (status.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>)}
      />
      {!status ? (
        <div className="p-4">
          <Skeleton className="h-16" />
        </div>
      ) : status.enabled ? (
        <div className="space-y-4 p-4">
          <div className="flex gap-3 text-[13px]">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
            <div>
              <p className="text-ink">Your account is protected with an authenticator app.</p>
              <p className="text-xs text-ink-muted">
                Turned on {status.enabledAt ? fullDate(status.enabledAt) : ""} · {status.recoveryCodesRemaining} of 10 recovery codes left
              </p>
            </div>
          </div>
          {status.recoveryCodesRemaining <= 3 && <InlineAlert tone="warning">You&apos;re running low on recovery codes. Generate a new set.</InlineAlert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog("regenerate")}>
              <KeyRound size={14} /> New recovery codes
            </Button>
            <Button variant="danger-ghost" onClick={() => setDialog("disable")}>
              <ShieldOff size={14} /> Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3 text-[13px] text-ink-muted">
            <Smartphone size={18} className="mt-0.5 shrink-0 text-ink-faint" />
            <p>Use Google Authenticator, 1Password, Microsoft Authenticator or any app that supports time-based codes.</p>
          </div>
          <Button onClick={startSetup}>
            <ShieldCheck size={14} /> Set up two-factor
          </Button>
        </div>
      )}

      <Dialog open={dialog === "setup"} onOpenChange={(o) => !o && close()} title="Set up two-factor authentication" size="md">
        {!setup ? (
          error ? <InlineAlert tone="danger">{error}</InlineAlert> : <Skeleton className="h-64" />
        ) : (
          <form onSubmit={confirmSetup} className="space-y-4">
            <ol className="space-y-4 text-[13px] text-ink-muted">
              <li>
                <p className="mb-2 font-medium text-ink">1. Scan this QR code with your authenticator app</p>
                <div className="flex justify-center rounded-lg border border-border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR code for your authenticator app" width={180} height={180} />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-accent-ink">Can&apos;t scan it? Enter the key manually</summary>
                  <p className="mt-2 break-all rounded-md bg-canvas p-2 text-center font-mono text-xs text-ink" data-testid="mfa-secret">
                    {groupSecret(setup.secret)}
                  </p>
                </details>
              </li>
              <li>
                <p className="mb-2 font-medium text-ink">2. Enter the 6-digit code it shows</p>
                <Field label="Authentication code" htmlFor="mfa-setup-code">
                  <CodeInput id="mfa-setup-code" value={code} onChange={setCode} />
                </Field>
              </li>
            </ol>
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!validCode(code)}>
                Turn on
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog open={dialog === "codes"} onOpenChange={(o) => !o && close()} title="Your recovery codes" size="md">
        {codes && <RecoveryCodes codes={codes} />}
        <div className="mt-4 flex justify-end">
          <Button onClick={close}>I&apos;ve saved them</Button>
        </div>
      </Dialog>

      <Dialog open={dialog === "regenerate"} onOpenChange={(o) => !o && close()} title="Generate new recovery codes" description="Your current recovery codes will stop working." size="sm">
        <form onSubmit={regenerate} className="space-y-4">
          <Field label="Authentication code" htmlFor="mfa-regen-code">
            <CodeInput id="mfa-regen-code" value={code} onChange={setCode} />
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!validCode(code)}>
              Generate
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "disable"} onOpenChange={(o) => !o && close()} title="Turn off two-factor authentication?" description="Your account will be protected by your password alone." size="sm">
        <form onSubmit={disable} className="space-y-4">
          <Field label={useRecovery ? "Recovery code" : "Authentication code"} htmlFor="mfa-disable-code">
            <CodeInput id="mfa-disable-code" value={code} onChange={setCode} recovery={useRecovery} />
          </Field>
          <button
            type="button"
            className="text-xs font-medium text-accent-ink hover:underline"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
            }}
          >
            {useRecovery ? "Use your authenticator app instead" : "Use a recovery code instead"}
          </button>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={useRecovery ? code.trim().length < 10 : !validCode(code)}>
              Turn off
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
