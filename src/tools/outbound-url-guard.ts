/**
 * outbound-url-guard.ts: destination policy for model-driven HTTP fetches.
 *
 * web_fetch, download_url and the page-preview helpers fetch URLs that come
 * from the model, from search results, or from page content. Without a guard,
 * injected instructions (or a public page that 302-redirects) can point those
 * fetches at this machine's own gateway on 127.0.0.1, at the LAN, or at cloud
 * metadata endpoints. The gateway trusts direct loopback requests, so a
 * server-side fetch would act as the owner (security audit 2026-11-06,
 * finding promsrc/web-fetch-loopback-ssrf-gateway-confused-deputy).
 *
 * fetchPublicUrl() resolves the host, rejects loopback, private, link-local,
 * CGNAT, multicast and reserved addresses, and follows redirects manually so
 * every hop is checked again. Set PROMETHEUS_ALLOW_PRIVATE_FETCH=1 to opt a
 * trusted install out (for example, fetching a local dev server).
 *
 * Residual risk: the check resolves DNS, then fetch resolves again. A DNS
 * server that flips between those two lookups can still win the race. Closing
 * that needs a pinned-address dispatcher.
 */
import dns from 'dns';
import net from 'net';

export class OutboundUrlBlockedError extends Error {
  readonly code = 'OUTBOUND_URL_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlBlockedError';
  }
}

export type OutboundGuardOptions = {
  /** Resolve a hostname to IP addresses. Tests inject a stub. */
  lookup?: (host: string) => Promise<string[]>;
  /** fetch implementation. Tests inject a stub. */
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
  allowPrivate?: boolean;
};

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT, Tailscale
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  // 198.18.0.0/15 (benchmarking) is deliberately NOT blocked: fake-IP proxy
  // modes (Clash and similar) answer public hostnames from that range.
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(ipv4ToInt(ip) / size) === Math.floor(ipv4ToInt(base) / size);
}

function expandIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.includes('.')) {
    const idx = s.lastIndexOf(':');
    const v4 = s.slice(idx + 1);
    if (!net.isIPv4(v4)) return null;
    const n = ipv4ToInt(v4);
    s = `${s.slice(0, idx + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const parts = [...head, ...new Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved, or unparseable addresses. */
export function isBlockedAddress(raw: string): boolean {
  const ip = String(raw || '').trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return V4_BLOCKED.some(([base, bits]) => inV4Range(ip, base, bits));
  if (net.isIPv6(ip)) {
    const h = expandIPv6(ip);
    if (!h) return true;
    const v4 = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
      if (h[5] === 0 && h[6] === 0 && h[7] <= 1) return true; // :: and ::1
      return isBlockedAddress(v4); // IPv4-mapped / IPv4-compatible
    }
    if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(v4); // NAT64
    if (h[0] === 0x2002) return isBlockedAddress(`${h[1] >> 8}.${h[1] & 255}.${h[2] >> 8}.${h[2] & 255}`); // 6to4
    if ((h[0] & 0xffc0) === 0xfec0) return true; // deprecated site-local
    if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local
    if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local
    if ((h[0] & 0xff00) === 0xff00) return true; // multicast
    if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true;
}

/** True for local names (localhost, *.local, *.internal) and loopback/private IP literals. No DNS. */
export function isLocalHostname(hostname: string): boolean {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  return net.isIP(host) ? isBlockedAddress(host) : false;
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dns.promises.lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

function privateFetchAllowed(opts: OutboundGuardOptions): boolean {
  return opts.allowPrivate === true || process.env.PROMETHEUS_ALLOW_PRIVATE_FETCH === '1';
}

/** Throws OutboundUrlBlockedError unless the URL is http(s) and its host resolves only to public addresses. */
export async function assertPublicUrl(rawUrl: string, opts: OutboundGuardOptions = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    throw new OutboundUrlBlockedError(`Invalid URL: ${String(rawUrl || '').slice(0, 200)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new OutboundUrlBlockedError(`Only http(s) URLs can be fetched (got ${u.protocol}).`);
  }
  if (privateFetchAllowed(opts)) return u;

  const blocked = (detail: string) => new OutboundUrlBlockedError(
    `Blocked fetch to ${u.host}: ${detail}. Fetch tools only reach public internet addresses; use the browser tools for local or private-network pages.`,
  );
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw blocked(`${host} is a loopback, private, or link-local address`);
    return u;
  }
  if (isLocalHostname(host)) throw blocked('local hostname');
  let addresses: string[];
  try {
    addresses = await (opts.lookup ?? defaultLookup)(host);
  } catch (err: any) {
    throw new OutboundUrlBlockedError(`Could not resolve ${host}: ${err?.code || err?.message || err}`);
  }
  if (!addresses.length) throw new OutboundUrlBlockedError(`Could not resolve ${host}.`);
  const bad = addresses.find(isBlockedAddress);
  if (bad) throw blocked(`${host} resolves to ${bad}, a loopback, private, or link-local address`);
  return u;
}

/**
 * fetch() for untrusted URLs. Checks the destination before every request,
 * including each redirect hop, and never lets fetch follow a redirect itself.
 */
export async function fetchPublicUrl(input: string, init: RequestInit = {}, opts: OutboundGuardOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = Math.max(0, opts.maxRedirects ?? 10);
  let url = String(input || '').trim();
  let method = init.method;
  let body = init.body;
  let headers = init.headers;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicUrl(url, opts);
    const res = await fetchImpl(url, { ...init, method, body, headers, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    try { await res.body?.cancel(); } catch { /* ignore */ }
    const upper = String(method || 'GET').toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && upper === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    const next = new URL(location, url);
    // Like native fetch: never carry credentials to a different origin.
    if (headers && next.origin !== new URL(url).origin) {
      const copy = new Headers(headers);
      for (const name of ['authorization', 'cookie', 'proxy-authorization']) copy.delete(name);
      headers = copy;
    }
    url = next.toString();
  }
  throw new OutboundUrlBlockedError(`Too many redirects (more than ${maxRedirects}) starting at ${String(input).slice(0, 200)}.`);
}
