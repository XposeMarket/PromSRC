/**
 * chatgpt-web-client.ts
 *
 * Minimal client for ChatGPT's first-party web backend using the Codex OAuth
 * session Prometheus already stores (same access token + ChatGPT account id).
 *
 *   1. POST /backend-api/sentinel/chat-requirements  -> requirements token (+ PoW seed)
 *   2. Solve the proof-of-work the web client solves (sha3-512 prefix search)
 *   3. POST /backend-api/conversation (SSE)          -> streamed reply
 *
 * This is an undocumented internal API. Every failure is surfaced as a
 * ChatGPTWebError with a stable code so the provider can fail cleanly instead
 * of hanging, and nothing here ever logs the bearer token.
 */

import crypto from 'crypto';

export const CHATGPT_WEB_ORIGIN = 'https://chatgpt.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const POW_MAX_ITERATIONS = 500_000;

export type ChatGPTWebErrorCode =
  | 'CHATGPT_WEB_AUTH'
  | 'CHATGPT_WEB_TURNSTILE'
  | 'CHATGPT_WEB_POW'
  | 'CHATGPT_WEB_RATE_LIMIT'
  | 'CHATGPT_WEB_HTTP'
  | 'CHATGPT_WEB_STREAM';

export class ChatGPTWebError extends Error {
  readonly code: ChatGPTWebErrorCode;
  readonly status?: number;
  constructor(code: ChatGPTWebErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ChatGPTWebError';
    this.code = code;
    this.status = status;
  }
}

export interface ChatGPTWebCredentials {
  accessToken: string;
  accountId: string;
}

export interface ChatRequirements {
  token: string;
  persona?: string;
  proofofwork?: { required?: boolean; seed?: string; difficulty?: string };
  turnstile?: { required?: boolean };
}

/** Stable per-process device id; ChatGPT expects one per browser profile. */
const DEVICE_ID = crypto.randomUUID();

export function buildChatGPTWebHeaders(creds: ChatGPTWebCredentials): Record<string, string> {
  return {
    authorization: `Bearer ${creds.accessToken}`,
    'chatgpt-account-id': creds.accountId,
    'user-agent': USER_AGENT,
    'oai-language': 'en-US',
    'oai-device-id': DEVICE_ID,
    origin: CHATGPT_WEB_ORIGIN,
    referer: `${CHATGPT_WEB_ORIGIN}/`,
    accept: '*/*',
    'content-type': 'application/json',
  };
}

/**
 * Proof-of-work answer in the web client's format: "gAAAAAB" + base64(config)
 * where sha3-512(seed + base64(config)) has a hex prefix <= difficulty.
 */
export function solveProofOfWork(seed: string, difficulty: string): string | null {
  const diff = String(difficulty || '');
  const config: any[] = [
    3000 + Math.floor(Math.random() * 3000),
    new Date().toString(),
    4294705152,
    0,
    USER_AGENT,
    `${CHATGPT_WEB_ORIGIN}/`,
    'dpl',
    'en-US',
    'en-US,en',
    0,
    'webdriver\u2212false',
    'location',
    'window',
    performance.now(),
    crypto.randomUUID(),
    '',
    12,
    Date.now(),
  ];
  for (let i = 0; i < POW_MAX_ITERATIONS; i += 1) {
    config[3] = i;
    config[9] = Math.round(i / 10);
    const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
    const hash = crypto.createHash('sha3-512').update(seed + encoded).digest('hex');
    if (hash.slice(0, diff.length) <= diff) return `gAAAAAB${encoded}`;
  }
  return null;
}

