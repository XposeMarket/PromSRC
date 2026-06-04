// src/gateway/tools/handlers/xai-handlers.ts
//
// Handlers for xAI-backed search tools (x_search, xai_live_search). Credential
// resolution mirrors Hermes' tools/xai_http.resolve_xai_http_credentials:
//
//   1. xAI OAuth (SuperGrok) - getValidXAIRuntimeCredentials, auto-refreshes
//   2. XAI_API_KEY environment variable
//   3. providers.xai.api_key in app config (vault-resolved)
//
// All three converge on POST https://api.x.ai/v1/responses (x_search) or
// POST https://api.x.ai/v1/chat/completions (live_search).

import {
  getValidXAIRuntimeCredentials,
  isXAIConnected,
  refreshXAITokens,
} from '../../../auth/xai-oauth.js';
import {
  X_API_ADD_LIST_MEMBER_TOOL_NAME,
  X_API_BLOCK_USER_TOOL_NAME,
  X_API_CREATE_LIST_TOOL_NAME,
  X_API_CREATE_BOOKMARK_TOOL_NAME,
  X_API_CREATE_POST_TOOL_NAME,
  X_API_DELETE_LIST_TOOL_NAME,
  X_API_DELETE_BOOKMARK_TOOL_NAME,
  X_API_DELETE_POST_TOOL_NAME,
  X_API_FOLLOW_LIST_TOOL_NAME,
  X_API_FOLLOW_USER_TOOL_NAME,
  X_API_GET_BOOKMARKS_TOOL_NAME,
  X_API_GET_DM_EVENTS_TOOL_NAME,
  X_API_GET_FOLLOWERS_TOOL_NAME,
  X_API_GET_FOLLOWING_TOOL_NAME,
  X_API_GET_LIKED_POSTS_TOOL_NAME,
  X_API_GET_LIKING_USERS_TOOL_NAME,
  X_API_GET_LIST_POSTS_TOOL_NAME,
  X_API_GET_LIST_TOOL_NAME,
  X_API_GET_OWNED_LISTS_TOOL_NAME,
  X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME,
  X_API_GET_POST_TOOL_NAME,
  X_API_GET_POSTS_TOOL_NAME,
  X_API_GET_REPOSTED_BY_TOOL_NAME,
  X_API_GET_REPOSTS_OF_ME_TOOL_NAME,
  X_API_GET_SPACE_TOOL_NAME,
  X_API_GET_TRENDS_TOOL_NAME,
  X_API_GET_USAGE_TOOL_NAME,
  X_API_GET_USER_BY_USERNAME_TOOL_NAME,
  X_API_GET_USER_MENTIONS_TOOL_NAME,
  X_API_GET_USER_POSTS_TOOL_NAME,
  X_API_GET_USER_TOOL_NAME,
  X_API_LIKE_POST_TOOL_NAME,
  X_API_ME_TOOL_NAME,
  X_API_MUTE_USER_TOOL_NAME,
  X_API_PIN_LIST_TOOL_NAME,
  X_API_REMOVE_LIST_MEMBER_TOOL_NAME,
  X_API_REPOST_TOOL_NAME,
  X_API_REQUEST_TOOL_NAME,
  X_API_SEARCH_ALL_TOOL_NAME,
  X_API_SEARCH_RECENT_TOOL_NAME,
  X_API_SEARCH_SPACES_TOOL_NAME,
  X_API_SEND_DM_TOOL_NAME,
  X_API_UNBLOCK_USER_TOOL_NAME,
  X_API_UNFOLLOW_LIST_TOOL_NAME,
  X_API_UNFOLLOW_USER_TOOL_NAME,
  X_API_UNLIKE_POST_TOOL_NAME,
  X_API_UNMUTE_USER_TOOL_NAME,
  X_API_UNPIN_LIST_TOOL_NAME,
  X_API_UNREPOST_TOOL_NAME,
  X_API_UPDATE_LIST_TOOL_NAME,
  X_SEARCH_TOOL_NAME,
  XAI_LIVE_SEARCH_TOOL_NAME,
} from '../defs/xai-tools.js';
import { getValidXApiToken } from '../../../auth/x-api-oauth.js';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_X_SEARCH_MODEL = 'grok-4.3';
const DEFAULT_LIVE_SEARCH_MODEL = 'grok-4.3';
const DEFAULT_TIMEOUT_MS = 180_000;
const X_API_BASE_URL = 'https://api.x.com/2';
const MAX_HANDLES = 10;

function getConfigDir(): string {
  // Lazy require avoids circular import at module load.
  const { getConfig } = require('../../../config/config') as typeof import('../../../config/config');
  return getConfig().getConfigDir();
}

