export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const SESSION_COOKIE = "perigo_session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public issues?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
  ) {
    super(message);
  }
}

/** Only same-site relative paths — prevents ?next=https://evil.example open redirects. */
export function safeRedirect(next: string | null | undefined, fallback = "/dashboard") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * The session lives in an httpOnly cookie set by the API, so no token is ever
 * readable here. Every request sends the CSRF header the API requires on
 * cookie-authenticated writes.
 */
const baseHeaders = { "X-CSRF-Protection": "1" };

// 401s on these paths are expected (checking for a session, bad credentials) and must not bounce to /login.
const QUIET_401 = ["/auth/me", "/auth/login", "/auth/register", "/auth/google", "/auth/reset-password", "/auth/verify-email"];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...baseHeaders, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && !QUIET_401.some((p) => path.startsWith(p))) onUnauthorized?.();
    const firstFieldError = data?.issues?.fieldErrors
      ? Object.entries(data.issues.fieldErrors as Record<string, string[]>).map(([f, m]) => `${f}: ${m[0]}`)[0]
      : undefined;
    throw new ApiError(res.status, firstFieldError ?? data?.error ?? `Request failed (${res.status})`, data?.code, data?.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, data?: unknown) => request<T>("POST", path, data ?? {}),
  patch: <T>(path: string, data?: unknown) => request<T>("PATCH", path, data ?? {}),
  delete: <T>(path: string, data?: unknown) => request<T>("DELETE", path, data),
};

/** Downloads a binary endpoint (e.g. the PDF report) with auth, without exposing the token in a URL. */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: baseHeaders, credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error ?? "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown, fallback = "Something went wrong") {
  return err instanceof ApiError ? err.message : fallback;
}
