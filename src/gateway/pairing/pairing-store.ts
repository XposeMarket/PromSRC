/**
 * Pairing store — persistent registry of paired mobile devices, short-lived
 * pairing challenges (QR codes), and pending claim requests awaiting desktop
 * approval.
 *
 * Storage: `<configDir>/paired-devices.json`.
 *
 * Concepts:
 *   • PairingChallenge — one QR code session. Random 32-byte URL-safe code.
 *     5-minute TTL. A challenge can be claimed at most once. The "code" is
 *     visible to anyone who can see the QR — it is NOT a credential, just a
 *     handle the phone uses to identify which challenge it is responding to.
 *   • PendingRequest — created when a phone POSTs /api/pairing/claim with a
 *     valid challenge code. Waits in a queue until desktop approves or denies.
 *   • PairedDevice — created on approval. The plaintext deviceToken is handed
 *     to the phone once; only the SHA-256 hash is stored on disk. Tokens are
 *     opaque 32-byte values the phone presents on every /api/* request via
 *     the X-Pairing-Token header.
 *
 * Threat model notes:
 *   • Anyone who can see the QR (or sniff the URL) can submit a claim, but
 *     the claim still requires the user to press "Allow" on desktop, so a
 *     leaked code alone cannot enroll a device.
 *   • Token storage is hashed so a compromised disk snapshot doesn't grant
 *     ongoing access.
 *   • Disabling a device immediately invalidates its token without deletion,
 *     so it can be re-enabled later without re-pairing if the user chooses.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getConfig } from '../../config/config';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const REQUEST_TTL_MS   = 10 * 60 * 1000;      // 10 minutes
const STORE_FILE_NAME  = 'paired-devices.json';
const SESSION_STORE_FILE_NAME = 'pairing-session-state.json';

export type PairingRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PairingChallenge {
  id: string;
  code: string;
  humanCode: string;
  createdAt: number;
  expiresAt: number;
  claimed: boolean;
}

export interface PairingPendingRequest {
  id: string;
  challengeId: string;
  deviceName: string;
  deviceFingerprint: string;
  userAgent: string;
  ipHint: string;
  createdAt: number;
  expiresAt: number;
  status: PairingRequestStatus;
  deviceId?: string;       // populated on approval
  deviceToken?: string;    // plaintext, only held until phone polls
  tokenDeliveryPending?: boolean; // persisted without the plaintext token
}

export interface PairedDevice {
  id: string;
  name: string;
  fingerprint: string;
  tokenHash: string;
  enabled: boolean;
  createdAt: number;
  lastSeenAt: number;
  lastIpHint: string;
  lastUserAgent: string;
}

interface PairingFile {
  version: 1;
  devices: PairedDevice[];
  updatedAt: number;
}

interface PairingSessionFile {
  version: 1;
  challenges: PairingChallenge[];
  requests: Array<Omit<PairingPendingRequest, 'deviceToken'>>;
  updatedAt: number;
}

// Device grants are long-lived. Challenges and pending requests remain
// short-lived, but are checkpointed without plaintext device tokens so an
// Electron-managed gateway child replacement cannot invalidate a QR midway
// through pairing.
const _challenges = new Map<string, PairingChallenge>();
const _requests   = new Map<string, PairingPendingRequest>();
let   _devices: PairedDevice[] = [];
let   _loaded = false;

function _storePath(): string {
  const dir = getConfig().getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, STORE_FILE_NAME);
}

function _sessionStorePath(): string {
  const dir = getConfig().getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, SESSION_STORE_FILE_NAME);
}

function _load(): void {
  if (_loaded) return;
  _loaded = true;

  try {
    const file = _storePath();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as PairingFile;
      if (Array.isArray(parsed?.devices)) {
        _devices = parsed.devices.map((d) => ({
          id: String(d.id),
          name: String(d.name || 'Device'),
          fingerprint: String(d.fingerprint || ''),
          tokenHash: String(d.tokenHash || ''),
          enabled: d.enabled !== false,
          createdAt: Number(d.createdAt) || Date.now(),
          lastSeenAt: Number(d.lastSeenAt) || 0,
          lastIpHint: String(d.lastIpHint || ''),
          lastUserAgent: String(d.lastUserAgent || ''),
        }));
      }
    }
  } catch (err) {
    console.warn('[pairing] failed to load store:', err);
    _devices = [];
  }

  try {
    const file = _sessionStorePath();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as PairingSessionFile;
      const now = Date.now();
      if (Array.isArray(parsed?.challenges)) {
        for (const value of parsed.challenges) {
          const challenge: PairingChallenge = {
            id: String(value?.id || ''),
            code: String(value?.code || ''),
            humanCode: String(value?.humanCode || ''),
            createdAt: Number(value?.createdAt || 0) || 0,
            expiresAt: Number(value?.expiresAt || 0) || 0,
            claimed: value?.claimed === true,
          };
          if (!challenge.id || !challenge.code || !challenge.humanCode || challenge.expiresAt <= now) continue;
          _challenges.set(challenge.id, challenge);
        }
      }
      if (Array.isArray(parsed?.requests)) {
        for (const value of parsed.requests) {
          const status = String(value?.status || '') as PairingRequestStatus;
          if (!['pending', 'approved', 'denied'].includes(status)) continue;
          const request: PairingPendingRequest = {
            id: String(value?.id || ''),
            challengeId: String(value?.challengeId || ''),
            deviceName: String(value?.deviceName || 'New device').slice(0, 80),
            deviceFingerprint: String(value?.deviceFingerprint || '').slice(0, 120),
            userAgent: String(value?.userAgent || '').slice(0, 240),
            ipHint: String(value?.ipHint || '').slice(0, 80),
            createdAt: Number(value?.createdAt || 0) || 0,
            expiresAt: Number(value?.expiresAt || 0) || 0,
            status,
            deviceId: value?.deviceId ? String(value.deviceId) : undefined,
            tokenDeliveryPending: value?.tokenDeliveryPending === true,
          };
          if (!request.id || !request.challengeId || request.expiresAt <= now) continue;
          _requests.set(request.id, request);
        }
      }
    }
  } catch (err) {
    console.warn('[pairing] failed to load short-lived pairing state:', err);
    _challenges.clear();
    _requests.clear();
  }

  _sweep();
}

function _persist(): void {
  try {
    const file = _storePath();
    const data: PairingFile = { version: 1, devices: _devices, updatedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[pairing] failed to persist store:', err);
  }
}

function _persistSessionState(): void {
  try {
    const file = _sessionStorePath();
    const requests = Array.from(_requests.values()).map((request) => {
      const { deviceToken: _deviceToken, ...safe } = request;
      return safe;
    });
    const data: PairingSessionFile = {
      version: 1,
      challenges: Array.from(_challenges.values()),
      requests,
      updatedAt: Date.now(),
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[pairing] failed to persist short-lived pairing state:', err);
  }
}

function _randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function _randomHumanPairCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) suffix += alphabet[bytes[i] % alphabet.length];
  return `PAIR-${suffix.slice(0, 4)}-${suffix.slice(4)}`;
}

function _normalizePairCode(code: string): string {
  const raw = String(code || '').trim();
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAIR') && compact.length === 12) {
    return `PAIR-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
  }
  if (compact.length === 8) {
    return `PAIR-${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
  }
  return raw;
}

function _hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function _sweep(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, ch] of _challenges) {
    if (ch.expiresAt >= now) continue;
    _challenges.delete(id);
    changed = true;
  }
  for (const [id, request] of _requests) {
    if (request.expiresAt >= now) continue;
    _requests.delete(id);
    changed = true;
  }
  if (changed && _loaded) _persistSessionState();
}

/* ---------------- challenges ---------------- */