function readXaiApiKeyFromConfig(): string | undefined {
  try {
    const { getConfig } = require('../../../config/config') as typeof import('../../../config/config');
    const cfg = getConfig();
    const data = cfg.getConfig() as any;
    const raw = data?.llm?.providers?.xai?.api_key ?? data?.providers?.xai?.api_key;
    const resolved = cfg.resolveSecret(raw);
    return resolved ? String(resolved) : undefined;
  } catch {
    return undefined;
  }
}

function readXaiBaseUrlFromConfig(): string | undefined {
  try {
    const { getConfig } = require('../../../config/config') as typeof import('../../../config/config');
    const data = getConfig().getConfig() as any;
    const raw = data?.llm?.providers?.xai?.endpoint ?? data?.providers?.xai?.endpoint;
    const value = String(raw || '').trim();
    return value ? value.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
}

interface ResolvedCreds {
  api_key: string;
  base_url: string;
  source: 'xai-oauth' | 'xai-env' | 'xai-config';
}

export async function resolveXAICredentials(): Promise<ResolvedCreds | null> {
  const configDir = getConfigDir();

  // 1. OAuth (auto-refresh inside)
  if (isXAIConnected(configDir)) {
    try {
      const creds = await getValidXAIRuntimeCredentials(configDir);
      const apiKey = String(creds.api_key || '').trim();
      if (apiKey) {
        return {
          api_key: apiKey,
          base_url: (creds.base_url || DEFAULT_BASE_URL).replace(/\/+$/, ''),
          source: 'xai-oauth',
        };
      }
    } catch {
      // fall through to API key paths
    }
  }

  // 2. XAI_API_KEY env
  const envKey = String(process.env.XAI_API_KEY || '').trim();
  if (envKey) {
    const baseUrl = (process.env.XAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    return { api_key: envKey, base_url: baseUrl, source: 'xai-env' };
  }

  // 3. Config file (providers.xai.api_key, vault-resolved)
  const cfgKey = readXaiApiKeyFromConfig();
  if (cfgKey) {
    const baseUrl = readXaiBaseUrlFromConfig() || DEFAULT_BASE_URL;
    return { api_key: cfgKey, base_url: baseUrl, source: 'xai-config' };
  }

  return null;
}

export function xaiHasCredentials(): boolean {
  try {
    if (isXAIConnected(getConfigDir())) return true;
  } catch {
    /* ignore */
  }
  if (process.env.XAI_API_KEY) return true;
  if (readXaiApiKeyFromConfig()) return true;
  return false;
}

export function getEffectiveXaiApiKey(): string | undefined {
  return readXaiApiKeyFromConfig();
}

function normalizeHandles(handles: any, field: string): string[] {
  if (!Array.isArray(handles)) return [];
  const cleaned: string[] = [];
  for (const h of handles) {
    const norm = String(h ?? '').trim().replace(/^@+/, '');
    if (norm) cleaned.push(norm);
  }
  if (cleaned.length > MAX_HANDLES) {
    throw new Error(`${field} supports at most ${MAX_HANDLES} handles`);
  }
  return cleaned;
}

interface XSearchArgs {
  query?: string;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
  enable_image_understanding?: boolean;
  enable_video_understanding?: boolean;
}

interface XSearchResult {
  success: boolean;
  provider: 'xai';
  credential_source?: string;
  tool: 'x_search';
  model?: string;
  query?: string;
  answer?: string;
  citations?: any[];
  inline_citations?: Array<{ url: string; title: string; start_index?: number; end_index?: number }>;
  error?: string;
  error_type?: string;
}

function extractResponseText(payload: any): string {
  const outputText = String(payload?.output_text || '').trim();
  if (outputText) return outputText;
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' || content?.type === 'text') {
        const t = String(content?.text || '').trim();
        if (t) parts.push(t);
      }
    }
  }
  return parts.join('\n\n').trim();
}

function extractInlineCitations(payload: any): Array<{ url: string; title: string; start_index?: number; end_index?: number }> {
  const out: Array<{ url: string; title: string; start_index?: number; end_index?: number }> = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) {
        if (annotation?.type !== 'url_citation') continue;
        out.push({
          url: String(annotation.url || ''),
          title: String(annotation.title || ''),
          start_index: annotation.start_index,
          end_index: annotation.end_index,
        });
      }
    }
  }
  return out;
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status < 500 || attempt >= retries) return res;
      lastErr = new Error(`xAI upstream ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw err;
    }
    await new Promise((r) => setTimeout(r, Math.min(5000, 1500 * (attempt + 1))));
  }
  throw lastErr;
}

async function fetchXaiJsonWithOAuthRefresh(
  path: string,
  creds: ResolvedCreds,
  body: unknown,
): Promise<{ res: Response; creds: ResolvedCreds }> {
  let activeCreds = creds;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchWithRetry(`${activeCreds.base_url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeCreds.api_key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Prometheus/xai-tools',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (res.status !== 401 || activeCreds.source !== 'xai-oauth' || attempt > 0) {
      return { res, creds: activeCreds };
    }

    await refreshXAITokens(getConfigDir());
    const refreshed = await resolveXAICredentials();
    if (!refreshed || refreshed.source !== 'xai-oauth' || !refreshed.api_key) {
      return { res, creds: activeCreds };
    }
    activeCreds = refreshed;
  }
  throw new Error('xAI OAuth refresh retry exhausted');
}

