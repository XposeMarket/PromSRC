import { getConfig } from '../../config/config';
import { getSession, getSessionDisplayTitle } from '../session';
import {
  resolveChannelsConfig,
  sendDiscordNotification,
  sendTelegramNotification,
  sendWhatsAppNotification,
  type ChannelCompletionNotificationConfig,
} from '../comms/broadcaster';
import { sendWebPushToAll } from './web-push';

type CompletionSource = 'desktop' | 'mobile';
type DeliveryChannel = 'telegram' | 'discord' | 'whatsapp';

export type ChatCompletionNotificationInput = {
  sessionId: string;
  source: CompletionSource;
  finalText: string;
  requestOrigin?: string;
  clientRequestId?: string;
};

const recentCompletionKeys = new Map<string, number>();
const RECENT_DEDUPE_TTL_MS = 10 * 60_000;

function cleanupDedupe(now = Date.now()): void {
  for (const [key, ts] of recentCompletionKeys.entries()) {
    if (now - ts > RECENT_DEDUPE_TTL_MS) recentCompletionKeys.delete(key);
  }
}

function completionHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shouldNotify(cfg: ChannelCompletionNotificationConfig, source: CompletionSource): boolean {
  if (!cfg?.enabled) return false;
  return source === 'mobile' ? cfg.mobile === true : cfg.desktop === true;
}

function cleanSummary(text: string, maxChars: number): string {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const limit = Math.max(80, Math.min(1200, Math.floor(Number(maxChars) || 420)));
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function buildMobileChatLink(sessionId: string, requestOrigin?: string): string {
  const cfg = getConfig().getConfig() as any;
  const configuredBase = String(
    cfg?.mobile?.publicBaseUrl
      || cfg?.gateway?.publicBaseUrl
      || cfg?.gateway?.remoteAccess?.publicUrl
      || cfg?.remoteAccess?.publicBaseUrl
      || cfg?.remoteAccess?.publicUrl
      || '',
  ).trim();
  const origin = configuredBase || String(requestOrigin || '').trim() || `http://127.0.0.1:${Number(process.env.GATEWAY_PORT || 18789) || 18789}`;
  const base = origin.replace(/\/+$/, '');
  return `${base}/?source=pwa#mobile/chat/${encodeURIComponent(sessionId || 'default')}`;
}

function buildMessage(input: ChatCompletionNotificationInput, cfg: ChannelCompletionNotificationConfig): string {
  const sourceLabel = input.source === 'mobile' ? 'Mobile' : 'Desktop';
  let title = '';
  try { title = String(getSessionDisplayTitle(getSession(input.sessionId)) || '').trim(); } catch {}
  const head = title
    ? `🤖 Prometheus responded to “${title}” (${sourceLabel})`
    : `🤖 Prometheus responded (${sourceLabel})`;
  const parts = [head];
  if (cfg.includeSummary !== false) {
    const summary = cleanSummary(input.finalText, cfg.summaryMaxChars);
    if (summary) parts.push('', summary);
  }
  if (cfg.includeLink === true) {
    parts.push('', buildMobileChatLink(input.sessionId, input.requestOrigin));
  }
  return parts.join('\n').trim();
}

function buildWebPushPayload(input: ChatCompletionNotificationInput): { title: string; body: string; url: string; tag: string; data: Record<string, any> } {
  let title = '';
  try { title = String(getSessionDisplayTitle(getSession(input.sessionId)) || '').trim(); } catch {}
  const sourceLabel = input.source === 'mobile' ? 'Mobile' : 'Desktop';
  const body = cleanSummary(input.finalText, 240) || 'Response finished.';
  return {
    title: title ? `Response ready: ${title}` : `Response ready (${sourceLabel})`,
    body,
    url: buildMobileChatLink(input.sessionId, input.requestOrigin),
    tag: `prometheus-chat-${input.sessionId || 'default'}`,
    data: {
      kind: 'chat_response',
      sessionId: input.sessionId,
      source: input.source,
      clientRequestId: input.clientRequestId || '',
    },
  };
}

async function deliver(channel: DeliveryChannel, text: string): Promise<void> {
  if (channel === 'telegram') {
    await sendTelegramNotification(text);
  } else if (channel === 'discord') {
    await sendDiscordNotification(text);
  } else {
    await sendWhatsAppNotification(text);
  }
}

export function notifyChatCompletion(input: ChatCompletionNotificationInput): void {
  const sessionId = String(input.sessionId || '').trim();
  const finalText = String(input.finalText || '').trim();
  if (!sessionId || !finalText) return;

  const now = Date.now();
  cleanupDedupe(now);
  const dedupeKey = [
    input.source,
    sessionId,
    String(input.clientRequestId || ''),
    completionHash(finalText.slice(0, 2000)),
  ].join(':');
  if (recentCompletionKeys.has(dedupeKey)) return;
  recentCompletionKeys.set(dedupeKey, now);

  sendWebPushToAll(buildWebPushPayload(input));

  const channels = resolveChannelsConfig();
  const candidates: Array<[DeliveryChannel, ChannelCompletionNotificationConfig]> = [
    ['telegram', channels.telegram.completionNotifications],
    ['discord', channels.discord.completionNotifications],
    ['whatsapp', channels.whatsapp.completionNotifications],
  ];

  for (const [channel, cfg] of candidates) {
    if (!shouldNotify(cfg, input.source)) continue;
    const text = buildMessage(input, cfg);
    deliver(channel, text).catch((err: any) => {
      console.warn(`[completion-bridge] ${channel} delivery failed: ${String(err?.message || err)}`);
    });
  }
}