function classifyHttpError(status: number, bodyText: string, stage: string): ChatGPTWebError {
  const detail = (() => {
    try {
      const parsed = JSON.parse(bodyText);
      const raw = parsed?.detail?.message || parsed?.detail || parsed?.error?.message || parsed?.message || '';
      return typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch {
      return '';
    }
  })().replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
  if (status === 401 || status === 403) {
    // An HTML 403 is Cloudflare's bot-check page, not an auth answer: the API
    // answers auth failures with JSON. The keywords sit past the inline CSS, so
    // a 2000-char scan missed them and told the user to reconnect a login that
    // was fine (2026-09-26 16:06, cleared by itself at 16:09).
    if (/^\s*<(!doctype|html)/i.test(bodyText) || /turnstile|cloudflare|challenge|cf-ray|cf_chl/i.test(bodyText)) {
      return new ChatGPTWebError('CHATGPT_WEB_TURNSTILE', `ChatGPT served a Cloudflare bot check (${stage}, HTTP ${status}). This is usually temporary; your Codex login is fine. Try again in a minute.`, status);
    }
    return new ChatGPTWebError('CHATGPT_WEB_AUTH', `ChatGPT rejected the Codex session (${stage}, HTTP ${status})${detail ? `: ${detail}` : ''}. Reconnect OpenAI Codex in Settings -> Models.`, status);
  }
  if (status === 429) {
    return new ChatGPTWebError('CHATGPT_WEB_RATE_LIMIT', `ChatGPT usage limit reached (${stage})${detail ? `: ${detail}` : ''}.`, status);
  }
  return new ChatGPTWebError('CHATGPT_WEB_HTTP', `ChatGPT ${stage} failed with HTTP ${status}${detail ? `: ${detail}` : ''}.`, status);
}

export async function fetchChatRequirements(creds: ChatGPTWebCredentials, signal?: AbortSignal): Promise<ChatRequirements> {
  // Bot-check pages are short-lived; retry twice with backoff before failing.
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchChatRequirementsOnce(creds, signal);
    } catch (error) {
      const retryable = error instanceof ChatGPTWebError && error.code === 'CHATGPT_WEB_TURNSTILE' && attempt < 2 && !signal?.aborted;
      if (!retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 4000));
    }
  }
}

async function fetchChatRequirementsOnce(creds: ChatGPTWebCredentials, signal?: AbortSignal): Promise<ChatRequirements> {
  const response = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/sentinel/chat-requirements`, {
    method: 'POST',
    headers: buildChatGPTWebHeaders(creds),
    body: JSON.stringify({ p: null }),
    signal,
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw classifyHttpError(response.status, text, 'chat-requirements');
  let parsed: any;
  try { parsed = JSON.parse(text); } catch {
    throw new ChatGPTWebError('CHATGPT_WEB_HTTP', 'ChatGPT chat-requirements returned a non-JSON body.');
  }
  if (!parsed?.token) throw new ChatGPTWebError('CHATGPT_WEB_HTTP', 'ChatGPT chat-requirements returned no token.');
  return parsed as ChatRequirements;
}

export interface ConversationRequest {
  messages: Array<{ id: string; author: { role: string }; content: any; metadata?: Record<string, unknown> }>;
  model: string;
  thinkingEffort?: string;
  /**
   * Keep the chat out of the user's ChatGPT history (Temporary Chat).
   * Ignored when mcpSources is set: ChatGPT drops connectors from Temporary
   * Chats (verified 2026-09-25: the same request calls the Prometheus tool as a
   * normal chat and gets "No functions matching" as a temporary one; the web
   * client also strips connector hints when Temporary Chat is on). Callers
   * hide the conversation afterwards instead (hideConversation).
   */
  temporary?: boolean;
  /** Dev-mode connectors to enable for this message (selected_mcp_sources). */
  mcpSources?: Array<{ id: string; name: string; status?: string }>;
}

export function buildConversationBody(request: ConversationRequest): Record<string, unknown> {
  const messages = request.messages.map((m) => ({ ...m, metadata: { ...(m.metadata || {}) } }));
  const last = messages[messages.length - 1];
  if (last && request.mcpSources?.length) {
    last.metadata = {
      ...last.metadata,
      // What the web composer sends when an app is picked with "+": the app
      // becomes a system hint "connector:<id>" and its id is also listed in
      // search_connectors (chatgpt.com bundle, 2026-09-25: kO/NO/Ge).
      system_hints: request.mcpSources.map((s) => `connector:${s.id}`),
      search_connectors: request.mcpSources.map((s) => s.id),
      selected_mcp_sources: request.mcpSources.map((s) => ({ id: s.id, name: s.name, status: s.status || 'ONLY_ME' })),
    };
  }
  const body: Record<string, unknown> = {
    action: 'next',
    messages,
    parent_message_id: 'client-created-root',
    model: request.model,
    history_and_training_disabled: request.mcpSources?.length ? false : request.temporary !== false,
    // Same sign convention as the web client (Date#getTimezoneOffset: EDT = 240).
    timezone_offset_min: new Date().getTimezoneOffset(),
    conversation_mode: { kind: 'primary_assistant' },
    supports_buffering: true,
    supported_encodings: ['v1'],
    system_hints: request.mcpSources?.length ? request.mcpSources.map((s) => `connector:${s.id}`) : [],
  };
  if (request.thinkingEffort) body.thinking_effort = request.thinkingEffort;
  return body;
}

/** Start a conversation turn and return the streaming response. */
export async function startConversation(
  creds: ChatGPTWebCredentials,
  request: ConversationRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const requirements = await fetchChatRequirements(creds, signal);
  const headers: Record<string, string> = {
    ...buildChatGPTWebHeaders(creds),
    accept: 'text/event-stream',
    'openai-sentinel-chat-requirements-token': requirements.token,
  };
  if (requirements.proofofwork?.required) {
    const proof = solveProofOfWork(String(requirements.proofofwork.seed || ''), String(requirements.proofofwork.difficulty || ''));
    if (!proof) throw new ChatGPTWebError('CHATGPT_WEB_POW', 'Could not solve the ChatGPT proof-of-work challenge.');
    headers['openai-sentinel-proof-token'] = proof;
  }
  const response = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/conversation`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildConversationBody(request)),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw classifyHttpError(response.status, text, 'conversation');
  }
  if (!response.body) throw new ChatGPTWebError('CHATGPT_WEB_STREAM', 'ChatGPT returned an empty stream.');
  return response;
}