async function readHttpError(res: Response): Promise<string> {
  try {
    const payload = await res.json() as any;
    const code = String(payload?.code || '').trim();
    const error = String(payload?.error || '').trim();
    const message = error || JSON.stringify(payload).slice(0, 500);
    return code && !message.includes(code) ? `${code}: ${message}` : message;
  } catch {
    try {
      const text = await res.text();
      return text.slice(0, 500);
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}

// Vision summary for the realtime voice agent: xAI's voice/realtime models can't
// take image input, so when the user captures a photo/video on xAI voice we route
// the image(s) to Grok (grok-4.3) vision and feed the text summary back into the
// live voice session. Video frames (sampled ~1/sec) are summarized as one clip.
const DEFAULT_XAI_VISION_MODEL = process.env.XAI_VISION_MODEL || 'grok-4.3';

export async function executeXaiImageVisionSummary(input: {
  dataUrl?: string;
  frames?: Array<{ dataUrl?: string }>;
  name?: string;
  durationMs?: number;
}): Promise<{ success: boolean; summary?: string; model?: string; credential_source?: string; error?: string }> {
  const creds = await resolveXAICredentials();
  if (!creds) {
    return { success: false, error: 'xAI credentials not configured. Connect xAI in Settings -> Models, or set XAI_API_KEY.' };
  }

  const images: string[] = [];
  const single = String(input?.dataUrl || '').trim();
  if (single.startsWith('data:image')) images.push(single);
  for (const f of (Array.isArray(input?.frames) ? input.frames : [])) {
    const u = String(f?.dataUrl || '').trim();
    if (u.startsWith('data:image')) images.push(u);
  }
  if (!images.length) return { success: false, error: 'No image data provided.' };

  const isVideo = images.length > 1;
  const promptText = isVideo
    ? `These ${images.length} frames are sampled in order (about one per second) from a short mobile camera clip${input?.durationMs ? ` (~${Math.round(Number(input.durationMs) / 1000)}s)` : ''}. Describe what happens across the clip: the scene, key objects, any people and their actions, readable text, colors, and notable changes between frames. Be specific but concise — this is spoken to a live voice assistant that cannot see the images.`
    : `Describe this mobile camera photo for a live voice assistant that cannot see it. Cover the scene, key objects, any people and their actions, readable text, colors, and anything notable. Be specific but concise.`;

  const content: any[] = [{ type: 'text', text: promptText }];
  for (const url of images.slice(0, 12)) content.push({ type: 'image_url', image_url: { url, detail: 'high' } });

  const model = DEFAULT_XAI_VISION_MODEL;
  const body = { model, messages: [{ role: 'user', content }], temperature: 0.2 };
  try {
    const { res, creds: finalCreds } = await fetchXaiJsonWithOAuthRefresh('/chat/completions', creds, body);
    if (!res.ok) {
      return { success: false, error: await readHttpError(res), model };
    }
    const data = await res.json() as any;
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const summary = String(choice?.message?.content || '').trim();
    if (!summary) return { success: false, error: 'xAI vision returned an empty summary.', model };
    return { success: true, summary, model, credential_source: finalCreds.source };
  } catch (err: any) {
    return { success: false, error: String(err?.message || err), model };
  }
}

export async function executeXSearch(args: XSearchArgs): Promise<XSearchResult> {
  const query = String(args?.query || '').trim();
  if (!query) {
    return { success: false, provider: 'xai', tool: 'x_search', error: 'query is required' };
  }

  const creds = await resolveXAICredentials();
  if (!creds) {
    return {
      success: false,
      provider: 'xai',
      tool: 'x_search',
      error: 'xAI credentials not configured. Connect xAI in Settings -> Models, or set XAI_API_KEY.',
    };
  }

  let allowed: string[];
  let excluded: string[];
  try {
    allowed = normalizeHandles(args.allowed_x_handles, 'allowed_x_handles');
    excluded = normalizeHandles(args.excluded_x_handles, 'excluded_x_handles');
  } catch (err: any) {
    return { success: false, provider: 'xai', tool: 'x_search', error: String(err?.message || err) };
  }
  if (allowed.length && excluded.length) {
    return {
      success: false,
      provider: 'xai',
      tool: 'x_search',
      error: 'allowed_x_handles and excluded_x_handles cannot be used together',
    };
  }

  const toolDef: any = { type: 'x_search' };
  if (allowed.length) toolDef.allowed_x_handles = allowed;
  if (excluded.length) toolDef.excluded_x_handles = excluded;
  if (args.from_date && args.from_date.trim()) toolDef.from_date = args.from_date.trim();
  if (args.to_date && args.to_date.trim()) toolDef.to_date = args.to_date.trim();
  if (args.enable_image_understanding) toolDef.enable_image_understanding = true;
  if (args.enable_video_understanding) toolDef.enable_video_understanding = true;

  const model = DEFAULT_X_SEARCH_MODEL;
  const body = {
    model,
    input: [{ role: 'user', content: query }],
    tools: [toolDef],
    store: false,
  };

  try {
    const { res, creds: finalCreds } = await fetchXaiJsonWithOAuthRefresh('/responses', creds, body);
    if (!res.ok) {
      const errMsg = await readHttpError(res);
      return { success: false, provider: 'xai', tool: 'x_search', error: errMsg, error_type: `HTTP_${res.status}` };
    }
    const data = await res.json() as any;
    const answer = extractResponseText(data);
    const citations = Array.isArray(data?.citations) ? data.citations : [];
    const inline = extractInlineCitations(data);
    return {
      success: true,
      provider: 'xai',
      credential_source: finalCreds.source,
      tool: 'x_search',
      model,
      query,
      answer,
      citations,
      inline_citations: inline,
    };
  } catch (err: any) {
    return {
      success: false,
      provider: 'xai',
      tool: 'x_search',
      error: String(err?.message || err),
      error_type: err?.name || 'Error',
    };
  }
}

interface LiveSearchArgs {
  query?: string;
  sources?: any[];
  mode?: 'on' | 'auto' | 'off';
  from_date?: string;
  to_date?: string;
  max_search_results?: number;
  return_citations?: boolean;
}

interface LiveSearchResult {
  success: boolean;
  provider: 'xai';
  credential_source?: string;
  tool: 'xai_live_search';
  model?: string;
  query?: string;
  answer?: string;
  citations?: string[];
  error?: string;
  error_type?: string;
}

function sanitizeLiveSearchSources(sources: any[]): any[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [{ type: 'web' }, { type: 'x' }];
  }
  const out: any[] = [];
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const type = String(s.type || '').toLowerCase();
    if (!['x', 'web', 'news', 'rss'].includes(type)) continue;
    const cleaned: any = { type };
    if (type === 'x') {
      const included = Array.isArray(s.included_x_handles) ? s.included_x_handles : s.x_handles;
      if (Array.isArray(included)) cleaned.included_x_handles = included.slice(0, MAX_HANDLES).map((h: any) => String(h).replace(/^@+/, ''));
      if (Array.isArray(s.excluded_x_handles)) cleaned.excluded_x_handles = s.excluded_x_handles.slice(0, MAX_HANDLES).map((h: any) => String(h).replace(/^@+/, ''));
      if (typeof s.post_favorite_count === 'number') cleaned.post_favorite_count = s.post_favorite_count;
      if (typeof s.post_view_count === 'number') cleaned.post_view_count = s.post_view_count;
    } else if (type === 'web' || type === 'news') {
      if (s.country) cleaned.country = String(s.country).toUpperCase().slice(0, 2);
      if (Array.isArray(s.allowed_websites) && type === 'web') cleaned.allowed_websites = s.allowed_websites.map((d: any) => String(d));
      if (Array.isArray(s.excluded_websites)) cleaned.excluded_websites = s.excluded_websites.map((d: any) => String(d));
      if (typeof s.safe_search === 'boolean') cleaned.safe_search = s.safe_search;
    } else if (type === 'rss') {
      if (Array.isArray(s.links)) cleaned.links = s.links.map((l: any) => String(l));
    }
    out.push(cleaned);
  }
  return out.length > 0 ? out : [{ type: 'web' }, { type: 'x' }];
}

