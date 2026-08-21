/**
 * Pairing router — REST endpoints powering the desktop "Settings → Pairing"
 * panel and the mobile-PWA pairing flow.
 *
 * Public summary:
 *   POST /api/pairing/qr            (desktop) start a challenge, return SVG QR
 *   POST /api/pairing/claim         (mobile)  claim a QR challenge code
 *   GET  /api/pairing/poll/:reqId   (mobile)  poll for approval / token
 *   GET  /api/pairing/pending       (desktop) list claims waiting on approval
 *   POST /api/pairing/approve       (desktop) approve a pending claim
 *   POST /api/pairing/deny          (desktop) deny a pending claim
 *   GET  /api/pairing/devices       (desktop) list paired devices
 *   PATCH /api/pairing/devices/:id  (desktop) toggle enabled / rename
 *   DELETE /api/pairing/devices/:id (desktop) revoke (remove) a device
 *   GET  /api/pairing/me            (mobile)  return identity for the device
 *                                             behind the supplied token
 *
 * Only certificate, claim, poll, bounded catalog, and /me are public/mobile-
 * facing. Challenge creation, approval, device management, and remote-access
 * operations require a separate trusted desktop authority that paired-device
 * tokens cannot use.
 */

import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import * as QRCode from 'qrcode';
import { getConfig, getAgents } from '../../config/config';
import {
  createPairingChallenge, getChallengeByCode,
  createPendingRequest, findRequestForChallengeClaim, getPendingRequest, listPendingRequests,
  approvePendingRequest, denyPendingRequest, consumePendingRequestToken,
  listPairedDevices, setDeviceEnabled, removeDevice, renameDevice,
  verifyDeviceToken,
} from '../pairing/pairing-store';
import { broadcastWS } from '../comms/broadcaster';
import { requirePairingAdmin } from '../pairing/pairing-admin-auth';
import { getGatewayDescriptor } from '../gateway-identity';
import { listSessionSummaries, searchSessionSummaries } from '../session';
import { listTaskSummaries } from '../tasks/task-store';

export const router: Router = Router();
const MOBILE_GATEWAY_CATALOG_ENABLED = process.env.PROMETHEUS_MOBILE_GATEWAY_CATALOG !== '0';

function _isLoopbackHost(host: string): boolean {
  const value = String(host || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function _splitHostHeader(hostHeader: string): { hostname: string; port: string } {
  const raw = String(hostHeader || '').trim();
  if (!raw) return { hostname: '', port: '' };
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    const hostname = end >= 0 ? raw.slice(1, end) : raw;
    const port = end >= 0 && raw.slice(end + 1).startsWith(':') ? raw.slice(end + 2) : '';
    return { hostname, port };
  }
  const idx = raw.lastIndexOf(':');
  if (idx > -1 && raw.indexOf(':') === idx) return { hostname: raw.slice(0, idx), port: raw.slice(idx + 1) };
  return { hostname: raw, port: '' };
}

function _lanIPv4Addresses(): string[] {
  const out: string[] = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue;
      const address = String(entry.address || '').trim();
      if (!address || address.startsWith('169.254.')) continue;
      out.push(address);
    }
  }
  return [...new Set(out)];
}

function _originLooksSafe(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.host;
  } catch {
    return false;
  }
}

