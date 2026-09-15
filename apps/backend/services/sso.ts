import * as oidc from "openid-client";
import type { SsoConnection } from "db/client";
import { env } from "../lib/env";
import { redis } from "../lib/redis";
import { decryptSecret } from "../lib/crypto";
import { guardedFetch, UnsafeUrlError } from "../lib/netGuard";
import { randomToken, sha256 } from "../lib/tokens";

/**
 * OpenID Connect (authorization code + PKCE) against an organisation's
 * identity provider. openid-client does the protocol work — discovery, ID
 * token signature (JWKS), issuer, audience, expiry and nonce checks — and all
 * of its HTTP goes through guardedFetch, since issuer URLs come from org admins.
 */
export const SSO_STATE_TTL_SEC = 10 * 60;
export const SSO_STATE_COOKIE = "perigo_sso_state";

export class SsoError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export const callbackUrl = () => `${env().API_PUBLIC_URL.replace(/\/$/, "")}/auth/sso/callback`;

const safeFetch: oidc.CustomFetch = (url, options) => guardedFetch(url, options as RequestInit);

function discoveryOptions(): oidc.DiscoveryRequestOptions {
  return {
    [oidc.customFetch]: safeFetch,
    timeout: 10,
    execute: [
      // OIDC lets clients skip the ID token signature when it arrives straight from the token
      // endpoint over TLS; we verify it against the IdP's JWKS anyway (defence in depth).
      oidc.enableNonRepudiationChecks,
      ...(env().SSO_ALLOW_HTTP_ISSUERS === "true" ? [oidc.allowInsecureRequests] : []),
    ],
  };
}

/** openid-client wraps errors from our fetch; find an SSRF rejection anywhere in the cause chain. */
function unsafeUrlCause(err: unknown): UnsafeUrlError | null {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof UnsafeUrlError) return e;
  }
  return null;
}

export async function discover(issuer: string, clientId: string, clientSecret: string) {
  try {
    return await oidc.discovery(new URL(issuer), clientId, { client_secret: clientSecret }, oidc.ClientSecretPost(clientSecret), discoveryOptions());
  } catch (err) {
    const unsafe = unsafeUrlCause(err);
    if (unsafe) throw new SsoError("UNSAFE_ISSUER", unsafe.message);
    throw new SsoError("DISCOVERY_FAILED", `Couldn't load the OpenID configuration from ${issuer}: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

// Discovery documents are cached per connection version (updatedAt), so edits take effect immediately.
const configs = new Map<string, Promise<oidc.Configuration>>();

function configFor(conn: SsoConnection) {
  const cacheKey = `${conn.id}:${conn.updatedAt.getTime()}`;
  let config = configs.get(cacheKey);
  if (!config) {
    for (const key of configs.keys()) if (key.startsWith(`${conn.id}:`)) configs.delete(key);
    config = discover(conn.issuer, conn.clientId, decryptSecret(conn.clientSecret));
    config.catch(() => configs.delete(cacheKey));
    configs.set(cacheKey, config);
  }
  return config;
}

export function clearSsoConfigCache() {
  configs.clear();
}

export interface SsoState {
  connectionId: string;
  mode: "login" | "test";
  codeVerifier: string;
  nonce: string;
  /** Relative path to return to after signing in. */
  next: string;
  /** For test mode: the owner who started it. */
  userId?: string;
}

const stateKey = (state: string) => `sso:state:${sha256(state)}`;

/** Builds the redirect to the identity provider and remembers the PKCE verifier and nonce server-side. */
export async function beginSso(conn: SsoConnection, opts: { mode: SsoState["mode"]; next: string; userId?: string; loginHint?: string }) {
  const config = await configFor(conn);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = randomToken();
  const value: SsoState = {
    connectionId: conn.id,
    mode: opts.mode,
    codeVerifier,
    nonce: oidc.randomNonce(),
    next: opts.next,
    ...(opts.userId ? { userId: opts.userId } : {}),
  };
  await redis().set(stateKey(state), JSON.stringify(value), "EX", SSO_STATE_TTL_SEC);

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(),
    scope: "openid email profile",
    response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce: value.nonce,
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    ...(opts.mode === "test" ? { prompt: "login" } : {}),
  });
  return { url: url.toString(), state };
}

/** Single use. */
export async function takeSsoState(state: string): Promise<SsoState | null> {
  if (state.length < 20 || state.length > 128) return null;
  const raw = await redis().getdel(stateKey(state));
  return raw ? (JSON.parse(raw) as SsoState) : null;
}

export interface SsoClaims {
  subject: string;
  email: string;
  name: string | null;
}

/** Exchanges the code and validates the ID token. `query` is the callback's raw query string. */
export async function completeSso(conn: SsoConnection, state: string, saved: SsoState, query: string): Promise<SsoClaims> {
  const config = await configFor(conn);
  let tokens;
  try {
    tokens = await oidc.authorizationCodeGrant(config, new URL(`${callbackUrl()}?${query}`), {
      pkceCodeVerifier: saved.codeVerifier,
      expectedNonce: saved.nonce,
      expectedState: state,
      idTokenExpected: true,
    });
  } catch (err) {
    if (err instanceof oidc.AuthorizationResponseError) throw new SsoError("IDP_ERROR", `The identity provider returned an error: ${err.error}`);
    throw new SsoError("TOKEN_EXCHANGE_FAILED", err instanceof Error ? err.message : "Token exchange failed");
  }
  const claims = tokens.claims();
  if (!claims?.sub) throw new SsoError("INVALID_ID_TOKEN", "The ID token has no subject");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SsoError("NO_EMAIL", "The identity provider didn't share an email address (request the email scope)");
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : null;
  return { subject: String(claims.sub), email, name };
}
