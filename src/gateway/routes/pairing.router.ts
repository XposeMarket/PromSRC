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
 * Note: only /api/pairing/me requires a token. All other endpoints are
 * intentionally open so that the unpaired phone can complete the handshake
 * and the desktop (running on the same machine) can manage devices.
 * In a future hardening pass, the desktop endpoints should be locked to
 * loopback / authenticated sessions.
 */

import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import * as QRCode from 'qrcode';
import { getConfig } from '../../config/config';
import { getSessionStatus } from './account.router';
import {
  createPairingChallenge, getChallengeByCode,
  createPendingRequest, getPendingRequest, listPendingRequests,
  approvePendingRequest, denyPendingRequest, consumePendingRequestToken,
  listPairedDevices, setDeviceEnabled, removeDevice, renameDevice,
  verifyDeviceToken,
} from '../pairing/pairing-store';
import { broadcastWS } from '../comms/broadcaster';

export const router: Router = Router();

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

function _resolvePairingOrigin(req: any, overrideOrigin: string): {
  origin: string;
  bindHost: string;
  lanOrigins: string[];
  warning?: string;
} {
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
    return { origin: overrideOrigin, bindHost, lanOrigins };
  }

  // Remote access: when enabled with a valid public URL (e.g. Tailscale Funnel),
  // use it as the pairing origin so the phone can reach the gateway off-LAN.
  // The local LAN URL is still returned in `lanOrigins` for visibility.
  const ra = cfg?.gateway?.remoteAccess;
  if (ra && ra.enabled && typeof ra.publicUrl === 'string') {
    const publicUrl = ra.publicUrl.trim();
    if (publicUrl && _originLooksSafe(publicUrl)) {
      return { origin: publicUrl.replace(/\/+$/, ''), bindHost, lanOrigins };
    }
  }

  const isWildcard = bindHost === '0.0.0.0' || bindHost === '::';
  if (_isLoopbackHost(hostname) && isWildcard && lanOrigins.length) {
    return { origin: lanOrigins[0], bindHost, lanOrigins };
  }

  const warning = _isLoopbackHost(hostname)
    ? isWildcard
      ? 'No LAN IPv4 address was detected; phone pairing may not be reachable.'
      : 'Gateway is bound to loopback only. Set gateway.host to 0.0.0.0 and restart to pair from a phone.'
    : (preferHttps ? 'Mobile microphone capture requires HTTPS. If Safari warns about the certificate, install and trust the Prometheus local certificate from desktop Settings.' : undefined);
  return { origin: fallbackOrigin, bindHost, lanOrigins, warning };
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

