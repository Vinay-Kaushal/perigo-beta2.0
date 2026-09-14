"use client";

import { useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import useSWR, { useSWRConfig, type SWRConfiguration } from "swr";
import { api } from "./api";
import type { Organisation } from "./types";

export const fetcher = <T>(path: string) => api.get<T>(path);

/** GET with caching + revalidation. Pass null to skip. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: true, keepPreviousData: true, ...config });
}

export function useOrgId() {
  const params = useParams<{ orgId?: string }>();
  return params?.orgId ?? null;
}

export function useOrg(orgId: string | null) {
  const res = useApi<Organisation>(orgId ? `/organisations/${orgId}` : null);
  const role = res.data?.myRole;
  return { ...res, org: res.data, isAdmin: role === "OWNER" || role === "ADMIN", isOwner: role === "OWNER" };
}

/**
 * Returns a function that revalidates every cached query whose key starts with
 * one of the prefixes — debounced, so a burst of realtime events (status change,
 * comment, notification…) triggers one round of refetches instead of one per event.
 */
export function useDebouncedRevalidate(prefixes: string[], delayMs = 250) {
  const { mutate } = useSWRConfig();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefixKey = prefixes.join("|");

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = prefixKey.split("|");
      mutate((key) => typeof key === "string" && list.some((p) => key.startsWith(p)));
    }, delayMs);
  }, [mutate, prefixKey, delayMs]);
}
