"use client";

import { useParams } from "next/navigation";
import useSWR, { type SWRConfiguration } from "swr";
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