// ── desktop: create a fresh challenge + QR ────────────────────────────────
router.post('/api/pairing/qr', async (req, res) => {
  try {
    // Allow the desktop to override the host (e.g. when pairing across LAN
    // and the gateway is reached via a different hostname than req.host).
    const overrideOrigin = typeof req.body?.origin === 'string' ? String(req.body.origin).trim() : '';
    const pairingOrigin = _resolvePairingOrigin(req, overrideOrigin);
    const origin = pairingOrigin.origin;

    const challenge = createPairingChallenge();
    const pairUrl = `${origin}/?pair=${encodeURIComponent(challenge.code)}#mobile/pair`;

    const svg = await QRCode.toString(pairUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#221a14', light: '#ffffff' },
      width: 320,
    });

    const cfg = getConfig().getConfig() as any;
    const ra = cfg?.gateway?.remoteAccess;
    const remoteAccessActive = !!(ra && ra.enabled && typeof ra.publicUrl === 'string' && ra.publicUrl.trim() && _originLooksSafe(ra.publicUrl.trim()));
    res.json({
      success: true,
      challengeId: challenge.id,
      pairCode: challenge.humanCode,
      pairUrl,
      bindHost: pairingOrigin.bindHost,
      lanOrigins: pairingOrigin.lanOrigins,
      warning: pairingOrigin.warning,
      remoteAccess: remoteAccessActive
        ? { active: true, mode: String(ra.mode || 'custom'), publicUrl: String(ra.publicUrl).trim() }
        : { active: false },
      expiresAt: challenge.expiresAt,
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
    const account = getSessionStatus();
    if (!account.authenticated || (!account.subscriptionActive && !account.isAdmin)) {
      return res.status(401).json({ success: false, error: 'Prometheus account login required before pairing.' });
    }

    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ success: false, error: 'code required' });
    const ch = getChallengeByCode(code);
    if (!ch)               return res.status(404).json({ success: false, error: 'Challenge not found or expired.' });
    if (ch.claimed)        return res.status(409).json({ success: false, error: 'This QR code has already been used.' });
    if (ch.expiresAt < Date.now()) return res.status(410).json({ success: false, error: 'QR code expired. Generate a new one.' });

    const r = createPendingRequest({
      challengeId: ch.id,
      deviceName: String(req.body?.deviceName || 'Mobile device'),
      deviceFingerprint: String(req.body?.deviceFingerprint || ''),
      userAgent: String(req.headers['user-agent'] || ''),
      ipHint: _ipHintFromReq(req),
    });

    broadcastWS({ type: 'pairing_pending', requestId: r.id, deviceName: r.deviceName, createdAt: r.createdAt });

    res.json({ success: true, requestId: r.id, expiresAt: r.expiresAt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

// ── mobile: poll for approval ────────────────────────────────────────────
router.get('/api/pairing/poll/:id', (req, res) => {
  const id = String(req.params.id || '');
  const r = getPendingRequest(id);
  if (!r) return res.status(404).json({ success: false, status: 'not_found' });
  if (r.status === 'approved') {
    const token = consumePendingRequestToken(id);
    if (token) {
      return res.json({
        success: true,
        status: 'approved',
        deviceId: r.deviceId,
        deviceToken: token,
      });
    }
    return res.json({ success: true, status: 'approved_already_collected' });
  }
  if (r.status === 'denied')  return res.json({ success: true, status: 'denied' });
  if (r.status === 'expired') return res.json({ success: false, status: 'expired' });
  res.json({ success: true, status: 'pending' });
});

// ── desktop: list pending claims ─────────────────────────────────────────
router.get('/api/pairing/pending', (_req, res) => {
  res.json({ success: true, requests: listPendingRequests().map(_publicRequest) });
});

// ── desktop: approve / deny ──────────────────────────────────────────────
router.post('/api/pairing/approve', (req, res) => {
  const id   = String(req.body?.requestId || '');
  const name = req.body?.deviceName ? String(req.body.deviceName) : undefined;
  const result = approvePendingRequest(id, name);
  if (!result) return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
  broadcastWS({ type: 'pairing_approved', requestId: result.request.id, deviceId: result.device.id });
  res.json({ success: true, device: _publicDevice(result.device) });
});

router.post('/api/pairing/deny', (req, res) => {
  const id = String(req.body?.requestId || '');
  const ok = denyPendingRequest(id);
  if (!ok) return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
  broadcastWS({ type: 'pairing_denied', requestId: id });
  res.json({ success: true });
});

// ── desktop: device management ───────────────────────────────────────────
router.get('/api/pairing/devices', (_req, res) => {
  res.json({ success: true, devices: listPairedDevices().map(_publicDevice) });
});

router.patch('/api/pairing/devices/:id', (req, res) => {
  const id = String(req.params.id || '');
  let changed = false;
  if (typeof req.body?.enabled === 'boolean') changed = setDeviceEnabled(id, req.body.enabled) || changed;
  if (typeof req.body?.name === 'string') changed = renameDevice(id, req.body.name) || changed;
  if (!changed) return res.status(404).json({ success: false, error: 'Device not found or nothing to update.' });
  broadcastWS({ type: 'pairing_device_changed', deviceId: id });
  res.json({ success: true });
});

router.delete('/api/pairing/devices/:id', (req, res) => {
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
      const proc = spawn('tailscale', args, { windowsHide: true });
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

router.get('/api/pairing/remote-access', (_req, res) => {
  res.json({ success: true, remoteAccess: _publicRemoteAccess() });
});

router.put('/api/pairing/remote-access', (req, res) => {
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
router.get('/api/pairing/tailscale/status', async (_req, res) => {
  const out: any = {
    success: true,
    installed: false,
    loggedIn: false,
    hostname: '',
    suggestedUrl: '',
    funnelActive: false,
    funnelPorts: [] as number[],
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

  const funnel = await _runTailscaleCli(['funnel', 'status']);
  if (funnel.code === 0 && funnel.stdout) {
    out.raw = funnel.stdout.slice(0, 2000);
    const portMatches = Array.from(funnel.stdout.matchAll(/127\.0\.0\.1:(\d+)/g));
    out.funnelPorts = [...new Set(portMatches.map(m => Number(m[1])).filter(n => Number.isFinite(n)))];
    out.funnelActive = out.funnelPorts.length > 0;
  }

  res.json(out);
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
