import { lookup } from "dns/promises";
import { isIP } from "net";
import { env } from "./env";

/**
 * Outbound requests to URLs supplied by org admins (SSO issuers) must not be
 * usable to reach internal services or cloud metadata endpoints (SSRF).
 * Every request — including each redirect hop, which we don't follow
 * automatically — is checked against the resolved addresses.
 */
export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      lower === "::" ||
      lower === "::1" ||
      /^f[cd][0-9a-f]{2}:/.test(lower) || // unique local fc00::/7
      /^fe[89ab][0-9a-f]:/.test(lower) || // link-local fe80::/10
      /^ff[0-9a-f]{2}:/.test(lower) // multicast
    );
  }
  return true;
}

export type HostResolver = (hostname: string) => Promise<string[]>;
let resolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** Tests swap the resolver to exercise the private-address checks without real DNS. */
export function setHostResolver(fn: HostResolver | null) {
  resolver = fn ?? (async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address));
}

export async function assertSafeUrl(raw: string | URL) {
  const url = typeof raw === "string" ? new URL(raw) : raw;
  const { SSO_ALLOW_HTTP_ISSUERS, SSO_ALLOW_PRIVATE_NETWORK } = env();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && SSO_ALLOW_HTTP_ISSUERS === "true")) {
    throw new UnsafeUrlError("Only https:// URLs are allowed");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs can't contain credentials");
  if (SSO_ALLOW_PRIVATE_NETWORK === "true") return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolver(host);
  } catch {
    throw new UnsafeUrlError(`Couldn't resolve ${host}`);
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError(`${host} resolves to a private or reserved address`);
  }
}

/** fetch() for admin-supplied URLs: address checks, no automatic redirects, a timeout and a response size cap. */
export async function guardedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof Request ? input.url : input;
  await assertSafeUrl(url);
  const res = await fetch(input, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(10_000) });
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > 1024 * 1024) throw new UnsafeUrlError("Response too large");
  return res;
}
