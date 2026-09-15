import { createHash, randomBytes } from "crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

/**
 * A small but honest OpenID Connect provider for tests and local e2e:
 * discovery, JWKS, an authorization page, and a token endpoint that checks
 * the client secret, redirect_uri, single-use codes and PKCE (S256) before
 * issuing an RS256-signed ID token.
 */
export interface MockUser {
  sub: string;
  email: string;
  name?: string;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce?: string;
  user: MockUser;
}

export interface MockOidcOptions {
  port?: number;
  clientId?: string;
  clientSecret?: string;
}

export async function startMockOidc({ port = 0, clientId = "perigo-test-client", clientSecret = "perigo-test-secret" }: MockOidcOptions = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "mock-key-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, PendingCode>();

  const state = {
    /** Tamper with the next ID token (tests of signature/audience/nonce checks). */
    nextIdToken: null as null | { claims?: Record<string, unknown>; signWith?: CryptoKey },
    tokenRequests: 0,
  };

  const html = (body: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Mock identity provider</title><body style="font-family:system-ui;max-width:420px;margin:48px auto">${body}</body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  let issuer = "";
  const server = Bun.serve({
    port,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "email", "profile"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        });
      }

      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });

      if (url.pathname === "/authorize" && req.method === "GET") {
        const p = url.searchParams;
        if (p.get("client_id") !== clientId) return html("<h1>Unknown client</h1>");
        const hidden = [...p.entries()].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
        const hint = p.get("login_hint") ?? "";
        return html(`<h1>Mock identity provider</h1>
<form method="post" action="/authorize">${hidden}
<p><label>Email <input name="email" type="email" value="${esc(hint)}" required></label></p>
<p><label>Name <input name="name" value=""></label></p>
<p><button type="submit">Continue</button></p></form>`);
      }

      if (url.pathname === "/authorize" && req.method === "POST") {
        const form = await req.formData();
        const get = (k: string) => (form.get(k) as string | null) ?? "";
        if (get("client_id") !== clientId) return new Response("unknown client", { status: 400 });
        if (get("code_challenge_method") !== "S256" || !get("code_challenge")) return new Response("PKCE required", { status: 400 });
        const email = get("email").toLowerCase();
        const code = randomBytes(24).toString("base64url");
        codes.set(code, {
          clientId,
          redirectUri: get("redirect_uri"),
          codeChallenge: get("code_challenge"),
          nonce: get("nonce") || undefined,
          user: { sub: get("sub") || `mock|${email}`, email, name: get("name") || undefined },
        });
        const back = new URL(get("redirect_uri"));
        back.searchParams.set("code", code);
        if (get("state")) back.searchParams.set("state", get("state"));
        return new Response(null, { status: 302, headers: { location: back.toString() } });
      }

      if (url.pathname === "/token" && req.method === "POST") {
        state.tokenRequests++;
        const form = new URLSearchParams(await req.text());
        const basic = req.headers.get("authorization")?.match(/^Basic (.+)$/);
        const [basicId, basicSecret] = basic ? Buffer.from(basic[1]!, "base64").toString().split(":").map(decodeURIComponent) : [];
        const id = form.get("client_id") ?? basicId;
        const secret = form.get("client_secret") ?? basicSecret;
        if (id !== clientId || secret !== clientSecret) return Response.json({ error: "invalid_client" }, { status: 401 });

        const pending = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!pending) return Response.json({ error: "invalid_grant", error_description: "unknown or used code" }, { status: 400 });
        if (pending.redirectUri !== form.get("redirect_uri")) return Response.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, { status: 400 });
        const verifier = form.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== pending.codeChallenge) {
          return Response.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
        }

        const override = state.nextIdToken;
        state.nextIdToken = null;
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          iss: issuer,
          aud: clientId,
          sub: pending.user.sub,
          email: pending.user.email,
          email_verified: true,
          ...(pending.user.name ? { name: pending.user.name } : {}),
          ...(pending.nonce ? { nonce: pending.nonce } : {}),
          iat: now,
          exp: now + 300,
          ...override?.claims,
        };
        const idToken = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: jwk.kid! }).sign(override?.signWith ?? privateKey);
        return Response.json({ access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: idToken });
      }

      return new Response("not found", { status: 404 });
    },
  });

  issuer = `http://localhost:${server.port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    state,
    stop: () => server.stop(true),
  };
}

export type MockOidc = Awaited<ReturnType<typeof startMockOidc>>;
