const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const PASSTHROUGH_PROTOCOLS = new Set(['mailto:', 'tel:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const PROMETHEUS_GATEWAY_ORIGIN = 'http://127.0.0.1:18789';

function parseUrl(rawUrl, baseUrl) {
  try {
    return new URL(String(rawUrl || ''), String(baseUrl || PROMETHEUS_GATEWAY_ORIGIN));
  } catch {
    return null;
  }
}

function normalizedPort(url) {
  if (!url) return '';
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

export function isLocalGatewayUrl(rawUrl, gatewayOrigin = PROMETHEUS_GATEWAY_ORIGIN) {
  const candidate = parseUrl(rawUrl, gatewayOrigin);
  const gateway = parseUrl(gatewayOrigin, gatewayOrigin);
  if (!candidate || !gateway || !HTTP_PROTOCOLS.has(candidate.protocol) || !HTTP_PROTOCOLS.has(gateway.protocol)) return false;
  if (candidate.protocol !== gateway.protocol || normalizedPort(candidate) !== normalizedPort(gateway)) return false;
  return LOOPBACK_HOSTS.has(String(candidate.hostname || '').toLowerCase());
}

export function normalizePrometheusLink(rawUrl, options = {}) {
  const raw = String(rawUrl || '').trim();
  const baseUrl = String(options.baseUrl || globalThis?.location?.href || `${PROMETHEUS_GATEWAY_ORIGIN}/`);
  if (!raw) return { kind: 'ignored', reason: 'empty', url: '' };

  const parsed = parseUrl(raw, baseUrl);
  if (!parsed) return { kind: 'blocked', reason: 'invalid_url', url: '' };

  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol === 'file:') {
    // Local files are intentionally outside the Prometheus Browser contract.
    // Leave the anchor's existing file-flow/default behavior untouched; the
    // Electron main-process boundary still rejects unsafe file navigation.
    return { kind: 'ignored', reason: 'file_path', scheme: protocol, url: parsed.href };
  }
  if (protocol === 'javascript:' && options.allowExplicitSafeFlow === true
    && /^javascript:\s*(?:void\s*\(\s*0\s*\)|;)\s*$/i.test(raw)) {
    // A small number of trusted legacy controls use javascript:void(0) only
    // as an anchor placeholder and keep the real action in onclick. Preserve
    // that existing explicit safe flow instead of turning it into a link
    // routing error.
    return { kind: 'ignored', reason: 'explicit_safe_flow', scheme: protocol, url: raw };
  }
  if (protocol === 'javascript:' || protocol === 'data:') {
    return { kind: 'blocked', reason: 'unsafe_scheme', scheme: protocol, url: '' };
  }
  if (PASSTHROUGH_PROTOCOLS.has(protocol)) {
    return { kind: 'passthrough', reason: 'external_protocol', scheme: protocol, url: parsed.href };
  }
  if (!HTTP_PROTOCOLS.has(protocol)) {
    return { kind: 'ignored', reason: 'unsupported_scheme', scheme: protocol, url: parsed.href };
  }
  if (parsed.username || parsed.password) {
    return { kind: 'blocked', reason: 'embedded_credentials', scheme: protocol, url: '' };
  }

  let currentOrigin = null;
  try { currentOrigin = new URL(String(options.currentOrigin || globalThis?.location?.origin || baseUrl)); } catch {}
  const sameOrigin = !!currentOrigin && parsed.origin === currentOrigin.origin;
  const localGateway = isLocalGatewayUrl(parsed.href, String(options.gatewayOrigin || PROMETHEUS_GATEWAY_ORIGIN));
  return {
    kind: sameOrigin || localGateway ? 'internal' : 'external',
    reason: sameOrigin ? 'same_origin' : (localGateway ? 'local_gateway' : 'external_http_url'),
    scheme: protocol,
    url: parsed.href,
    origin: parsed.origin,
    host: parsed.hostname,
  };
}

export function choosePrometheusBrowserLane({
  electron = false,
  inhouseAvailable = false,
  browserTarget = '',
  profileKind = '',
} = {}) {
  const target = String(browserTarget || profileKind || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (electron && inhouseAvailable) return 'inhouse';
  if (target === 'inhouse' || target === 'in_house' || target === 'electron' || target === 'prometheus_inhouse' || target === 'prometheus_in_house') {
    return inhouseAvailable ? 'inhouse' : 'prometheus';
  }
  // user/user_chrome is deliberately not returned here. UI link routing must
  // never silently claim a personal Chrome tab.
  return 'prometheus';
}

export function classifyPrometheusLink({
  href,
  rawUrl,
  baseUrl,
  currentOrigin,
  gatewayOrigin,
  download = false,
  explicitExternal = false,
  allowExplicitSafeFlow = false,
} = {}) {
  if (download) return { kind: 'ignored', reason: 'download', url: '' };
  const normalized = normalizePrometheusLink(rawUrl ?? href, {
    baseUrl,
    currentOrigin,
    gatewayOrigin,
    allowExplicitSafeFlow,
  });
  if (normalized.kind !== 'external') return normalized;
  if (explicitExternal) return { ...normalized, kind: 'external', reason: 'explicit_external' };
  return { ...normalized, decision: 'prometheus_browser' };
}