async function _resolvePairingOrigin(req: any, overrideOrigin: string): Promise<{
  origin: string;
  bindHost: string;
  lanOrigins: string[];
  warning?: string;
  remoteAccessActive: boolean;
}> {
  const cfg = getConfig().getConfig() as any;
  const httpsCfg = cfg?.gateway?.https || {};
  const preferHttps = !!httpsCfg?.enabled && Number(httpsCfg?.port || 0) > 0;
  const protocolHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = preferHttps ? 'https' : (protocolHeader || (req.secure ? 'https' : 'http'));
  const hostHeader = String(req.headers.host || req.get?.('host') || '').trim();
  const { hostname, port } = _splitHostHeader(hostHeader);
  const fallbackPort = preferHttps
    ? String(httpsCfg.port)
    : (port || String(cfg?.gateway?.port || 18789));
  const fallbackHost = hostname
    ? `${hostname.includes(':') ? `[${hostname}]` : hostname}:${fallbackPort}`
    : `localhost:${fallbackPort}`;
  const fallbackOrigin = `${proto}://${fallbackHost}`;
  const bindHost = String(cfg?.gateway?.host || '').trim() || '127.0.0.1';
  const lanOrigins = _lanIPv4Addresses().map(ip => `${proto}://${ip}:${fallbackPort}`);

  if (overrideOrigin && _originLooksSafe(overrideOrigin)) {
    return { origin: overrideOrigin, bindHost, lanOrigins, remoteAccessActive: false };
  }

  // Remote access: when enabled with a valid public URL (e.g. Tailscale Funnel),
  // use it as the pairing origin so the phone can reach the gateway off-LAN.
  // The local LAN URL is still returned in `lanOrigins` for visibility.
  const ra = cfg?.gateway?.remoteAccess;
  if (ra && ra.enabled && typeof ra.publicUrl === 'string') {
    const publicUrl = ra.publicUrl.trim();
    const mode = String(ra.mode || 'tailscale-funnel');
    // A saved Funnel URL is not proof that Funnel is currently serving. If
    // Tailscale was turned off, fall back to the LAN origin instead of putting
    // a dead *.ts.net address in the QR code.
    const remoteActive = publicUrl && _originLooksSafe(publicUrl)
      ? mode !== 'tailscale-funnel' || await _isFunnelActiveOnPort(_gatewayPort())
      : false;
    if (remoteActive) {
      return { origin: publicUrl.replace(/\/+$/, ''), bindHost, lanOrigins, remoteAccessActive: true };
    }
  }

  const isWildcard = bindHost === '0.0.0.0' || bindHost === '::';
  if (_isLoopbackHost(hostname) && isWildcard && lanOrigins.length) {
    return { origin: lanOrigins[0], bindHost, lanOrigins, remoteAccessActive: false };
  }

  const warning = _isLoopbackHost(hostname)
    ? isWildcard
      ? 'No LAN IPv4 address was detected; phone pairing may not be reachable.'
      : 'Gateway is bound to loopback only. Set gateway.host to 0.0.0.0 and restart to pair from a phone.'
    : (preferHttps ? 'Mobile microphone capture requires HTTPS. If Safari warns about the certificate, install and trust the Prometheus local certificate from desktop Settings.' : undefined);
  return { origin: fallbackOrigin, bindHost, lanOrigins, warning, remoteAccessActive: false };
}

function _requirePairedDevice(req: any, res: any): any | null {
  const token = String(req.headers?.['x-pairing-token'] || '').trim();
  if (!token) {
    res.status(401).json({ success: false, error: 'A paired-device header is required.' });
    return null;
  }
  const device = verifyDeviceToken(token, {
    ipHint: _ipHintFromReq(req),
    userAgent: String(req.headers?.['user-agent'] || ''),
  });
  if (!device) {
    res.status(401).json({ success: false, error: 'Invalid or revoked device token.' });
    return null;
  }
  return device;
}

function _safeCatalogSession(session: any): Record<string, unknown> {
  const externalImport = session?.externalImport && typeof session.externalImport === 'object'
    ? session.externalImport
    : null;
  const externalSource = externalImport?.source && typeof externalImport.source === 'object'
    ? externalImport.source
    : null;
  return {
    id: String(session?.id || '').trim(),
    channel: String(session?.channel || '').trim(),
    createdAt: Number(session?.createdAt || 0) || 0,
    lastActiveAt: Number(session?.lastActiveAt || 0) || 0,
    lastMessageAt: Number(session?.lastMessageAt || 0) || undefined,
    lastAssistantAt: Number(session?.lastAssistantAt || 0) || undefined,
    pinnedAt: Number(session?.pinnedAt || 0) || undefined,
    sidebarOrder: Number(session?.sidebarOrder || 0) || undefined,
    settledAt: Number(session?.settledAt || 0) || undefined,
    settled: session?.settled === true,
    mobileUnread: session?.mobileUnread === true,
    activeRun: session?.activeRun === true,
    messageCount: Number(session?.messageCount || 0) || 0,
    title: String(session?.title || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 240),
    // The mobile drawer needs the same compact last-message preview as the
    // local session list. Keep it bounded and text-only; never expose history.
    preview: String(session?.preview || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    // Preserve only the compact, non-secret provenance needed by the mobile
    // sidebar to render a packaged source mark. Transcript content and source
    // filesystem details remain excluded from this cross-origin catalog.
    ...(externalImport && externalSource ? {
      externalImport: {
        version: 1,
        source: {
          provider: String(externalSource.provider || '').trim().slice(0, 80),
          adapter: String(externalSource.adapter || '').trim().slice(0, 120),
          sourceLabel: String(externalSource.sourceLabel || '').trim().slice(0, 120),
        },
        continuation: 'prometheus',
        sourceResume: 'unsupported',
        importedAt: String(externalImport.importedAt || '').slice(0, 40),
      },
    } : {}),
    // Deliberately omit preview, history, workspace paths, project roots,
    // goals, and tool/runtime fields from the cross-origin catalog.
  };
}

function _safeCatalogAgent(agent: any): Record<string, unknown> {
  return {
    id: String(agent?.id || '').trim(),
    name: String(agent?.name || agent?.label || agent?.id || 'Agent').replace(/\s+/g, ' ').trim().slice(0, 160),
    description: String(agent?.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    default: agent?.default === true,
    role: String(agent?.role || '').trim().slice(0, 40),
    isTeamMember: agent?.isTeamMember === true,
    isTeamManager: agent?.isTeamManager === true,
    teamId: String(agent?.teamId || '').trim().slice(0, 120) || null,
    teamName: String(agent?.teamName || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
  };
}

function _safeCatalogTask(task: any): Record<string, unknown> {
  return {
    id: String(task?.id || '').trim(),
    title: String(task?.title || 'Task').replace(/\s+/g, ' ').trim().slice(0, 240),
    sessionId: String(task?.sessionId || '').trim(),
    channel: String(task?.channel || '').trim(),
    status: String(task?.status || '').trim().slice(0, 60),
    startedAt: Number(task?.startedAt || 0) || undefined,
    completedAt: Number(task?.completedAt || 0) || undefined,
    lastProgressAt: Number(task?.lastProgressAt || 0) || undefined,
    scheduleId: String(task?.scheduleId || '').trim().slice(0, 120) || null,
    taskKind: String(task?.taskKind || '').trim().slice(0, 80) || null,
    verificationStatus: String(task?.verificationStatus || '').trim().slice(0, 80) || null,
  };
}

function _ipHintFromReq(req: any): string {
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.ip || req.socket?.remoteAddress || '');
}

function _publicDevice(d: any) {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    enabled: d.enabled,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    lastIpHint: d.lastIpHint,
    lastUserAgent: d.lastUserAgent,
  };
}

function _publicRequest(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    deviceName: r.deviceName,
    userAgent: r.userAgent,
    ipHint: r.ipHint,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    status: r.status,
  };
}

