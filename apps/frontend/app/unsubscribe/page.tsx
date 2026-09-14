"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, MailX } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/feedback";

const LABELS: Record<string, string> = {
  ALL: "all notification emails",
  ASSIGNMENTS: "assignment emails",
  MENTIONS: "mention emails",
  TICKET_UPDATES: "ticket activity emails",
  APPROVALS: "approval emails",
  ACCOUNT: "emails about your requests",
};

/**
 * Deliberately needs a click: link scanners in mail systems open URLs, and
 * unsubscribing on page load would silently switch people's emails off.
 */
function UnsubscribeInner() {
  const token = useSearchParams().get("token") ?? "";
  const scope = token.split(".")[1] ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("busy");
    setError(null);
    try {
      await api.post("/email/unsubscribe", { token });
      setState("done");
    } catch (err) {
      setError(errorMessage(err));
      setState("idle");
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invalid link" subtitle="This unsubscribe link is missing its token.">
        <Link href="/profile#notifications" className="text-sm font-medium text-accent-ink hover:underline">
          Manage notification preferences
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={state === "done" ? "You're unsubscribed" : "Unsubscribe"}>
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex gap-3 text-sm text-ink-muted">
          {state === "done" ? <MailCheck className="shrink-0 text-success" /> : <MailX className="shrink-0 text-ink-faint" />}
          <p>
            {state === "done"
              ? `We won't send you ${LABELS[scope] ?? "these emails"} anymore. In-app notifications are unchanged.`
              : `Stop receiving ${LABELS[scope] ?? "these emails"} from perigo?`}
          </p>
        </div>
        {error && (
          <InlineAlert tone="danger" className="mt-4">
            {error}
          </InlineAlert>
        )}
        {state !== "done" && (
          <Button className="mt-5 w-full" loading={state === "busy"} onClick={confirm}>
            Unsubscribe
          </Button>
        )}
        <Link href="/profile#notifications" className="mt-4 block text-center text-[13px] font-medium text-accent-ink hover:underline">
          Manage all notification preferences
        </Link>
      </div>
    </AuthLayout>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeInner />
    </Suspense>
  );
}