export function createPairingChallenge(): PairingChallenge {
  _load();
  _sweep();
  const now = Date.now();
  let humanCode = _randomHumanPairCode();
  for (let i = 0; i < 8 && Array.from(_challenges.values()).some(ch => ch.humanCode === humanCode); i++) {
    humanCode = _randomHumanPairCode();
  }
  const challenge: PairingChallenge = {
    id: 'chal_' + _randomBase64Url(8),
    code: _randomBase64Url(24),
    humanCode,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    claimed: false,
  };
  _challenges.set(challenge.id, challenge);
  _persistSessionState();
  return challenge;
}

export function getChallengeByCode(code: string): PairingChallenge | null {
  _load(); _sweep();
  const normalized = _normalizePairCode(code);
  for (const ch of _challenges.values()) {
    if (ch.code === code || ch.humanCode === normalized) return ch;
  }
  return null;
}

/* ---------------- requests ---------------- */

export function createPendingRequest(input: {
  challengeId: string;
  deviceName: string;
  deviceFingerprint: string;
  userAgent: string;
  ipHint: string;
}): PairingPendingRequest {
  _load(); _sweep();
  const now = Date.now();
  const req: PairingPendingRequest = {
    id: 'req_' + _randomBase64Url(10),
    challengeId: input.challengeId,
    deviceName: String(input.deviceName || 'New device').slice(0, 80),
    deviceFingerprint: String(input.deviceFingerprint || '').slice(0, 120),
    userAgent: String(input.userAgent || '').slice(0, 240),
    ipHint: String(input.ipHint || '').slice(0, 80),
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    status: 'pending',
  };
  _requests.set(req.id, req);
  const challenge = _challenges.get(input.challengeId);
  if (challenge) challenge.claimed = true;
  _persistSessionState();
  return req;
}

