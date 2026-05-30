import fs from 'fs';
import path from 'path';
import { getSession } from './session';
import { broadcastWS, getSessionChannelHint, linkTelegramSession, sendDiscordNotification, sendWhatsAppNotification } from './comms/broadcaster';

export type DeliveryTarget = 'origin' | 'telegram' | 'mobile' | 'web' | 'discord' | 'whatsapp' | 'cli' | 'terminal' | 'all';

export interface DeliveryDeps {
  telegramChannel?: any;
  broadcastWS?: (data: any) => void;
}

export interface DeliveryPayload {
  text?: string;
  caption?: string;
  target?: DeliveryTarget | string;
  sessionId?: string;
  attachmentPath?: string;
  imageBuffer?: Buffer;
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
  source?: string;
}

function normalizeTarget(value: unknown): DeliveryTarget {
  const target = String(value || 'origin').trim().toLowerCase();
  if (target === 'cli') return 'terminal';
  if (['origin', 'telegram', 'mobile', 'web', 'discord', 'whatsapp', 'terminal', 'all'].includes(target)) return target as DeliveryTarget;
  return 'origin';
}

function inferOriginChannel(sessionId: string): DeliveryTarget {
  const hint = getSessionChannelHint(sessionId);
  if (hint?.channel === 'telegram' || hint?.channel === 'discord' || hint?.channel === 'whatsapp' || hint?.channel === 'terminal') {
    return hint.channel;
  }
  const session = getSession(sessionId);
  const latestUserOrigin = [...(session.history || [])]
    .reverse()
    .find((m: any) => m?.role === 'user' && (m?.origin?.channel || m?.channel));
  const channel = String(latestUserOrigin?.origin?.channel || latestUserOrigin?.channel || session.channel || '').toLowerCase();
  if (channel === 'telegram' || channel === 'discord' || channel === 'whatsapp' || channel === 'mobile' || channel === 'web' || channel === 'terminal') {
    return channel as DeliveryTarget;
  }
  if (String(sessionId || '').startsWith('telegram_')) return 'telegram';
  if (String(sessionId || '').startsWith('mobile_')) return 'mobile';
  if (String(sessionId || '').startsWith('cli_')) return 'terminal';
  return 'web';
}

function resolveTargets(target: DeliveryTarget, sessionId: string): DeliveryTarget[] {
  const resolved = target === 'origin' ? inferOriginChannel(sessionId) : target;
  if (resolved === 'all') return ['telegram', 'web', 'mobile', 'discord', 'whatsapp'];
  return [resolved];
}

