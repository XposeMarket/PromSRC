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
import { getValidToken, loadTokens, refreshTokens } from '../../auth/openai-oauth';
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
  /** auth = ChatGPT really rejected the OpenAI sign-in (after one retry with a fresh token). */
  constructor(message: string, public status = 0, public retryAfterMs = 0, public auth = false) { super(message); }
}

/** The sign-in itself was rejected or is missing. Anything else (timeouts, 5xx, 429, Cloudflare checks) is temporary. */
export function isDotsAuthError(error: unknown): boolean {
  return error instanceof DotsApiError && error.auth === true;
}

/** Wait for `work`, but give up as soon as the request is cancelled or its deadline passes. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const stopped = () => new DotsApiError('Timed out talking to ChatGPT.');
  if (signal.aborted) { work.catch(() => undefined); return Promise.reject(stopped()); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(stopped());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const ROOM_ID = /^[A-Za-z0-9_-]{8,80}$/;
const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_PAGE = 32;

type DotsAuth = (options: { force: boolean }) => Promise<{ accessToken: string; accountId: string }>;
let authForTests: DotsAuth | null = null;
/** Tests only: replace the OpenAI sign-in with a fixture token. */
export function setDotsAuthForTests(fn: DotsAuth | null): void { authForTests = fn; lastForcedRefreshAt = 0; forcedRefresh = null; lastRefreshError = null; }

/** Cheap: is there an OpenAI (Codex) sign-in with a ChatGPT account? Never returns the token. */
export function hasOpenAISignIn(): boolean {
  if (authForTests) return true;
  try { return !!String(loadTokens(getConfig().getConfigDir(), undefined)?.account_id || '').trim(); } catch { return false; }
}

/** A forced refresh after a rejected request happens at most this often, so a real sign-out can't loop refreshes. */
const FORCED_REFRESH_GAP_MS = 60_000;
let lastForcedRefreshAt = 0;
/** The forced refresh in progress. Every request rejected meanwhile waits for it instead of giving up. */
let forcedRefresh: Promise<void> | null = null;
/** How the last forced refresh ended: null = it worked (or none yet). */
let lastRefreshError: DotsApiError | null = null;

/** Refresh failures that mean the sign-in is gone, not that the network blinked. */
function signInGone(error: unknown): boolean {
  return /No refresh token|Not connected to OpenAI|Token refresh failed \((400|401|403)\)/i.test(String((error as any)?.message || error));
}

async function authHeaders(json: boolean): Promise<Record<string, string>> {
  const extra: Record<string, string> = json ? { 'content-type': 'application/json' } : {};
  if (authForTests) return { ...buildChatGPTWebHeaders(await authForTests({ force: false })), ...extra };
  const dir = getConfig().getConfigDir();
  const accountId = String(loadTokens(dir, undefined)?.account_id || '').trim();
  if (!accountId) throw new DotsApiError('Sign in to OpenAI in Settings > Models first.', 401, 0, true);
  let token: string;
  try {
    // Always the latest saved token, so a request retried after someone else's refresh uses the new one.
    token = await getValidToken(dir, undefined);
  } catch (error: any) {
    if (signInGone(error)) throw new DotsApiError('The OpenAI sign-in has expired. Sign in again in Settings > Models.', 401, 0, true);
    throw new DotsApiError(`Couldn't refresh the OpenAI sign-in: ${String(error?.message || error).slice(0, 120)}`);
  }
  return { ...buildChatGPTWebHeaders({ accessToken: token, accountId }), ...extra };
}

/**
 * ChatGPT can reject an access token before its stated expiry; one forced refresh usually fixes that.
 * Requests rejected while a refresh runs wait for it. Within the cooldown after a refresh nothing is
 * refreshed again, and the retry simply uses the token that refresh saved.
 */