export function findRequestForChallengeClaim(input: {
  challengeId: string;
  deviceFingerprint: string;
  userAgent: string;
  ipHint: string;
}): PairingPendingRequest | null {
  _load(); _sweep();
  const challengeId = String(input.challengeId || '');
  const deviceFingerprint = String(input.deviceFingerprint || '').slice(0, 120);
  const userAgent = String(input.userAgent || '').slice(0, 240);
  const ipHint = String(input.ipHint || '').slice(0, 80);

  for (const req of _requests.values()) {
    if (req.challengeId !== challengeId || req.status === 'expired') continue;

    // Normal browsers keep a stable localStorage fingerprint, so exact
    // fingerprint match is enough to make claim retries idempotent. If storage
    // is unavailable, fall back to the same user-agent + IP hint.
    if (deviceFingerprint && deviceFingerprint !== 'unknown' && req.deviceFingerprint === deviceFingerprint) {
      return req;
    }
    if ((!deviceFingerprint || deviceFingerprint === 'unknown')
        && req.deviceFingerprint === deviceFingerprint
        && req.userAgent === userAgent
        && req.ipHint === ipHint) {
      return req;
    }
  }

  return null;
}

export function getPendingRequest(id: string): PairingPendingRequest | null {
  _load(); _sweep();
  return _requests.get(id) || null;
}

export function listPendingRequests(): PairingPendingRequest[] {
  _load(); _sweep();
  return Array.from(_requests.values()).filter(r => r.status === 'pending');
}

export function approvePendingRequest(id: string, overrideName?: string): {
  request: PairingPendingRequest; device: PairedDevice; deviceToken: string;
} | null {
  _load(); _sweep();
  const req = _requests.get(id);
  if (!req || req.status !== 'pending') return null;

  const deviceToken = _randomBase64Url(32);
  const tokenHash = _hashToken(deviceToken);
  const now = Date.now();
  const device: PairedDevice = {
    id: 'dev_' + _randomBase64Url(8),
    name: String(overrideName || req.deviceName || 'Mobile device').slice(0, 80),
    fingerprint: req.deviceFingerprint,
    tokenHash,
    enabled: true,
    createdAt: now,
    lastSeenAt: now,
    lastIpHint: req.ipHint,
    lastUserAgent: req.userAgent,
  };
  _devices.push(device);
  _persist();

  req.status = 'approved';
  req.deviceId = device.id;
  req.deviceToken = deviceToken;
  req.tokenDeliveryPending = true;
  _persistSessionState();

  return { request: req, device, deviceToken };
}

export function denyPendingRequest(id: string): boolean {
  _load();
  const req = _requests.get(id);
  if (!req || req.status !== 'pending') return false;
  req.status = 'denied';
  _persistSessionState();
  return true;
}

export function consumePendingRequestToken(id: string): string | null {
  // Phone polls until approved; once it has the token in hand we erase it
  // from server memory and checkpoint the one-use delivery state. If the
  // gateway child restarted after approval but before collection, regenerate
  // one replacement token and rotate the stored hash instead of persisting a
  // plaintext bearer credential to disk.
  _load(); _sweep();
  const req = _requests.get(id);
  if (!req || req.status !== 'approved' || req.tokenDeliveryPending !== true) return null;

  let token = req.deviceToken;
  if (!token) {
    const device = _devices.find((item) => item.id === req.deviceId);
    if (!device) return null;
    token = _randomBase64Url(32);
    device.tokenHash = _hashToken(token);
    device.lastSeenAt = Date.now();
    _persist();
  }

  req.deviceToken = undefined;
  req.tokenDeliveryPending = false;
  _persistSessionState();
  return token;
}

/* ---------------- devices ---------------- */

export function listPairedDevices(): PairedDevice[] {
  _load();
  return _devices.map(d => ({ ...d }));
}

export function setDeviceEnabled(deviceId: string, enabled: boolean): boolean {
  _load();
  const d = _devices.find(x => x.id === deviceId);
  if (!d) return false;
  d.enabled = !!enabled;
  _persist();
  return true;
}

export function removeDevice(deviceId: string): boolean {
  _load();
  const before = _devices.length;
  _devices = _devices.filter(x => x.id !== deviceId);
  if (_devices.length === before) return false;
  _persist();
  return true;
}

export function renameDevice(deviceId: string, name: string): boolean {
  _load();
  const d = _devices.find(x => x.id === deviceId);
  if (!d) return false;
  d.name = String(name || '').slice(0, 80) || d.name;
  _persist();
  return true;
}

/* ---------------- auth verification ---------------- */

export function verifyDeviceToken(token: string, opts?: { ipHint?: string; userAgent?: string }): PairedDevice | null {
  _load();
  if (!token) return null;
  const hash = _hashToken(token);
  // crypto.timingSafeEqual on equal-length buffers
  for (const d of _devices) {
    if (d.tokenHash.length !== hash.length) continue;
    const a = Buffer.from(d.tokenHash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      if (!d.enabled) return null;
      d.lastSeenAt = Date.now();
      if (opts?.ipHint) d.lastIpHint = String(opts.ipHint).slice(0, 80);
      if (opts?.userAgent) d.lastUserAgent = String(opts.userAgent).slice(0, 240);
      // Don't fsync on every request; just keep it in memory and persist on user actions.
      return d;
    }
  }
  return null;
}