export async function executeLiveSearch(args: LiveSearchArgs): Promise<LiveSearchResult> {
  const query = String(args?.query || '').trim();
  if (!query) {
    return { success: false, provider: 'xai', tool: 'xai_live_search', error: 'query is required' };
  }

  const creds = await resolveXAICredentials();
  if (!creds) {
    return {
      success: false,
      provider: 'xai',
      tool: 'xai_live_search',
      error: 'xAI credentials not configured. Connect xAI in Settings -> Models, or set XAI_API_KEY.',
    };
  }

  const sources = sanitizeLiveSearchSources(args.sources || []);
  const mode = (['on', 'auto', 'off'] as const).includes(args.mode as any) ? args.mode : 'on';
  const maxResults = Math.max(1, Math.min(30, Number(args.max_search_results || 15)));
  const returnCitations = args.return_citations !== false;

  const searchParameters: any = {
    mode,
    sources,
    max_search_results: maxResults,
    return_citations: returnCitations,
  };
  if (args.from_date && args.from_date.trim()) searchParameters.from_date = args.from_date.trim();
  if (args.to_date && args.to_date.trim()) searchParameters.to_date = args.to_date.trim();

  const model = DEFAULT_LIVE_SEARCH_MODEL;
  const body = {
    model,
    messages: [{ role: 'user', content: query }],
    search_parameters: searchParameters,
  };

  try {
    const { res, creds: finalCreds } = await fetchXaiJsonWithOAuthRefresh('/chat/completions', creds, body);
    if (!res.ok) {
      const errMsg = await readHttpError(res);
      return { success: false, provider: 'xai', tool: 'xai_live_search', error: errMsg, error_type: `HTTP_${res.status}` };
    }
    const data = await res.json() as any;
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const answer = String(choice?.message?.content || '').trim();
    const citations = Array.isArray(data?.citations) ? data.citations.map((c: any) => String(c)) : [];
    return {
      success: true,
      provider: 'xai',
      credential_source: finalCreds.source,
      tool: 'xai_live_search',
      model,
      query,
      answer,
      citations,
    };
  } catch (err: any) {
    return {
      success: false,
      provider: 'xai',
      tool: 'xai_live_search',
      error: String(err?.message || err),
      error_type: err?.name || 'Error',
    };
  }
}