function _base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

// ── desktop: create a fresh challenge + QR ────────────────────────────────
router.post('/api/pairing/qr', requirePairingAdmin, async (req, res) => {
  try {
    // Allow the desktop to override the host (e.g. when pairing across LAN
    // and the gateway is reached via a different hostname than req.host).
    const overrideOrigin = typeof req.body?.origin === 'string' ? String(req.body.origin).trim() : '';
    const pairingOrigin = await _resolvePairingOrigin(req, overrideOrigin);
    const origin = pairingOrigin.origin;

    const challenge = createPairingChallenge();
    const gateway = getGatewayDescriptor(origin);
    // This payload contains only a short-lived, one-time challenge handle and
    // public target metadata. It is not a credential and must never be reused
    // as an API token.
    const pairingPayload = _base64UrlJson({
      version: 1,
      audience: 'prometheus-mobile-pairing',
      gatewayId: gateway.gatewayId,
      origin,
      challenge: challenge.code,
      expiresAt: challenge.expiresAt,
      name: gateway.name,
      platform: gateway.platform,
      gatewayVersion: gateway.version,
    });
    const pairUrl = `${origin}/?pair=${encodeURIComponent(pairingPayload)}#mobile/pair`;

    const svg = await QRCode.toString(pairUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      // Keep a full quiet zone and fit the 320px pairing card's 288px content
      // box. The old 320px / margin-1 SVG was prone to sub-pixel scaling and
      // failed the bundled decoder on common camera resolutions.
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      width: 288,
    });

    const cfg = getConfig().getConfig() as any;
    const ra = cfg?.gateway?.remoteAccess;
    res.json({
      success: true,
      challengeId: challenge.id,
      pairCode: challenge.humanCode,
      pairUrl,
      pairingOrigin: origin,
      bindHost: pairingOrigin.bindHost,
      lanOrigins: pairingOrigin.lanOrigins,
      warning: pairingOrigin.warning,
      remoteAccess: pairingOrigin.remoteAccessActive
        ? { active: true, mode: String(ra.mode || 'custom'), publicUrl: String(ra.publicUrl).trim() }
        : { active: false },
      expiresAt: challenge.expiresAt,
      gateway,
      qrSvg: svg,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

// ── mobile: phone claims a QR challenge ──────────────────────────────────
router.get('/api/pairing/certificate', (_req, res) => {
  const cfg = getConfig();
  const httpsCfg = (cfg.getConfig() as any)?.gateway?.https || {};
  const pfxPath = String(httpsCfg.pfxPath || '').trim();
  const certPath = String(httpsCfg.certPath || '').trim()
    || (pfxPath ? pfxPath.replace(/\.pfx$/i, '.cer') : 'certs/gateway-mobile.cer');
  const resolved = path.isAbsolute(certPath) ? certPath : path.resolve(cfg.getConfigDir(), certPath);
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ success: false, error: 'Pairing certificate not found.' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="prometheus-local-gateway.cer"');
  fs.createReadStream(resolved).pipe(res);
});

router.post('/api/pairing/claim', (req, res) => {
  try {
    // The QR is a one-time challenge handle, not an account credential. The
    // target desktop's explicit Allow/Deny decision is the enrollment gate;
    // requiring a cookie-bound account here would prevent a phone from pairing
    // to a second independent gateway on another origin. Account/session
    // authorization still protects all post-pairing API surfaces.
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ success: false, error: 'code required' });
    const ch = getChallengeByCode(code);
    if (!ch)               return res.status(404).json({ success: false, error: 'Challenge not found or expired.' });
    if (ch.expiresAt < Date.now()) return res.status(410).json({ success: false, error: 'QR code expired. Generate a new one.' });

    const claim = {
      challengeId: ch.id,
      deviceName: String(req.body?.deviceName || 'Mobile device'),
      deviceFingerprint: String(req.body?.deviceFingerprint || ''),
      userAgent: String(req.headers['user-agent'] || ''),
      ipHint: _ipHintFromReq(req),
    };

    if (ch.claimed) {
      const existing = findRequestForChallengeClaim(claim);
      if (existing) {
        return res.json({
          success: true,
          requestId: existing.id,
          expiresAt: existing.expiresAt,
          status: existing.status,
          resumed: true,
          gateway: getGatewayDescriptor(),
        });
      }
      return res.status(409).json({ success: false, error: 'This QR code has already been used.' });
    }

    const r = createPendingRequest(claim);

    broadcastWS({ type: 'pairing_pending', requestId: r.id, deviceName: r.deviceName, createdAt: r.createdAt });

    res.json({ success: true, requestId: r.id, expiresAt: r.expiresAt, gateway: getGatewayDescriptor() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

// ── mobile: poll for approval ────────────────────────────────────────────
router.get('/api/pairing/poll/:id', (req, res) => {
  const id = String(req.params.id || '');
  const r = getPendingRequest(id);
  if (!r) return res.status(404).json({ success: false, status: 'not_found' });
  // The request id is not itself a bearer credential. Bind token delivery to
  // the fingerprint that claimed the one-time challenge; legacy clients that
  // did not send one must still match their claim's user-agent/IP hint.
  const presentedFingerprint = String(req.headers['x-pairing-device-fingerprint'] || '').slice(0, 120);
  const presentedUserAgent = String(req.headers['user-agent'] || '').slice(0, 240);
  const presentedIpHint = _ipHintFromReq(req);
  if (r.deviceFingerprint && presentedFingerprint !== r.deviceFingerprint) {
    return res.status(403).json({ success: false, status: 'wrong_device' });
  }
  if (!r.deviceFingerprint && (presentedUserAgent !== r.userAgent || presentedIpHint !== r.ipHint)) {
    return res.status(403).json({ success: false, status: 'wrong_device' });
  }
  if (r.status === 'approved') {
    const token = consumePendingRequestToken(id);
    if (token) {
      return res.json({
        success: true,
        status: 'approved',
        deviceId: r.deviceId,
        deviceToken: token,
        gateway: getGatewayDescriptor(),
      });
    }
    return res.json({ success: true, status: 'approved_already_collected' });
  }
  if (r.status === 'denied')  return res.json({ success: true, status: 'denied' });
  if (r.status === 'expired') return res.json({ success: false, status: 'expired' });
  res.json({ success: true, status: 'pending' });
});

// ── desktop: list pending claims ─────────────────────────────────────────
router.get('/api/pairing/pending', requirePairingAdmin, (_req, res) => {
  res.json({ success: true, requests: listPendingRequests().map(_publicRequest) });
});

// ── desktop: approve / deny ──────────────────────────────────────────────
router.post('/api/pairing/approve', requirePairingAdmin, (req, res) => {
  const id   = String(req.body?.requestId || '');
  const name = req.body?.deviceName ? String(req.body.deviceName) : undefined;
  const result = approvePendingRequest(id, name);
  if (!result) return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
  broadcastWS({ type: 'pairing_approved', requestId: result.request.id, deviceId: result.device.id });
  res.json({ success: true, device: _publicDevice(result.device) });
});

router.post('/api/pairing/deny', requirePairingAdmin, (req, res) => {
  const id = String(req.body?.requestId || '');
  const ok = denyPendingRequest(id);
  if (!ok) return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
  broadcastWS({ type: 'pairing_denied', requestId: id });
  res.json({ success: true });
});

// ── desktop: device management ───────────────────────────────────────────
router.get('/api/pairing/devices', requirePairingAdmin, (_req, res) => {
  res.json({ success: true, devices: listPairedDevices().map(_publicDevice) });
});

router.patch('/api/pairing/devices/:id', requirePairingAdmin, (req, res) => {
  const id = String(req.params.id || '');
  let changed = false;
  if (typeof req.body?.enabled === 'boolean') changed = setDeviceEnabled(id, req.body.enabled) || changed;
  if (typeof req.body?.name === 'string') changed = renameDevice(id, req.body.name) || changed;
  if (!changed) return res.status(404).json({ success: false, error: 'Device not found or nothing to update.' });
  broadcastWS({ type: 'pairing_device_changed', deviceId: id });
  res.json({ success: true });
});

router.delete('/api/pairing/devices/:id', requirePairingAdmin, (req, res) => {
  const id = String(req.params.id || '');
  const ok = removeDevice(id);
  if (!ok) return res.status(404).json({ success: false, error: 'Device not found.' });
  broadcastWS({ type: 'pairing_device_removed', deviceId: id });
  res.json({ success: true });
});

// ── remote access (Tailscale Funnel) ─────────────────────────────────────
//
// Opt-in layer that lets the QR encode a public HTTPS URL (e.g. a Tailscale
// Funnel address) instead of a LAN IP, so phones can pair from anywhere.
// The local LAN flow is preserved — remote access is purely additive and
// only used when explicitly enabled.

function _runTailscaleCli(args: string[], timeoutMs: number = 4000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      // Lazy require so tests / non-Node environments don't blow up.
      // tslint:disable-next-line:no-var-requires
      const { spawn } = require('child_process') as typeof import('child_process');
      const configured = String(process.env.PROMETHEUS_TAILSCALE_BIN || '').trim();
      const installedCandidates = process.platform === 'darwin'
        ? [
          '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
          path.join(os.homedir(), 'Applications/Tailscale.app/Contents/MacOS/Tailscale'),
        ]
        : process.platform === 'win32'
          ? [
            path.join(String(process.env.ProgramFiles || ''), 'Tailscale', 'tailscale.exe'),
            path.join(String(process.env.LOCALAPPDATA || ''), 'Tailscale', 'tailscale.exe'),
          ]
          : [];
      const tailscaleBin = [configured, ...installedCandidates].find((candidate) => candidate && fs.existsSync(candidate)) || 'tailscale';
      const proc = spawn(tailscaleBin, args, { windowsHide: true });
      let stdout = ''; let stderr = ''; let done = false;
      const finish = (code: number) => { if (done) return; done = true; resolve({ code, stdout, stderr }); };
      proc.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
      proc.on('error', () => finish(-1));
      proc.on('close', (code) => finish(typeof code === 'number' ? code : 0));
      setTimeout(() => { try { proc.kill(); } catch {} finish(-2); }, timeoutMs);
    } catch {
      resolve({ code: -1, stdout: '', stderr: '' });
    }
  });
}

function _publicRemoteAccess() {
  const cfg = getConfig().getConfig() as any;
  const ra = (cfg?.gateway?.remoteAccess && typeof cfg.gateway.remoteAccess === 'object')
    ? cfg.gateway.remoteAccess
    : { enabled: false, mode: 'tailscale-funnel', publicUrl: '' };
  const publicUrl = String(ra.publicUrl || '').trim();
  return {
    enabled: !!ra.enabled,
    mode: String(ra.mode || 'tailscale-funnel'),
    publicUrl,
    valid: !!publicUrl && _originLooksSafe(publicUrl),
  };
}

function _funnelHttpsPort(): number {
  const cfg = getConfig().getConfig() as any;
  const publicUrl = String(cfg?.gateway?.remoteAccess?.publicUrl || '').trim();
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol === 'https:' && parsed.port) {
      const port = Number(parsed.port);
      if ([443, 8443, 10000].includes(port)) return port;
    }
  } catch {}
  return 443;
}

function _funnelHttpsPortIsExplicit(): boolean {
  const cfg = getConfig().getConfig() as any;
  const publicUrl = String(cfg?.gateway?.remoteAccess?.publicUrl || '').trim();
  try {
    const parsed = new URL(publicUrl);
    return parsed.protocol === 'https:' && !!parsed.port;
  } catch {
    return false;
  }
}

type FunnelRoute = { httpsPort: number; targetPorts: number[] };

function _parseFunnelRoutes(raw: string): FunnelRoute[] {
  try {
    const parsed = JSON.parse(raw) as any;
    const routes: FunnelRoute[] = [];
    for (const [endpoint, service] of Object.entries(parsed?.Web || {})) {
      const endpointPort = Number(String(endpoint).match(/:(\d+)$/)?.[1] || 443);
      if (![443, 8443, 10000].includes(endpointPort)) continue;
      const targetPorts = new Set<number>();
      for (const handler of Object.values((service as any)?.Handlers || {})) {
        const matches = String((handler as any)?.Proxy || '').matchAll(/127\.0\.0\.1:(\d+)/g);
        for (const match of matches) targetPorts.add(Number(match[1]));
      }
      if (targetPorts.size) routes.push({ httpsPort: endpointPort, targetPorts: [...targetPorts] });
    }
    if (routes.length) return routes;
  } catch {}

  const routes: FunnelRoute[] = [];
  let httpsPort = 443;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const endpoint = line.match(/https:\/\/[^\s(]+/i)?.[0];
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        httpsPort = Number(parsed.port || 443);
      } catch {}
    }
    const target = line.match(/127\.0\.0\.1:(\d+)/);
    if (target) routes.push({ httpsPort, targetPorts: [Number(target[1])] });
  }
  return routes;
}

