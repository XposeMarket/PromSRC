/**
 * OpenAI Dots (ChatGPT's always-on agents) through the same private chatgpt.com
 * backend the ChatGPT bridge uses, signed in with the user's existing OpenAI
 * (Codex) login. Unofficial and undocumented: OpenAI can change it without
 * notice, so every parse here is defensive.
 *
 * Observed 2026-11-18:
 *   GET  /backend-api/tbo?limit=25                     -> { items: [dot] }
 *   GET  /backend-api/messaging/rooms/<room>/messages  -> { items: [message] } oldest first
 *   POST /backend-api/messaging/rooms/<room>/messages  { content:{text}, request_id, idempotency_token, ... }
 * A dot is a contact with ONE direct-message room. Dot messages are authored by
 * a `calpico-member-*` account; the user's are `user-*` and carry request_id.
 */
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { getValidToken, loadTokens } from '../../auth/openai-oauth';
import { buildChatGPTWebHeaders, CHATGPT_WEB_ORIGIN } from '../../providers/chatgpt-web/chatgpt-web-client';

export interface DotInfo {
  id: string;
  name: string;
  roomId: string;
  primary: boolean;
  status: string;
  paused: boolean;
  avatarUrl?: string;
}

export interface DotMessage {
  id: string;
  at: number;
  fromDot: boolean;
  text: string;
  /** parent_notification = the dot posted on its own; chatgpt_messaging = a reply. */
  trigger?: string;
  requestId?: string;
}

export class DotsApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

const ROOM_ID = /^[A-Za-z0-9_-]{8,80}$/;
const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_PAGE = 32;

type DotsAuth = () => Promise<{ accessToken: string; accountId: string }>;
let authForTests: DotsAuth | null = null;
/** Tests only: replace the OpenAI sign-in with a fixture token. */
export function setDotsAuthForTests(fn: DotsAuth | null): void { authForTests = fn; }

/** Cheap: is there an OpenAI (Codex) sign-in with a ChatGPT account? Never returns the token. */
export function hasOpenAISignIn(): boolean {
  if (authForTests) return true;
  try { return !!String(loadTokens(getConfig().getConfigDir(), undefined)?.account_id || '').trim(); } catch { return false; }
}

async function authHeaders(json: boolean): Promise<Record<string, string>> {
  if (authForTests) return { ...buildChatGPTWebHeaders(await authForTests()), ...(json ? { 'content-type': 'application/json' } : {}) };
  const dir = getConfig().getConfigDir();
  const accountId = String(loadTokens(dir, undefined)?.account_id || '').trim();
  if (!accountId) throw new DotsApiError('Sign in to OpenAI in Settings > Models first.', 401);
  const token = await getValidToken(dir, undefined);
  return { ...buildChatGPTWebHeaders({ accessToken: token, accountId }), ...(json ? { 'content-type': 'application/json' } : {}) };
}

async function call(pathname: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<any> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const hasBody = init.body !== undefined;
  const res = await fetch(CHATGPT_WEB_ORIGIN + pathname, {
    method: init.method || 'GET',
    headers: await authHeaders(hasBody),
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new DotsApiError('ChatGPT rejected the OpenAI sign-in. Sign in again in Settings > Models.', res.status);
    throw new DotsApiError(`ChatGPT returned ${res.status}.`, res.status);
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw new DotsApiError('ChatGPT returned an unexpected response.', res.status); }
}

export function parseDot(raw: any): DotInfo | null {
  const id = String(raw?.id || '').trim();
  const roomId = String(raw?.messaging_room_id || '').trim();
  if (!id || !ROOM_ID.test(roomId)) return null;
  const status = String(raw?.status || '').trim() || 'active';
  if (/^(deleted|archived)$/i.test(status)) return null;
  const avatarUrl = String(raw?.avatar_url || '').trim();
  return {
    id,
    roomId,
    name: String(raw?.display_name || '').trim().slice(0, 60) || 'Your dot',
    primary: raw?.is_primary === true,
    status,
    paused: raw?.is_paused === true || raw?.is_admin_paused === true,
    ...(/^https:\/\//.test(avatarUrl) ? { avatarUrl } : {}),
  };
}

export function parseDotMessage(raw: any): DotMessage | null {
  const id = String(raw?.id || '').trim();
  if (!id || raw?.deleted_at) return null;
  const text = String(raw?.content?.text ?? '').trim();
  const attachments = Array.isArray(raw?.content?.attachments) ? raw.content.attachments.length : 0;
  if (!text && !attachments) return null;
  const author = String(raw?.account_user_id || '');
  const trigger = String(raw?.message_metadata?.turn_trigger || '').trim();
  const requestId = String(raw?.request_id || '').trim();
  const note = attachments ? `(${attachments} attachment${attachments === 1 ? '' : 's'}, open ChatGPT to view)` : '';
  return {
    id,
    at: Date.parse(String(raw?.created_at || '')) || 0,
    fromDot: author.startsWith('calpico-member'),
    text: [text, note].filter(Boolean).join('\n\n'),
    ...(trigger ? { trigger } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export async function listDots(signal?: AbortSignal): Promise<DotInfo[]> {
  const data = await call('/backend-api/tbo?limit=25&include_room_preview=false', { signal });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(parseDot).filter((dot: DotInfo | null): dot is DotInfo => !!dot);
}

/** Newest `limit` messages of a dot's room, oldest first. */
export async function listRoomMessages(roomId: string, limit = 30, signal?: AbortSignal): Promise<DotMessage[]> {
  if (!ROOM_ID.test(roomId)) throw new DotsApiError('Not a dot conversation.');
  // ChatGPT rejects limit > 32 with 422 (observed 2026-11-18).
  const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
  const data = await call(`/backend-api/messaging/rooms/${roomId}/messages?limit=${size}`, { signal });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(parseDotMessage)
    .filter((msg: DotMessage | null): msg is DotMessage => !!msg)
    .sort((a: DotMessage, b: DotMessage) => a.at - b.at);
}

/** Sends as the signed-in user. Only ever called for a message the user sent from Prometheus. */
export async function sendRoomMessage(roomId: string, text: string, signal?: AbortSignal): Promise<{ requestId: string; message: DotMessage | null }> {
  if (!ROOM_ID.test(roomId)) throw new DotsApiError('Not a dot conversation.');
  const body = String(text || '').trim();
  if (!body) throw new DotsApiError('Nothing to send.');
  const requestId = crypto.randomUUID();
  const data = await call(`/backend-api/messaging/rooms/${roomId}/messages`, {
    method: 'POST',
    body: {
      content: { text: body },
      request_id: requestId,
      idempotency_token: requestId,
      page_context: { page_id: null },
      timezone_offset_min: new Date().getTimezoneOffset(),
    },
    signal,
  });
  return { requestId, message: parseDotMessage(data?.message || data) };
}