function resolveTelegramChatId(sessionId: string): number | null {
  const hint = getSessionChannelHint(sessionId);
  if (hint?.channel === 'telegram' && Number.isFinite(Number(hint.chatId))) return Number(hint.chatId);
  const match = String(sessionId || '').match(/^telegram_(\d+)/);
  if (match) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

function buildWebPayload(payload: DeliveryPayload, target: DeliveryTarget): Record<string, any> {
  const text = String(payload.text || payload.caption || '').trim();
  const imageBase64 = payload.imageBase64 || (payload.imageBuffer ? payload.imageBuffer.toString('base64') : '');
  const mimeType = payload.mimeType || (imageBase64 ? 'image/jpeg' : undefined);
  return {
    type: 'delivery_notification',
    target,
    sessionId: payload.sessionId || '',
    text,
    caption: payload.caption || text,
    source: payload.source || 'delivery',
    attachmentPath: payload.attachmentPath || '',
    fileName: payload.fileName || (payload.attachmentPath ? path.basename(payload.attachmentPath) : ''),
    imageDataUrl: imageBase64 ? `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` : '',
    mimeType,
    timestamp: Date.now(),
  };
}

function buildVisionInjectedPayload(payload: DeliveryPayload): Record<string, any> | null {
  const imageBase64 = payload.imageBase64 || (payload.imageBuffer ? payload.imageBuffer.toString('base64') : '');
  if (!imageBase64) return null;
  const mimeType = payload.mimeType || 'image/jpeg';
  const fileName = String(payload.fileName || '').toLowerCase();
  const sourceText = String(payload.source || '').toLowerCase();
  const source = fileName.includes('browser') || sourceText.includes('browser') ? 'browser' : 'desktop';
  return {
    type: 'vision_injected',
    source,
    tool: payload.source || 'delivery_send_screenshot',
    preview: {
      dataUrl: `data:${mimeType};base64,${imageBase64}`,
      mimeType,
    },
    timestamp: Date.now(),
  };
}

async function deliverTelegram(payload: DeliveryPayload, deps: DeliveryDeps): Promise<string> {
  const telegram = deps.telegramChannel;
  if (!telegram) return 'telegram unavailable';
  const sessionId = String(payload.sessionId || '').trim();
  const text = String(payload.text || payload.caption || '').trim();
  const caption = String(payload.caption || payload.text || '').trim();
  const chatId = sessionId ? resolveTelegramChatId(sessionId) : null;
  if (chatId && typeof telegram.sendMessage === 'function') {
    try {
      const allowedIds: number[] = telegram.getAllowedUserIds?.() || [];
      for (const uid of allowedIds) linkTelegramSession(uid, sessionId);
    } catch {}
  }
  if (payload.imageBuffer || payload.imageBase64) {
    const buf = payload.imageBuffer || Buffer.from(String(payload.imageBase64 || ''), 'base64');
    if (chatId && typeof telegram.sendPhotoToChat === 'function') {
      await telegram.sendPhotoToChat(chatId, buf, caption, payload.fileName || 'image.jpg', payload.mimeType || 'image/jpeg');
      return 'telegram chat';
    }
    await telegram.sendPhotoToAllowed(buf, caption);
    return 'telegram allowed users';
  }
  if (payload.attachmentPath) {
    if (chatId && typeof telegram.sendFileToChat === 'function') {
      await telegram.sendFileToChat(chatId, payload.attachmentPath, caption);
      return 'telegram chat';
    }
    if (typeof telegram.sendFileToAllowed === 'function') {
      await telegram.sendFileToAllowed(payload.attachmentPath, caption);
      return 'telegram allowed users';
    }
    await telegram.sendToAllowed(`${caption || 'File'}\n${payload.attachmentPath}`);
    return 'telegram allowed users';
  }
  if (!text) return 'telegram skipped empty text';
  if (chatId && typeof telegram.sendMessage === 'function') {
    await telegram.sendMessage(chatId, text);
    return 'telegram chat';
  }
  await telegram.sendToAllowed(text);
  return 'telegram allowed users';
}

export async function deliverToTargets(payload: DeliveryPayload, deps: DeliveryDeps = {}): Promise<{ ok: boolean; delivered: string[]; errors: string[] }> {
  const sessionId = String(payload.sessionId || '').trim() || 'default';
  const target = normalizeTarget(payload.target);
  const targets = resolveTargets(target, sessionId);
  const delivered: string[] = [];
  const errors: string[] = [];
  const hasText = String(payload.text || payload.caption || '').trim().length > 0;
  const textForTextOnlyChannels = String(payload.text || payload.caption || '').trim()
    || (payload.attachmentPath ? `File ready: ${payload.attachmentPath}` : '')
    || (payload.imageBuffer || payload.imageBase64 ? 'Screenshot/image delivered in Prometheus.' : '');

  for (const t of targets) {
    try {
      if (t === 'telegram') {
        delivered.push(await deliverTelegram({ ...payload, sessionId }, deps));
      } else if (t === 'discord') {
        if (textForTextOnlyChannels) await sendDiscordNotification(textForTextOnlyChannels);
        delivered.push('discord text');
      } else if (t === 'whatsapp') {
        if (textForTextOnlyChannels) await sendWhatsAppNotification(textForTextOnlyChannels);
        delivered.push('whatsapp text');
      } else if (t === 'web' || t === 'mobile' || t === 'terminal') {
        const event = buildWebPayload({ ...payload, sessionId, text: hasText ? payload.text : textForTextOnlyChannels }, t);
        (deps.broadcastWS || broadcastWS)(event);
        const visionEvent = buildVisionInjectedPayload({ ...payload, sessionId });
        if (visionEvent) (deps.broadcastWS || broadcastWS)({ ...visionEvent, target: t, sessionId });
        delivered.push(`${t} websocket`);
      }
    } catch (err: any) {
      errors.push(`${t}: ${err?.message || err}`);
    }
  }

  return { ok: delivered.length > 0 && errors.length === 0, delivered, errors };
}

export function readAttachmentBuffer(filePath: string, workspacePath: string): { buffer: Buffer; absPath: string; fileName: string; mimeType: string } {
  const raw = String(filePath || '').trim();
  if (!raw) throw new Error('attachmentPath is required');
  const absPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspacePath, raw);
  if (!fs.existsSync(absPath)) throw new Error(`Attachment not found: ${raw}`);
  const ext = path.extname(absPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
          : 'application/octet-stream';
  return { buffer: fs.readFileSync(absPath), absPath, fileName: path.basename(absPath), mimeType };
}