async function _getFunnelRoutes(): Promise<FunnelRoute[]> {
  const result = await _runTailscaleCli(['funnel', 'status', '--json'], 5000);
  if (result.code !== 0 && !result.stdout) return [];
  return _parseFunnelRoutes(result.stdout);
}

async function _resolveFunnelHttpsPort(localPort: number): Promise<number> {
  const configured = _funnelHttpsPort();
  const routes = await _getFunnelRoutes();
  const active = routes.find(route => route.targetPorts.includes(localPort));
  if (active) return active.httpsPort;

  const configuredOwner = routes.find(route => route.httpsPort === configured);
  if (!configuredOwner) return configured;
  if (_funnelHttpsPortIsExplicit()) {
    throw new Error(`Tailscale HTTPS port ${configured} is already serving another local service.`);
  }

  const available = [443, 8443, 10000].find((port) => (
    !routes.some(route => route.httpsPort === port)
  ));
  if (!available) throw new Error('All Tailscale Funnel HTTPS ports (443, 8443, 10000) are already in use.');
  return available;
}

function _funnelTargetCommand(localPort: number, httpsPort: number): string[] {
  return ['funnel', '--bg', `--https=${httpsPort}`, String(localPort)];
}

router.get('/api/pairing/remote-access', requirePairingAdmin, (_req, res) => {
  res.json({ success: true, remoteAccess: _publicRemoteAccess() });
});