function buildXApiPath(path: string, query?: Record<string, any>): string {
  const rawPath = String(path || '').trim();
  if (!rawPath.startsWith('/')) throw new Error('X API path must begin with /.');
  if (/^\/\//.test(rawPath) || /^https?:/i.test(rawPath)) throw new Error('X API path must not include a host.');

  const parsed = new URL(rawPath, 'https://api.x.com');
  let pathname = parsed.pathname.replace(/\/+/g, '/');
  if (pathname === '/2') pathname = '/';
  else if (pathname.startsWith('/2/')) pathname = pathname.slice(2);
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const searchParams = new URLSearchParams(parsed.search);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) searchParams.set(key, value.map((v) => String(v)).join(','));
    } else {
      searchParams.set(key, String(value));
    }
  }

  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
}

function numericId(value: any, field: string): string {
  const id = String(value || '').trim();
  if (!/^[0-9]{1,24}$/.test(id)) throw new Error(`${field} must be a numeric X ID.`);
  return id;
}

function optionalNumericId(value: any, field: string): string | undefined {
  const id = String(value || '').trim();
  if (!id) return undefined;
  return numericId(id, field);
}

function cleanUsername(value: any): string {
  const username = String(value || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error('username must be a valid X handle.');
  return username;
}

function pickQuery(args: any, allowed: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (args?.[key] !== undefined && args?.[key] !== null && args?.[key] !== '') out[key] = args[key];
  }
  return out;
}