function refreshAfterRejection(): Promise<void> {
  if (forcedRefresh) return forcedRefresh;
  const sinceLast = Date.now() - lastForcedRefreshAt;
  if (sinceLast < FORCED_REFRESH_GAP_MS) {
    // The last refresh succeeded: retry with the token it saved. It failed: report the same outcome
    // instead of judging the sign-in with a token nobody could validate (a temporary failure stays temporary).
    if (!lastRefreshError) return Promise.resolve();
    const { message, status, auth } = lastRefreshError;
    return Promise.reject(new DotsApiError(message, status, auth ? 0 : FORCED_REFRESH_GAP_MS - sinceLast, auth));
  }
  lastForcedRefreshAt = Date.now();
  forcedRefresh = (async () => {
    try {
      if (authForTests) await authForTests({ force: true });
      else await refreshTokens(getConfig().getConfigDir(), undefined);
      lastRefreshError = null;
    } catch (error: any) {
      lastRefreshError = signInGone(error)
        ? new DotsApiError('The OpenAI sign-in has expired. Sign in again in Settings > Models.', 401, 0, true)
        : new DotsApiError(`Couldn't refresh the OpenAI sign-in: ${String(error?.message || error).slice(0, 120)}`);
      throw lastRefreshError;
    }
  })().finally(() => { forcedRefresh = null; });
  return forcedRefresh;
}

/** Cloudflare's bot check: a 403 with positive challenge evidence. Temporary, not a rejected sign-in. */
function isEdgeBlock(res: any, text: string): boolean {
  if (res?.status !== 403) return false;
  const mitigated = String(res?.headers?.get?.('cf-mitigated') || '');
  return /challenge/i.test(mitigated) || /cf-chl|challenge-platform|<title>\s*Just a moment/i.test(text);
}

async function call(pathname: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<any> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const hasBody = init.body !== undefined;
  const send = async () => {
    // Refreshing the sign-in runs under the same deadline and cancel signal as the request itself.
    const headers = await raceAbort(authHeaders(hasBody), signal);
    const res = await fetch(CHATGPT_WEB_ORIGIN + pathname, {
      method: init.method || 'GET',
      headers,
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      signal,
    });
    return { res, text: await res.text() };
  };
  let { res, text } = await send();
  const rejected = () => (res.status === 401 || res.status === 403) && !isEdgeBlock(res, text);
  // A rejected request was not processed, so it is safe to send once more with a fresh token
  // (a POST keeps its idempotency token). The retry always uses the newest saved token, so only a
  // rejection of that token counts as a rejected sign-in.
  if (rejected()) {
    await raceAbort(refreshAfterRejection(), signal);
    ({ res, text } = await send());
  }
  if (!res.ok) {
    if (isEdgeBlock(res, text)) throw new DotsApiError('ChatGPT is blocking requests for now (Cloudflare check). Retrying automatically.', 403);
    if (rejected()) throw new DotsApiError('ChatGPT rejected the OpenAI sign-in. Sign in again in Settings > Models.', res.status, 0, true);
    // Retry-After is either seconds or a date.
    const rawRetry = String((res as any).headers?.get?.('retry-after') || '').trim();
    const retryAfter = /^\d+(\.\d+)?$/.test(rawRetry) ? Number(rawRetry) : (rawRetry ? (Date.parse(rawRetry) - Date.now()) / 1000 : 0);
    throw new DotsApiError(`ChatGPT returned ${res.status}.`, res.status, retryAfter > 0 ? Math.min(retryAfter, 3600) * 1000 : 0);
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

/**
 * Sends as the signed-in user. Only ever called for a message the user sent from Prometheus.
 * `token` is the idempotency token: passing the same one again after an unanswered send
 * lets ChatGPT recognise the retry instead of posting the message twice.
 */
export async function sendRoomMessage(roomId: string, text: string, signal?: AbortSignal, token = ''): Promise<{ requestId: string; message: DotMessage | null }> {
  if (!ROOM_ID.test(roomId)) throw new DotsApiError('Not a dot conversation.');
  const body = String(text || '').trim();
  if (!body) throw new DotsApiError('Nothing to send.');
  const requestId = token || crypto.randomUUID();
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