router.put('/api/pairing/remote-access', requirePairingAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const enabled = !!body.enabled;
    const mode = (body.mode === 'custom') ? 'custom' : 'tailscale-funnel';
    const publicUrl = String(body.publicUrl || '').trim().replace(/\/+$/, '');

    if (enabled) {
      if (!publicUrl) return res.status(400).json({ success: false, error: 'A public URL is required when remote access is enabled.' });
      if (!_originLooksSafe(publicUrl)) return res.status(400).json({ success: false, error: 'Public URL must be a full http(s) origin (e.g. https://your-machine.tail1234.ts.net).' });
      try {
        const parsed = new URL(publicUrl);
        if (parsed.protocol !== 'https:') return res.status(400).json({ success: false, error: 'Remote access requires an https:// URL.' });
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid public URL.' });
      }
    }

    const cfgMgr = getConfig();
    const current = cfgMgr.getConfig() as any;
    const gateway = { ...(current.gateway || {}) };
    gateway.remoteAccess = { enabled, mode, publicUrl };
    cfgMgr.updateConfig({ gateway } as any);
    res.json({ success: true, remoteAccess: _publicRemoteAccess() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

// Detects whether the `tailscale` CLI is installed locally and, when it is,
// reports the machine's Funnel-eligible HTTPS hostname (e.g.
// "your-machine.tail1234.ts.net") and the current funnel/serve state. Used by
// the UI to one-click suggest the public URL.
router.get('/api/pairing/tailscale/status', requirePairingAdmin, async (_req, res) => {
  const out: any = {
    success: true,
    installed: false,
    loggedIn: false,
    hostname: '',
    suggestedUrl: '',
    funnelActive: false,
    funnelPorts: [] as number[],
    funnelHttpsPorts: [] as number[],
    suggestedHttpsPort: 443,
    suggestedFunnelCommand: '',
    raw: '',
  };
  const version = await _runTailscaleCli(['version']);
  if (version.code !== 0) {
    out.error = 'Tailscale CLI not found in PATH. Install Tailscale from tailscale.com and sign in.';
    return res.json(out);
  }
  out.installed = true;

  const status = await _runTailscaleCli(['status', '--json']);
  if (status.code === 0 && status.stdout) {
    try {
      const parsed = JSON.parse(status.stdout);
      const self = parsed?.Self || {};
      out.loggedIn = !!self?.DNSName;
      const dnsName = String(self?.DNSName || '').replace(/\.$/, '');
      if (dnsName) {
        out.hostname = dnsName;
        out.suggestedUrl = `https://${dnsName}`;
      }
    } catch {
      out.error = 'Failed to parse `tailscale status --json` output.';
    }
  } else {
    out.error = (status.stderr || '').trim() || 'Tailscale is installed but not logged in. Run `tailscale up` once.';
  }

  const funnel = await _runTailscaleCli(['funnel', 'status', '--json']);
  if (funnel.code === 0 && funnel.stdout) out.raw = funnel.stdout.slice(0, 2000);
  const funnelRoutes = _parseFunnelRoutes(funnel.stdout);
  out.funnelPorts = [...new Set(funnelRoutes.flatMap(route => route.targetPorts))];
  out.funnelHttpsPorts = [...new Set(funnelRoutes.map(route => route.httpsPort))];
  const localPort = _gatewayPort();
  const activeRoute = funnelRoutes.find(route => route.targetPorts.includes(localPort));
  out.funnelActive = !!activeRoute;
  const availableHttpsPort = [443, 8443, 10000].find((port) => (
    !funnelRoutes.some(route => route.httpsPort === port)
      || funnelRoutes.some(route => route.httpsPort === port && route.targetPorts.includes(localPort))
  )) || 443;
  out.suggestedHttpsPort = activeRoute?.httpsPort || availableHttpsPort;
  out.suggestedFunnelCommand = `tailscale funnel --bg --https=${out.suggestedHttpsPort} ${localPort}`;
  if (out.hostname) {
    out.suggestedUrl = `https://${out.hostname}${out.suggestedHttpsPort === 443 ? '' : `:${out.suggestedHttpsPort}`}`;
  }

  res.json(out);
});

// ── Tailscale funnel management ──────────────────────────────────────────
// Enables or disables the Tailscale funnel for the gateway port without
// requiring the user to open a terminal. All commands run as the same OS
// user that started the gateway process.

function _gatewayPort(): number {
  const cfg = getConfig().getConfig() as any;
  return Number(process.env.PROMETHEUS_GATEWAY_PUBLIC_PORT || cfg?.gateway?.port || process.env.GATEWAY_PORT || 18789);
}

async function _isFunnelActiveOnPort(port: number, httpsPort = _funnelHttpsPort()): Promise<boolean> {
  const routes = await _getFunnelRoutes();
  return routes.some(route => route.httpsPort === httpsPort && route.targetPorts.includes(port));
}

// Enable funnel for the gateway port.
router.post('/api/pairing/tailscale/funnel/enable', requirePairingAdmin, async (_req, res) => {
  const port = _gatewayPort();
  let httpsPort: number;
  try {
    httpsPort = await _resolveFunnelHttpsPort(port);
  } catch (err: any) {
    return res.json({ success: false, error: String(err?.message || err), port });
  }
  const result = await _runTailscaleCli(_funnelTargetCommand(port, httpsPort), 10000);
  if (result.code !== 0 && result.code !== -2) {
    const errMsg = (result.stderr || result.stdout || '').trim() || 'Failed to enable Tailscale funnel.';
    return res.json({ success: false, error: errMsg, port, httpsPort });
  }
  const active = await _isFunnelActiveOnPort(port, httpsPort);
  res.json({ success: true, funnelActive: active, port, httpsPort });
});

// Disable only this instance's Funnel listener. A global `funnel reset` would
// also disconnect another Prometheus instance using the same Tailscale node.
router.post('/api/pairing/tailscale/funnel/disable', requirePairingAdmin, async (_req, res) => {
  const httpsPort = await _resolveFunnelHttpsPort(_gatewayPort());
  const result = await _runTailscaleCli(['funnel', `--https=${httpsPort}`, 'off'], 8000);
  const ok = result.code === 0;
  if (ok) {
    // Disabling Funnel is also an explicit request to use local pairing. Do
    // not let the startup/watchdog path immediately turn it back on, and do
    // not leave the old public URL selected for the next QR code.
    try {
      const cfgMgr = getConfig();
      const current = cfgMgr.getConfig() as any;
      const gateway = { ...(current.gateway || {}) };
      const remoteAccess = { ...(gateway.remoteAccess || {}) };
      gateway.remoteAccess = { ...remoteAccess, enabled: false };
      cfgMgr.updateConfig({ gateway } as any);
    } catch {}
  }
  res.json({ success: ok, httpsPort, error: ok ? undefined : (result.stderr || 'Failed to disable this Funnel listener').trim() });
});

// Lightweight status check — just returns funnelActive for the gateway port.
router.get('/api/pairing/tailscale/funnel/status', requirePairingAdmin, async (_req, res) => {
  const port = _gatewayPort();
  const httpsPort = _funnelHttpsPort();
  const active = await _isFunnelActiveOnPort(port, httpsPort);
  res.json({ success: true, funnelActive: active, port, httpsPort });
});

// ── Funnel watchdog (exported for use by startup.ts) ─────────────────────
let _funnelWatchdogTimer: ReturnType<typeof setInterval> | null = null;

export async function ensureTailscaleFunnel(opts: { logPrefix?: string } = {}): Promise<void> {
  const cfg = getConfig().getConfig() as any;
  const ra = cfg?.gateway?.remoteAccess;
  if (!ra?.enabled || ra?.mode !== 'tailscale-funnel') return;
  const port = _gatewayPort();
  const log = opts.logPrefix || '[TailscaleFunnel]';
  let httpsPort: number;
  try {
    httpsPort = await _resolveFunnelHttpsPort(port);
  } catch (err: any) {
    console.warn(`${log} Could not select a Funnel HTTPS port: ${String(err?.message || err)}`);
    return;
  }
  const active = await _isFunnelActiveOnPort(port, httpsPort);
  if (active) {
    console.log(`${log} Funnel already active on HTTPS ${httpsPort} → ${port}.`);
    return;
  }
  console.log(`${log} Funnel not active — enabling HTTPS ${httpsPort} → ${port}…`);
  const result = await _runTailscaleCli(_funnelTargetCommand(port, httpsPort), 12000);
  if (result.code === 0 || result.code === -2) {
    console.log(`${log} Funnel enable command sent.`);
  } else {
    const err = (result.stderr || result.stdout || '').trim();
    console.warn(`${log} Failed to enable funnel: ${err}`);
  }
}

export function startFunnelWatchdog(intervalMs: number = 5 * 60_000): void {
  if (_funnelWatchdogTimer) return; // already running
  _funnelWatchdogTimer = setInterval(() => {
    ensureTailscaleFunnel({ logPrefix: '[FunnelWatchdog]' }).catch(() => {});
  }, intervalMs);
  if (typeof (_funnelWatchdogTimer as any).unref === 'function') (_funnelWatchdogTimer as any).unref();
}

// ── mobile: bounded read-only catalog ────────────────────────────────────
// This is intentionally mounted with the pairing router so a phone can read
// safe target metadata without forwarding a desktop account cookie/session to
// another computer. It never returns transcript text, workspace paths,
// credentials, tool state, or mutation affordances.
router.get('/api/mobile/gateway/catalog', (req, res) => {
  if (!MOBILE_GATEWAY_CATALOG_ENABLED) {
    res.status(404).json({ success: false, error: 'Mobile gateway catalog is disabled.' });
    return;
  }
  const device = _requirePairedDevice(req, res);
  if (!device) return;
  try {
    const rawState = String(req.query.state || 'active').trim().toLowerCase();
    const state = ['active', 'settled', 'all'].includes(rawState) ? rawState as 'active' | 'settled' | 'all' : 'active';
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit || 50) || 50)));
    const offset = Math.max(0, Math.floor(Number(req.query.offset || 0) || 0));
    const sessionPage = listSessionSummaries({
      scope: 'all',
      state,
      includeAutomated: true,
      limit,
      offset,
    }) as any;
    const agents = getAgents()
      .map(_safeCatalogAgent)
      .filter((agent) => agent.id);
    const tasks = listTaskSummaries({ limit: 100 })
      .map(_safeCatalogTask)
      .filter((task) => task.id);
    const gateway = getGatewayDescriptor();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      gatewayId: gateway.gatewayId,
      deviceId: device.id,
      sessions: (sessionPage.sessions || []).map(_safeCatalogSession).filter((session: any) => session.id),
      total: Number(sessionPage.total || 0) || 0,
      limit,
      offset,
      hasMore: sessionPage.hasMore === true,
      agents,
      tasks,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: String(error?.message || 'Read-only gateway catalog unavailable.') });
  }
});