export interface ChatGPTWebUploadedImage {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

/** Pixel size from PNG / JPEG / GIF / WEBP headers (0x0 when unknown). */
export function imageDimensions(buf: Buffer): { width: number; height: number } {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return { width: 0, height: 0 };
}

/**
 * Upload one image to ChatGPT's file service (the web client's attach flow):
 * create the file record, PUT the bytes to the returned blob URL, then mark it
 * uploaded. The returned file id is referenced as file-service://<id>.
 */
export async function uploadChatGPTWebImage(
  creds: ChatGPTWebCredentials,
  image: { data: Buffer; mimeType: string; name: string },
  signal?: AbortSignal,
): Promise<ChatGPTWebUploadedImage> {
  const headers = buildChatGPTWebHeaders(creds);
  const create = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/files`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ file_name: image.name, file_size: image.data.length, use_case: 'multimodal', reset_rate_limits: false }),
    signal,
  });
  if (!create.ok) throw classifyHttpError(create.status, await create.text().catch(() => ''), 'files');
  const created: any = await create.json();
  const fileId = String(created?.file_id || '');
  const uploadUrl = String(created?.upload_url || '');
  if (!fileId || !uploadUrl) throw new ChatGPTWebError('CHATGPT_WEB_STREAM', 'ChatGPT file upload did not return an upload URL.');
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2020-04-08', 'content-type': image.mimeType },
    body: image.data,
    signal,
  });
  if (!put.ok) throw new ChatGPTWebError('CHATGPT_WEB_STREAM', `ChatGPT image upload failed (${put.status}).`, put.status);
  const done = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/files/${encodeURIComponent(fileId)}/uploaded`, {
    method: 'POST',
    headers,
    body: '{}',
    signal,
  });
  if (!done.ok) throw classifyHttpError(done.status, await done.text().catch(() => ''), 'files');
  const { width, height } = imageDimensions(image.data);
  return { fileId, name: image.name, mimeType: image.mimeType, size: image.data.length, width, height };
}

/** `sandbox:/mnt/data/...` paths referenced in an answer (deduped, in order). */
export function extractSandboxPaths(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text || '').matchAll(/sandbox:(\/mnt\/data\/[^\s)\]"'<>`]+)/g)) {
    const p = m[1].replace(/[.,;:]+$/, '');
    if (!p.includes('..')) seen.add(p);
  }
  return [...seen];
}

