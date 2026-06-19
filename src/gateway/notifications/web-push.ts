import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import webpush from 'web-push';
import { getConfig } from '../../config/config';

type WebPushKeys = {
  publicKey: string;
  privateKey: string;
  createdAt: number;
};

export type StoredWebPushSubscription = {
  id: string;
  endpoint: string;
  subscription: any;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
};

type WebPushStore = {
  keys?: WebPushKeys;
  subscriptions: StoredWebPushSubscription[];
};

export type WebPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, any>;
};

const STORE_VERSION = 1;

function storeDir(): string {
  return path.join(getConfig().getConfigDir(), 'notifications');
}

function storePath(): string {
  return path.join(storeDir(), 'web-push.json');
}

function readStore(): WebPushStore {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return { subscriptions: [] };
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      keys: parsed?.keys,
      subscriptions: Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : [],
    };
  } catch {
    return { subscriptions: [] };
  }
}

function writeStore(store: WebPushStore): void {
  fs.mkdirSync(storeDir(), { recursive: true });
  const tmp = `${storePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, ...store }, null, 2), 'utf-8');
  fs.renameSync(tmp, storePath());
}

function getOrCreateKeys(): WebPushKeys {
  const store = readStore();
  if (store.keys?.publicKey && store.keys?.privateKey) return store.keys;
  const generated = webpush.generateVAPIDKeys();
  const keys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    createdAt: Date.now(),
  };
  writeStore({ ...store, keys });
  return keys;
}

function configureWebPush(): WebPushKeys {
  const keys = getOrCreateKeys();
  const cfg = getConfig().getConfig() as any;
  const subject = String(
    cfg?.mobile?.publicBaseUrl
      || cfg?.gateway?.publicBaseUrl
      || cfg?.gateway?.remoteAccess?.publicUrl
      || cfg?.remoteAccess?.publicBaseUrl
      || cfg?.remoteAccess?.publicUrl
      || 'mailto:prometheus@localhost',
  ).trim();
  webpush.setVapidDetails(subject.includes(':') ? subject : `mailto:${subject}`, keys.publicKey, keys.privateKey);
  return keys;
}

function subscriptionId(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
}

function normalizeSubscription(input: any): any | null {
  if (!input || typeof input !== 'object') return null;
  const endpoint = String(input.endpoint || '').trim();
  const p256dh = String(input.keys?.p256dh || '').trim();
  const auth = String(input.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime: input.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

export function getWebPushPublicKey(): string {
  return getOrCreateKeys().publicKey;
}

export function upsertWebPushSubscription(input: {
  subscription: any;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
}): StoredWebPushSubscription {
  const subscription = normalizeSubscription(input.subscription);
  if (!subscription) throw new Error('Invalid push subscription');
  const now = Date.now();
  const store = readStore();
  const id = subscriptionId(subscription.endpoint);
  const existing = store.subscriptions.find((s) => s.id === id || s.endpoint === subscription.endpoint);
  const next: StoredWebPushSubscription = {
    ...(existing || { id, endpoint: subscription.endpoint, createdAt: now }),
    id,
    endpoint: subscription.endpoint,
    subscription,
    deviceId: String(input.deviceId || existing?.deviceId || '').trim() || undefined,
    deviceName: String(input.deviceName || existing?.deviceName || '').trim().slice(0, 120) || undefined,
    userAgent: String(input.userAgent || existing?.userAgent || '').trim().slice(0, 300) || undefined,
    updatedAt: now,
  };
  const rest = store.subscriptions.filter((s) => s.id !== id && s.endpoint !== subscription.endpoint);
  writeStore({ ...store, subscriptions: [...rest, next].slice(-50) });
  return next;
}

export function removeWebPushSubscription(endpointOrId: string): boolean {
  const key = String(endpointOrId || '').trim();
  if (!key) return false;
  const store = readStore();
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter((s) => s.id !== key && s.endpoint !== key);
  if (store.subscriptions.length === before) return false;
  writeStore(store);
  return true;
}

export function listWebPushSubscriptions(): StoredWebPushSubscription[] {
  return readStore().subscriptions;
}

function markSubscription(id: string, patch: Partial<StoredWebPushSubscription>): void {
  const store = readStore();
  const idx = store.subscriptions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  store.subscriptions[idx] = { ...store.subscriptions[idx], ...patch, updatedAt: Date.now() };
  writeStore(store);
}

export function sendWebPushToAll(payload: WebPushPayload): void {
  const subscriptions = listWebPushSubscriptions();
  if (!subscriptions.length) return;
  configureWebPush();
  const body = JSON.stringify({
    title: payload.title || 'Prometheus',
    body: payload.body || '',
    icon: payload.icon || '/assets/Prometheus.png',
    badge: payload.badge || '/assets/Prometheus.png',
    tag: payload.tag || 'prometheus-chat-response',
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : undefined,
    url: payload.url || '/?source=pwa#mobile/chat',
    data: payload.data || {},
  });
  for (const item of subscriptions) {
    webpush.sendNotification(item.subscription, body).then(() => {
      markSubscription(item.id, { lastSuccessAt: Date.now(), lastError: undefined });
    }).catch((err: any) => {
      const statusCode = Number(err?.statusCode || err?.status || 0);
      const bodyText = String(err?.body || err?.response?.body || '').trim();
      const headers = err?.headers && typeof err.headers === 'object'
        ? JSON.stringify(err.headers).slice(0, 500)
        : '';
      const detail = [
        `status=${statusCode || 'unknown'}`,
        String(err?.message || err || 'delivery failed'),
        bodyText ? `body=${bodyText.slice(0, 500)}` : '',
        headers ? `headers=${headers}` : '',
      ].filter(Boolean).join(' ');
      if (statusCode === 404 || statusCode === 410) {
        removeWebPushSubscription(item.id);
        return;
      }
      markSubscription(item.id, {
        lastErrorAt: Date.now(),
        lastError: detail.slice(0, 1000),
      });
      console.warn(`[web-push] delivery failed for ${item.id}: ${detail}`);
    });
  }
}