// ── mobile: who am I? (validate token in hand) ───────────────────────────
router.get('/api/pairing/me', (req, res) => {
  const token = String(req.headers['x-pairing-token'] || req.query.pt || '').trim();
  const device = verifyDeviceToken(token, {
    ipHint: _ipHintFromReq(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  if (!device) return res.status(401).json({ success: false, error: 'Invalid or revoked device token.' });
  res.json({ success: true, device: _publicDevice(device) });
});

// A paired phone may revoke its own target-scoped grant. This is intentionally
// narrower than desktop device administration: it cannot revoke another phone
// and it does not touch any other gateway.
router.post('/api/pairing/me/revoke', (req, res) => {
  const token = String(req.headers['x-pairing-token'] || '').trim();
  const device = verifyDeviceToken(token, {
    ipHint: _ipHintFromReq(req),
    userAgent: String(req.headers['user-agent'] || ''),
  });
  if (!device) return res.status(401).json({ success: false, error: 'Invalid or revoked device token.' });
  const changed = setDeviceEnabled(device.id, false);
  if (!changed) return res.status(404).json({ success: false, error: 'Paired device not found.' });
  broadcastWS({ type: 'pairing_device_changed', deviceId: device.id });
  res.json({ success: true, revoked: true, deviceId: device.id });
});
