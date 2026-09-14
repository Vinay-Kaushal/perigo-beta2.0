"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";

function VerifyInner() {
  const token = useSearchParams().get("token");
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Tokens are single-use, so guard against React strict-mode double effects.
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState("failed");
      setError("This link is missing its verification token.");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(async () => {
        setState("done");
        await refreshUser();
      })
      .catch((err) => {
        setState("failed");
        setError(errorMessage(err));
      });
  }, [token, refreshUser]);

  if (state === "working") {
    return (
      <AuthLayout title="Verifying your email…">
        <Skeleton className="h-20" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={state === "done" ? "Email verified" : "Couldn't verify your email"}>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex gap-3 text-sm text-ink-muted">
          {state === "done" ? <CheckCircle2 className="shrink-0 text-success" /> : <XCircle className="shrink-0 text-danger" />}
          <p>{state === "done" ? "Thanks — you can now create organisations and invite your team." : `${error} Sign in and use “Resend email” from the banner to get a new link.`}</p>
        </div>
        <Link href={user ? "/dashboard" : "/login"} className="mt-5 block">
          <Button className="w-full">{user ? "Continue to perigo" : "Sign in"}</Button>
        </Link>
      </div>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