function clampMaxResults(value: any, fallback?: number): number | undefined {
  const n = Number(value || fallback || 0);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

async function fetchXApi(path: string, init: RequestInit & { query?: Record<string, any> } = {}): Promise<any> {
  const token = await getValidXApiToken(getConfigDir());
  const requestPath = buildXApiPath(path, init.query);
  const res = await fetch(`${X_API_BASE_URL}${requestPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`X API ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return {};
  const text = await res.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function getAuthenticatedXUser(): Promise<{ id: string; username?: string; name?: string; raw: any }> {
  const data = await fetchXApi('/users/me?user.fields=username,name');
  const user = data?.data || {};
  const id = String(user?.id || '').trim();
  if (!id) throw new Error('X API did not return the authenticated user ID.');
  return {
    id,
    username: user?.username ? String(user.username) : undefined,
    name: user?.name ? String(user.name) : undefined,
    raw: data,
  };
}

async function resolveUserId(args: any): Promise<string> {
  const provided = optionalNumericId(args?.user_id, 'user_id');
  if (provided) return provided;
  const user = await getAuthenticatedXUser();
  return user.id;
}

function postQuery(args: any): Record<string, any> {
  return pickQuery(args, ['expansions', 'tweet.fields', 'user.fields', 'media.fields', 'poll.fields', 'place.fields']);
}

function timelineQuery(args: any): Record<string, any> {
  return {
    ...postQuery(args),
    ...pickQuery(args, ['pagination_token', 'since_id', 'until_id', 'start_time', 'end_time', 'exclude']),
    ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
  };
}

function usersQuery(args: any): Record<string, any> {
  return {
    ...pickQuery(args, ['pagination_token', 'user.fields', 'expansions', 'tweet.fields']),
    ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
  };
}

function listBody(args: any): Record<string, any> {
  const body: Record<string, any> = {};
  if (args?.name !== undefined) body.name = String(args.name).trim();
  if (args?.description !== undefined) body.description = String(args.description).trim();
  if (args?.private !== undefined) body.private = Boolean(args.private);
  return body;
}

async function xApiPostUserAction(path: string, body: Record<string, any>): Promise<any> {
  return fetchXApi(path, { method: 'POST', body: JSON.stringify(body) });
}

async function xApiDelete(path: string, body?: Record<string, any>): Promise<any> {
  return fetchXApi(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
}

async function executeXApiTool(name: string, args: any): Promise<{ success: boolean; tool: string; data?: any; error?: string }> {
  try {
    if (name === X_API_ME_TOOL_NAME) {
      const user = await getAuthenticatedXUser();
      return { success: true, tool: name, data: user.raw };
    }

    if (name === X_API_REQUEST_TOOL_NAME) {
      const method = String(args?.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        return { success: false, tool: name, error: 'method must be GET, POST, PUT, or DELETE.' };
      }
      const path = buildXApiPath(String(args?.path || ''), args?.query || {});
      const data = await fetchXApi(path, {
        method,
        body: method === 'GET' ? undefined : JSON.stringify(args?.body || {}),
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}`, { query: postQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_POSTS_TOOL_NAME) {
      const ids = Array.isArray(args?.post_ids || args?.tweet_ids) ? (args.post_ids || args.tweet_ids) : [];
      const cleanIds = ids.map((id: any) => numericId(id, 'post_ids')).slice(0, 100);
      if (!cleanIds.length) return { success: false, tool: name, error: 'post_ids is required.' };
      const data = await fetchXApi('/tweets', { query: { ids: cleanIds.join(','), ...postQuery(args) } });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEARCH_RECENT_TOOL_NAME || name === X_API_SEARCH_ALL_TOOL_NAME) {
      const query = String(args?.query || '').trim();
      if (!query) return { success: false, tool: name, error: 'query is required.' };
      const path = name === X_API_SEARCH_RECENT_TOOL_NAME ? '/tweets/search/recent' : '/tweets/search/all';
      const data = await fetchXApi(path, {
        query: {
          query,
          ...timelineQuery(args),
          next_token: args?.next_token || args?.pagination_token,
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_DELETE_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await xApiDelete(`/tweets/${encodeURIComponent(postId)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_BOOKMARK_TOOL_NAME || name === X_API_DELETE_BOOKMARK_TOOL_NAME) {
      const postId = String(args?.post_id || args?.tweet_id || '').trim();
      if (!/^[0-9]{1,19}$/.test(postId)) {
        return { success: false, tool: name, error: 'post_id must be a numeric X post ID.' };
      }
      const user = await getAuthenticatedXUser();
      const path = name === X_API_CREATE_BOOKMARK_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/bookmarks`
        : `/users/${encodeURIComponent(user.id)}/bookmarks/${encodeURIComponent(postId)}`;
      const data = await fetchXApi(path, {
        method: name === X_API_CREATE_BOOKMARK_TOOL_NAME ? 'POST' : 'DELETE',
        body: name === X_API_CREATE_BOOKMARK_TOOL_NAME
          ? JSON.stringify({ tweet_id: postId })
          : undefined,
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_BOOKMARKS_TOOL_NAME) {
      const user = await getAuthenticatedXUser();
      const data = await fetchXApi(`/users/${encodeURIComponent(user.id)}/bookmarks`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_POST_TOOL_NAME) {
      const text = String(args?.text || '').trim();
      if (!text) return { success: false, tool: name, error: 'text is required.' };
      const replyTo = String(args?.reply_to_post_id || '').trim();
      const body: Record<string, any> = { text };
      if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
      const data = await fetchXApi('/tweets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_LIKE_POST_TOOL_NAME || name === X_API_UNLIKE_POST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const user = await getAuthenticatedXUser();
      const path = name === X_API_LIKE_POST_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/likes`
        : `/users/${encodeURIComponent(user.id)}/likes/${encodeURIComponent(postId)}`;
      const data = name === X_API_LIKE_POST_TOOL_NAME
        ? await xApiPostUserAction(path, { tweet_id: postId })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIKED_POSTS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/liked_tweets`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIKING_USERS_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}/liking_users`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_REPOST_TOOL_NAME || name === X_API_UNREPOST_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const user = await getAuthenticatedXUser();
      const path = name === X_API_REPOST_TOOL_NAME
        ? `/users/${encodeURIComponent(user.id)}/retweets`
        : `/users/${encodeURIComponent(user.id)}/retweets/${encodeURIComponent(postId)}`;
      const data = name === X_API_REPOST_TOOL_NAME
        ? await xApiPostUserAction(path, { tweet_id: postId })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_REPOSTED_BY_TOOL_NAME) {
      const postId = numericId(args?.post_id || args?.tweet_id, 'post_id');
      const data = await fetchXApi(`/tweets/${encodeURIComponent(postId)}/retweeted_by`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_REPOSTS_OF_ME_TOOL_NAME) {
      const data = await fetchXApi('/users/reposts_of_me', { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_TOOL_NAME) {
      const userId = numericId(args?.user_id, 'user_id');
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}`, { query: pickQuery(args, ['user.fields', 'expansions', 'tweet.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_BY_USERNAME_TOOL_NAME) {
      const username = cleanUsername(args?.username || args?.handle);
      const data = await fetchXApi(`/users/by/username/${encodeURIComponent(username)}`, { query: pickQuery(args, ['user.fields', 'expansions', 'tweet.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USER_POSTS_TOOL_NAME || name === X_API_GET_USER_MENTIONS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const suffix = name === X_API_GET_USER_POSTS_TOOL_NAME ? 'tweets' : 'mentions';
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/${suffix}`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_FOLLOWERS_TOOL_NAME || name === X_API_GET_FOLLOWING_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const suffix = name === X_API_GET_FOLLOWERS_TOOL_NAME ? 'followers' : 'following';
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/${suffix}`, { query: usersQuery(args) });
      return { success: true, tool: name, data };
    }

    if (
      name === X_API_FOLLOW_USER_TOOL_NAME ||
      name === X_API_UNFOLLOW_USER_TOOL_NAME ||
      name === X_API_MUTE_USER_TOOL_NAME ||
      name === X_API_UNMUTE_USER_TOOL_NAME ||
      name === X_API_BLOCK_USER_TOOL_NAME ||
      name === X_API_UNBLOCK_USER_TOOL_NAME
    ) {
      const targetUserId = numericId(args?.target_user_id || args?.user_id, 'target_user_id');
      const user = await getAuthenticatedXUser();
      const action = name.includes('follow') ? 'following' : name.includes('mute') ? 'muting_users' : 'blocking';
      const isDelete = name === X_API_UNFOLLOW_USER_TOOL_NAME || name === X_API_UNMUTE_USER_TOOL_NAME || name === X_API_UNBLOCK_USER_TOOL_NAME;
      const path = isDelete
        ? `/users/${encodeURIComponent(user.id)}/${action}/${encodeURIComponent(targetUserId)}`
        : `/users/${encodeURIComponent(user.id)}/${action}`;
      const data = isDelete
        ? await xApiDelete(path)
        : await xApiPostUserAction(path, { target_user_id: targetUserId });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}`, { query: pickQuery(args, ['list.fields', 'expansions', 'user.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_OWNED_LISTS_TOOL_NAME) {
      const userId = await resolveUserId(args);
      const data = await fetchXApi(`/users/${encodeURIComponent(userId)}/owned_lists`, { query: pickQuery(args, ['list.fields', 'pagination_token', 'max_results']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_LIST_POSTS_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}/tweets`, { query: timelineQuery(args) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_CREATE_LIST_TOOL_NAME) {
      const body = listBody(args);
      if (!body.name) return { success: false, tool: name, error: 'name is required.' };
      const data = await xApiPostUserAction('/lists', body);
      return { success: true, tool: name, data };
    }

    if (name === X_API_UPDATE_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await fetchXApi(`/lists/${encodeURIComponent(listId)}`, { method: 'PUT', body: JSON.stringify(listBody(args)) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_DELETE_LIST_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const data = await xApiDelete(`/lists/${encodeURIComponent(listId)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_ADD_LIST_MEMBER_TOOL_NAME || name === X_API_REMOVE_LIST_MEMBER_TOOL_NAME) {
      const listId = numericId(args?.list_id, 'list_id');
      const userId = numericId(args?.user_id || args?.target_user_id, 'user_id');
      const path = `/lists/${encodeURIComponent(listId)}/members/${encodeURIComponent(userId)}`;
      const data = name === X_API_ADD_LIST_MEMBER_TOOL_NAME
        ? await fetchXApi(path, { method: 'POST' })
        : await xApiDelete(path);
      return { success: true, tool: name, data };
    }

    if (
      name === X_API_FOLLOW_LIST_TOOL_NAME ||
      name === X_API_UNFOLLOW_LIST_TOOL_NAME ||
      name === X_API_PIN_LIST_TOOL_NAME ||
      name === X_API_UNPIN_LIST_TOOL_NAME
    ) {
      const listId = numericId(args?.list_id, 'list_id');
      const user = await getAuthenticatedXUser();
      const relation = name === X_API_FOLLOW_LIST_TOOL_NAME || name === X_API_UNFOLLOW_LIST_TOOL_NAME ? 'followed_lists' : 'pinned_lists';
      const isDelete = name === X_API_UNFOLLOW_LIST_TOOL_NAME || name === X_API_UNPIN_LIST_TOOL_NAME;
      const path = `/users/${encodeURIComponent(user.id)}/${relation}${isDelete ? `/${encodeURIComponent(listId)}` : ''}`;
      const data = isDelete ? await xApiDelete(path) : await xApiPostUserAction(path, { list_id: listId });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEARCH_SPACES_TOOL_NAME) {
      const query = String(args?.query || '').trim();
      if (!query) return { success: false, tool: name, error: 'query is required.' };
      const data = await fetchXApi('/spaces/search', {
        query: {
          query,
          state: args?.state || 'all',
          ...pickQuery(args, ['space.fields', 'expansions']),
          ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_SPACE_TOOL_NAME) {
      const spaceId = String(args?.space_id || '').trim();
      if (!spaceId) return { success: false, tool: name, error: 'space_id is required.' };
      const data = await fetchXApi(`/spaces/${encodeURIComponent(spaceId)}`, { query: pickQuery(args, ['space.fields', 'expansions', 'user.fields']) });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_TRENDS_TOOL_NAME) {
      const woeid = numericId(args?.woeid, 'woeid');
      const data = await fetchXApi(`/trends/by/woeid/${encodeURIComponent(woeid)}`);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_PERSONALIZED_TRENDS_TOOL_NAME) {
      const data = await fetchXApi('/trends/personalized', {
        query: clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {},
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_DM_EVENTS_TOOL_NAME) {
      const data = await fetchXApi('/dm_events', {
        query: {
          ...pickQuery(args, ['pagination_token', 'event_types', 'dm_event.fields', 'dm_event_fields', 'expansions', 'user.fields', 'tweet.fields']),
          ...(clampMaxResults(args?.max_results, 25) ? { max_results: clampMaxResults(args?.max_results, 25) } : {}),
        },
      });
      return { success: true, tool: name, data };
    }

    if (name === X_API_SEND_DM_TOOL_NAME) {
      const text = String(args?.text || '').trim();
      if (!text) return { success: false, tool: name, error: 'text is required.' };
      const conversationId = String(args?.dm_conversation_id || '').trim();
      const participantId = optionalNumericId(args?.participant_id, 'participant_id');
      const body = { text };
      const path = conversationId
        ? `/dm_conversations/${encodeURIComponent(conversationId)}/messages`
        : `/dm_conversations/with/${encodeURIComponent(participantId || '')}/messages`;
      if (!conversationId && !participantId) return { success: false, tool: name, error: 'participant_id or dm_conversation_id is required.' };
      const data = await xApiPostUserAction(path, body);
      return { success: true, tool: name, data };
    }

    if (name === X_API_GET_USAGE_TOOL_NAME) {
      const data = await fetchXApi('/usage/tweets');
      return { success: true, tool: name, data };
    }

    return { success: false, tool: name, error: `Unknown X API tool: ${name}` };
  } catch (err: any) {
    return { success: false, tool: name, error: String(err?.message || err) };
  }
}

export async function handleXAISearchTool(name: string, args: any): Promise<{ result: string; error: boolean; data?: any }> {
  try {
    if (name === X_SEARCH_TOOL_NAME) {
      const out = await executeXSearch(args || {});
      const stdout = out.success
        ? `${out.answer || ''}${out.inline_citations && out.inline_citations.length > 0 ? '\n\nCitations:\n' + out.inline_citations.map((c, i) => `[${i + 1}] ${c.title || ''} - ${c.url}`).join('\n') : ''}`
        : `x_search failed: ${out.error || 'unknown error'}`;
      return { result: stdout, error: !out.success, data: out };
    }
    if (name === XAI_LIVE_SEARCH_TOOL_NAME) {
      const out = await executeLiveSearch(args || {});
      const stdout = out.success
        ? `${out.answer || ''}${out.citations && out.citations.length > 0 ? '\n\nSources:\n' + out.citations.map((c, i) => `[${i + 1}] ${c}`).join('\n') : ''}`
        : `xai_live_search failed: ${out.error || 'unknown error'}`;
      return { result: stdout, error: !out.success, data: out };
    }
    if (name.startsWith('x_api_')) {
      const out = await executeXApiTool(name, args || {});
      return {
        result: out.success
          ? JSON.stringify(out.data || {}, null, 2)
          : `${name} failed: ${out.error || 'unknown error'}`,
        error: !out.success,
        data: out,
      };
    }
    return { result: `Unknown xAI tool: ${name}`, error: true };
  } catch (err: any) {
    return { result: `xAI tool error: ${String(err?.message || err)}`, error: true };
  }
}
