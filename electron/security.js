'use strict';

function parseUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || ''));
  } catch {
    return null;
  }
}

function isTrustedRendererUrl(rawUrl, gatewayUrl) {
  const candidate = parseUrl(rawUrl);
  const gateway = parseUrl(gatewayUrl);
  if (!candidate || !gateway) return false;
  if (candidate.username || candidate.password) return false;
  if (!['http:', 'https:'].includes(candidate.protocol)) return false;
  return candidate.origin === gateway.origin;
}

function isLocalGatewayUrl(rawUrl, gatewayUrl) {
  const candidate = parseUrl(rawUrl);
  const gateway = parseUrl(gatewayUrl);
  if (!candidate || !gateway) return false;
  if (candidate.username || candidate.password) return false;
  if (candidate.protocol !== gateway.protocol) return false;
  const candidatePort = candidate.port || (candidate.protocol === 'https:' ? '443' : '80');
  const gatewayPort = gateway.port || (gateway.protocol === 'https:' ? '443' : '80');
  if (candidatePort !== gatewayPort) return false;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(candidate.hostname || '').toLowerCase());
}

function normalizeExternalUrl(rawUrl) {
  const candidate = parseUrl(rawUrl);
  if (!candidate || !['http:', 'https:'].includes(candidate.protocol)) return null;
  if (candidate.username || candidate.password) return null;
  return candidate.href;
}

function normalizePassthroughExternalUrl(rawUrl) {
  const candidate = parseUrl(rawUrl);
  if (!candidate || !['mailto:', 'tel:'].includes(candidate.protocol)) return null;
  if (/[\r\n]/.test(String(rawUrl || ''))) return null;
  return candidate.href;
}

function normalizeEmbeddedBrowserUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw || raw === 'about:blank') return 'about:blank';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const candidate = parseUrl(withScheme);
  if (!candidate || !['http:', 'https:'].includes(candidate.protocol)) {
    throw new Error('The in-app browser accepts only HTTP or HTTPS URLs.');
  }
  if (candidate.username || candidate.password) {
    throw new Error('URLs containing embedded credentials are not allowed.');
  }
  return candidate.href;
}

function parseWindowsListeningPids(output, port) {
  const wantedPort = Number(port);
  if (!Number.isInteger(wantedPort) || wantedPort < 1 || wantedPort > 65535) return [];
  const pids = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || String(parts[0]).toUpperCase() !== 'TCP') continue;
    if (String(parts[3]).toUpperCase() !== 'LISTENING') continue;
    const localAddress = String(parts[1] || '');
    const portMatch = localAddress.match(/:(\d+)$/);
    const pid = String(parts[parts.length - 1] || '');
    if (!portMatch || Number(portMatch[1]) !== wantedPort || !/^\d+$/.test(pid) || pid === '0') continue;
    pids.add(Number(pid));
  }
  return [...pids];
}

module.exports = {
  isLocalGatewayUrl,
  isTrustedRendererUrl,
  normalizeEmbeddedBrowserUrl,
  normalizeExternalUrl,
  normalizePassthroughExternalUrl,
  parseWindowsListeningPids,
};
