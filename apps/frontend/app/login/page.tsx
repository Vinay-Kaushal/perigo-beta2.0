"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { useAuth, type SecondFactor } from "@/lib/auth-context";
import { ApiError, errorMessage, safeRedirect, ssoStartUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/feedback";
import { AuthLayout } from "@/components/auth-layout";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { ssoErrorMessage } from "@/lib/sso";

type Step = { kind: "password" } | { kind: "mfa"; mfaToken: string } | { kind: "sso" };

function LoginForm() {
  const { login, verifyMfa } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirect(params.get("next"));
  const ssoRequiredBy = params.get("sso") === "required" ? params.get("org") || "Your organisation" : null;
  const ssoError = params.get("sso_error");

  const [step, setStep] = useState<Step>(ssoRequiredBy || ssoError ? { kind: "sso" } : { kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(ssoError ? ssoErrorMessage(ssoError) : null);
  const [notice, setNotice] = useState<string | null>(ssoRequiredBy ? `${ssoRequiredBy} requires you to sign in with single sign-on.` : null);
  const [submitting, setSubmitting] = useState(false);

  const startMfa = useCallback((mfaToken: string) => {
    setStep({ kind: "mfa", mfaToken });
    setCode("");
    setUseRecovery(false);
    setError(null);
    setSubmitting(false);
  }, []);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const challenge = await login(email, password);
      if (challenge) return startMfa(challenge.mfaToken);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SSO_REQUIRED") {
        setStep({ kind: "sso" });
        setNotice(err.message);
        setPassword("");
      } else {
        setError(errorMessage(err));
      }
      setSubmitting(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "mfa") return;
    setError(null);
    setSubmitting(true);
    try {
      const factor: SecondFactor = useRecovery ? { recoveryCode: code } : { code };
      await verifyMfa(step.mfaToken, factor);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_CHALLENGE_EXPIRED") {
        setStep({ kind: "password" });
        setPassword("");
      }
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  function onSso(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    window.location.href = ssoStartUrl(email, next);
  }

  const back = (
    <button
      type="button"
      onClick={() => {
        setStep({ kind: "password" });
        setError(null);
        setNotice(null);
      }}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink"
    >
      <ArrowLeft size={14} /> Back to password sign-in
    </button>
  );

  if (step.kind === "mfa") {
    return (
      <AuthLayout title="Two-factor authentication" subtitle={useRecovery ? "Enter one of the recovery codes you saved." : "Enter the 6-digit code from your authenticator app."}>
        <form onSubmit={onMfa} className="space-y-4" noValidate>
          {useRecovery ? (
            <Field label="Recovery code" htmlFor="recovery">
              <Input id="recovery" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </Field>
          ) : (
            <Field label="Authentication code" htmlFor="otp">
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={7}
                placeholder="123456"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                autoFocus
                className="font-mono tracking-[0.3em]"
              />
            </Field>
          )}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <Button type="submit" size="lg" loading={submitting} disabled={useRecovery ? code.trim().length < 10 : code.replace(/\s/g, "").length !== 6} className="w-full">
            <ShieldCheck size={16} /> Verify
          </Button>
        </form>
        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
            className="text-[13px] font-medium text-accent-ink hover:underline"
          >
            {useRecovery ? "Use your authenticator app instead" : "Use a recovery code instead"}
          </button>
          {back}
        </div>
      </AuthLayout>
    );
  }

  if (step.kind === "sso") {
    return (
      <AuthLayout title="Single sign-on" subtitle="Continue with your organisation's identity provider.">
        <form onSubmit={onSso} className="space-y-4" noValidate>
          {notice && <InlineAlert tone="info">{notice}</InlineAlert>}
          <Field label="Work email" htmlFor="sso-email">
            <Input id="sso-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <Button type="submit" size="lg" loading={submitting} disabled={!/^\S+@\S+\.\S+$/.test(email)} className="w-full">
            <KeyRound size={16} /> Continue with SSO
          </Button>
        </form>
        <div className="mt-6 flex justify-center">{back}</div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Sign in to your workspace.">
      <form onSubmit={onPassword} className="space-y-4" noValidate>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint={
            <Link href="/forgot-password" className="font-medium text-accent-ink hover:underline">
              Forgot password?
            </Link>
          }
        >
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-ink-faint">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-3">
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => {
            setStep({ kind: "sso" });
            setError(null);
          }}
        >
          <KeyRound size={16} /> Sign in with SSO
        </Button>
        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && <GoogleSignInButton next={next} onMfaRequired={startMfa} />}
      </div>
      <p className="mt-8 text-center text-sm text-ink-muted">
        New to perigo?{" "}
        <Link href={`/register${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent-ink hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
