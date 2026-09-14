"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { useDebouncedRevalidate, useOrg } from "@/lib/hooks";
import { useChannelEvents } from "@/lib/realtime";
import { ApiError } from "@/lib/api";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

/**
 * Every org page shares one live subscription: any change pushed on
 * `org:<id>` revalidates that org's cached queries, so lists, stats and
 * detail views update for everyone without a refresh.
 */
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const { org, error, mutate: retry } = useOrg(orgId);
  const revalidateOrg = useDebouncedRevalidate([`/organisations/${orgId}`]);

  useChannelEvents(orgId ? `org:${orgId}` : null, revalidateOrg);

  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <EmptyState
          icon={ShieldOff}
          title="You don't have access to this organisation"
          description="It may not exist, or you haven't been invited and approved yet."
          action={
            <Link href="/orgs">
              <Button variant="secondary">Back to organisations</Button>
            </Link>
          }
        />
      </div>
    );
  }
  if (error && !org) {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-8">
        <ErrorState message="Couldn't load this organisation." onRetry={() => retry()} />
      </div>
    );
  }

  // Don't mount the pages (and fire their queries) until membership is confirmed.
  if (!org) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-6 pt-8" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  return <>{children}</>;
}
