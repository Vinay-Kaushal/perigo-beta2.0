"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, safeRedirect } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/feedback";
import { AuthLayout } from "@/components/auth-layout";
import { cn } from "@/lib/utils";

const RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "Contains a letter", test: (p: string) => /[A-Za-z]/.test(p) },
  { label: "Contains a number", test: (p: string) => /[0-9]/.test(p) },
];

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirect(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valid = RULES.every((r) => r.test(password)) && password.length <= 72;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Choose a password that meets the requirements.");
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, name);
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Start a workspace, or accept an invitation from your team.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" htmlFor="name">
          <Input id="name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
          <ul className="grid gap-1 pt-1">
            {RULES.map((r) => {
              const ok = r.test(password);
              return (
                <li key={r.label} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-success" : "text-ink-faint")}>
                  {ok ? <Check size={12} /> : <X size={12} />} {r.label}
                </li>
              );
            })}
          </ul>
        </Field>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href={`/login${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
