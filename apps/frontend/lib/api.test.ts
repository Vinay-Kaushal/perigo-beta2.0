import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { api, ApiError, safeRedirect, setUnauthorizedHandler } from "./api";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function respond(status: number, body?: unknown) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  setUnauthorizedHandler(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("safeRedirect", () => {
  test.each([
    ["/orgs/abc?tab=1", "/orgs/abc?tab=1"],
    [null, "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("%p -> %p", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});

describe("request", () => {
  test("sends the session cookie and CSRF header, never an Authorization header", async () => {
    respond(200, { ok: true });
    await api.post("/organisations", { name: "x" });
    const { init } = calls[0]!;
    expect(init.credentials).toBe("include");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CSRF-Protection"]).toBe("1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ name: "x" }));
  });

  test("204 resolves to undefined", async () => {
    respond(204);
    expect(await api.delete("/x")).toBeUndefined();
  });

  test("errors carry status, code and the first field error", async () => {
    respond(400, { error: "Validation failed", code: "VALIDATION_FAILED", issues: { fieldErrors: { title: ["Too short"] } } });
    const err = await api.post("/x", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("title: Too short");
  });

  test("a 401 on a normal call triggers sign-out; on session checks it doesn't", async () => {
    let signedOut = 0;
    setUnauthorizedHandler(() => signedOut++);
    respond(401, { error: "Not signed in" });
    await api.get("/me/dashboard").catch(() => {});
    expect(signedOut).toBe(1);
    await api.get("/auth/me").catch(() => {});
    await api.post("/auth/login", {}).catch(() => {});
    expect(signedOut).toBe(1);
  });

  test("the sign-out handler receives the error, with the API's details", async () => {
    let received: ApiError | null = null;
    setUnauthorizedHandler((e) => (received = e));
    respond(401, { error: "Acme requires single sign-on", code: "SSO_REQUIRED", details: { organisation: { name: "Acme" } } });
    const thrown = await api.get("/organisations").catch((e) => e);
    expect(thrown.details).toEqual({ organisation: { name: "Acme" } });
    expect(received!.code).toBe("SSO_REQUIRED");
    // A wrong 2FA code at sign-in is an expected 401, not a reason to sign out.
    received = null;
    await api.post("/auth/mfa/verify", {}).catch(() => {});
    expect(received).toBeNull();
  });

  test("network failures become a friendly ApiError", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await api.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });
});