/**
 * Download one file ChatGPT's python tool wrote to its sandbox. Same two steps
 * as the web client's sandbox link: ask for a signed URL for
 * (conversation, message, sandbox path), then GET the bytes.
 */
export function toNativeAbortSignal(signal: any): AbortSignal | undefined {
  if (!signal) return undefined;
  if (signal instanceof AbortSignal) return signal;
  if (typeof signal.addEventListener !== 'function') return undefined;
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}

export async function downloadChatGPTSandboxFile(
  creds: ChatGPTWebCredentials,
  conversationId: string,
  messageId: string,
  sandboxPath: string,
  signal?: AbortSignal,
  maxBytes = 100 * 1024 * 1024,
): Promise<Buffer> {
  // Do not hand the signal to fetch: in the gateway the global AbortController
  // can come from a different implementation than undici's, and even a freshly
  // constructed AbortController().signal was rejected live ("member signal is
  // not of type AbortSignal", 2026-09-26). Race against abort + a timeout instead.
  const guarded = <T>(work: Promise<T>, label: string): Promise<T> => new Promise<T>((resolve, reject) => {
    const s: any = signal;
    if (s?.aborted) { reject(new ChatGPTWebError('CHATGPT_WEB_HTTP', `Sandbox download of ${sandboxPath} was cancelled.`)); return; }
    const timer = setTimeout(() => reject(new ChatGPTWebError('CHATGPT_WEB_HTTP', `Sandbox ${label} timed out for ${sandboxPath}.`)), 120_000);
    const onAbort = () => { clearTimeout(timer); reject(new ChatGPTWebError('CHATGPT_WEB_HTTP', `Sandbox download of ${sandboxPath} was cancelled.`)); };
    try { s?.addEventListener?.('abort', onAbort, { once: true }); } catch { /* signal optional */ }
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  const qs = new URLSearchParams({ message_id: messageId, sandbox_path: sandboxPath });
  const meta = await guarded(fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?${qs}`, {
    headers: buildChatGPTWebHeaders(creds),
  }), 'download lookup');
  const metaText = await meta.text().catch(() => '');
  if (!meta.ok) throw classifyHttpError(meta.status, metaText, 'sandbox download');
  let url = '';
  try { url = String(JSON.parse(metaText)?.download_url || ''); } catch { /* handled below */ }
  // download_url can be relative or point back at chatgpt.com (files/…/download);
  // those need the same session headers. A signed CDN URL must not get them.
  if (url.startsWith('/')) url = `${CHATGPT_WEB_ORIGIN}${url}`;
  if (!/^https:\/\//.test(url)) throw new ChatGPTWebError('CHATGPT_WEB_HTTP', `ChatGPT returned no download URL for ${sandboxPath}: ${metaText.slice(0, 200)}`);
  let host = '';
  try { host = new URL(url).host; } catch { /* validated above */ }
  const sameOrigin = host === new URL(CHATGPT_WEB_ORIGIN).host;
  let file = await guarded(fetch(url, sameOrigin ? { headers: buildChatGPTWebHeaders(creds) } : undefined), 'file download');
  if (!file.ok && !sameOrigin && (file.status === 401 || file.status === 403)) {
    // Some estuary/file hosts still expect the bearer token.
    file = await guarded(fetch(url, { headers: buildChatGPTWebHeaders(creds) }), 'file download');
  }
  if (!file.ok) throw new ChatGPTWebError('CHATGPT_WEB_HTTP', `Sandbox file download failed (${file.status}, host ${host}) for ${sandboxPath}.`, file.status);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > maxBytes) throw new ChatGPTWebError('CHATGPT_WEB_HTTP', `Sandbox file ${sandboxPath} is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return buf;
}

/**
 * Remove a finished conversation from the user's ChatGPT sidebar (same call as
 * the web client's "Delete chat": PATCH is_visible=false). Best-effort.
 */
export async function hideConversation(creds: ChatGPTWebCredentials, conversationId: string): Promise<boolean> {
  const id = String(conversationId || '').trim();
  if (!/^[A-Za-z0-9-]{8,}$/.test(id)) return false;
  try {
    const response = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/conversation/${id}`, {
      method: 'PATCH',
      headers: buildChatGPTWebHeaders(creds),
      body: JSON.stringify({ is_visible: false }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
