/**
 * api.js — F1 Scaffold
 *
 * Centralized fetch wrapper and API endpoint constants.
 *
 * Usage:
 *   import { api } from './api.js';
 *   const data = await api('/api/teams');
 *   const result = await api('/api/teams', { method: 'POST', body: JSON.stringify(payload) });
 */

import { API } from './state.js';

const LOCAL_GATEWAY_ORIGIN = 'http://127.0.0.1:18789';

function buildApiCandidateUrls(path) {
  const rawPath = String(path || '');
  const candidates = [];
  const pushCandidate = (url) => {
    if (!url || candidates.includes(url)) return;
    candidates.push(url);
  };

  pushCandidate(API + rawPath);

  if (rawPath.startsWith('/api/')) {
    try {
      const origin = String(window.location?.origin || '').trim();
      if (API && /^https?:/i.test(origin)) pushCandidate(origin.replace(/\/$/, '') + rawPath);
    } catch {}

    try {
      const currentOrigin = String(window.location?.origin || '').replace(/\/$/, '');
      const currentProtocol = String(window.location?.protocol || '').toLowerCase();
      if (currentProtocol !== 'https:' && currentOrigin !== LOCAL_GATEWAY_ORIGIN) pushCandidate(LOCAL_GATEWAY_ORIGIN + rawPath);
    } catch {
      pushCandidate(LOCAL_GATEWAY_ORIGIN + rawPath);
    }
  }

  return candidates;
}

function shouldRetryApiRequest(err) {
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  return (
    name === 'AbortError' ||
    /Failed to fetch|NetworkError|Load failed|Request timed out/i.test(message)
  );
}

// Coalesce identical in-flight GETs.  The desktop shell has several legacy
// loaders that can legitimately ask for the same read while a page module is
// still booting.  Sharing only the in-flight promise avoids stale caching and
// leaves mutations and explicit no-store reads untouched.
const inFlightGetRequests = new Map();

function getDedupeKey(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (method !== 'GET' || opts?.signal || opts?.cache === 'no-store' || opts?.dedupe === false) return '';
  return String(path || '');
}

async function apiRequest(path, opts = {}) {
  const candidates = buildApiCandidateUrls(path);
  let lastError = null;
  const timeoutMs = Number(opts.timeoutMs || 10000);
  const { timeoutMs: _timeoutMs, dedupe: _dedupe, ...fetchOpts } = opts;
  const parentSignal = fetchOpts.signal;
  const body = fetchOpts.body;
  const shouldStringifyBody = body
    && typeof body === 'object'
    && !(body instanceof FormData)
    && !(body instanceof Blob)
    && !(body instanceof ArrayBuffer)
    && !(body instanceof URLSearchParams);
  if (shouldStringifyBody) fetchOpts.body = JSON.stringify(body);

  for (let index = 0; index < candidates.length; index++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      // Attach the paired-device token if the mobile UI has one stored.
      // Desktop loaders never set this, so the header is omitted there.
      let pairingHeader = {};
      try {
        const tok = localStorage.getItem('pm_device_token');
        if (tok) pairingHeader = { 'X-Pairing-Token': tok };
      } catch {}
      const mergedHeaders = { 'Content-Type': 'application/json', ...pairingHeader, ...(fetchOpts.headers || {}) };
      const r = await fetch(candidates[index], {
        ...fetchOpts,
        headers: mergedHeaders,
        signal: controller.signal,
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`API ${r.status}: ${body}`);
      }
      return r.json();
    } catch (err) {
      if (parentSignal?.aborted) throw err;
      lastError = err?.name === 'AbortError' ? new Error('Request timed out') : err;
      if (!shouldRetryApiRequest(err) || index === candidates.length - 1) throw lastError;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.('abort', onParentAbort);
    }
  }

  throw lastError || new Error('Request failed');
}

/**
 * Fetch wrapper with JSON content-type and error handling.
 * Returns parsed JSON response.
 */
export function api(path, opts = {}) {
  const key = getDedupeKey(path, opts);
  if (!key) return apiRequest(path, opts);
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing;
  const request = apiRequest(path, opts).finally(() => {
    if (inFlightGetRequests.get(key) === request) inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, request);
  return request;
}

// Expose on window
window.api = api;

// ─── Endpoint Constants ──────────────────────────────────────────
// These are for documentation and autocomplete. Pages can import
// them or just pass string literals to api() — both are fine.

export const ENDPOINTS = {
  // Chat
  CHAT: '/api/chat',
  STATUS: '/api/status',

  // Tasks / BGT
  BG_TASKS: '/api/bg-tasks',
  bgTask: (id) => `/api/bg-tasks/${id}`,
  bgTaskAction: (id, action) => `/api/bg-tasks/${id}/${action}`,
  bgTaskSkillProposal: (id) => `/api/bg-tasks/${encodeURIComponent(id)}/skill-proposal`,

  // Processes / command runs
  PROCESSES: '/api/processes',
  processRun: (id) => `/api/processes/${encodeURIComponent(id)}`,
  processRunLog: (id) => `/api/processes/${encodeURIComponent(id)}/log`,
  processRunAction: (id, action) => `/api/processes/${encodeURIComponent(id)}/${action}`,
  processRunRerun: (id) => `/api/processes/${encodeURIComponent(id)}/rerun`,

  // Coding workspace
  CODING_SESSION: '/api/coding/session',
  CODING_STATUS: '/api/coding/status',
  CODING_REPOSITORY: '/api/coding/repository',
  CODING_DIFF: '/api/coding/diff',
  CODING_BRANCH: '/api/coding/branch',
  CODING_STAGE: '/api/coding/stage',
  CODING_COMMIT: '/api/coding/commit',

  // Schedule / Jobs
  JOBS: '/api/jobs',
  job: (id) => `/api/jobs/${id}`,

  // Teams
  TEAMS: '/api/teams',
  team: (id) => `/api/teams/${encodeURIComponent(id)}`,
  teamAction: (id, action) => `/api/teams/${encodeURIComponent(id)}/${action}`,

  // Agents
  AGENTS: '/api/agents',
  agent: (id) => `/api/agents/${encodeURIComponent(id)}`,
  agentAction: (id, action) => `/api/agents/${encodeURIComponent(id)}/${action}`,
  AGENT_HISTORY: '/api/agents/history',

  // Proposals
  PROPOSALS: '/api/proposals',
  proposalAction: (id, action) => `/api/proposals/${id}/${action}`,

  // Approvals
  APPROVALS: '/api/approvals',
  approval: (id) => `/api/approvals/${id}`,

  // Audit
  AUDIT_LOG: '/api/audit-log',
  MEMORY_GRAPH: '/api/memory/graph',
  memoryRecord: (id) => `/api/memory/record/${encodeURIComponent(id)}`,
  MEMORY_CREATE: '/api/memory/create',
  MEMORY_REFRESH: '/api/memory/refresh',
  OBSIDIAN_STATUS: '/api/obsidian/status',
  OBSIDIAN_VAULTS: '/api/obsidian/vaults',
  obsidianVault: (id) => `/api/obsidian/vaults/${encodeURIComponent(id)}`,
  OBSIDIAN_SYNC: '/api/obsidian/sync',
  OBSIDIAN_WRITEBACK: '/api/obsidian/writeback',

  // Settings
  SETTINGS_PROVIDER: '/api/settings/provider',
  SETTINGS_MODEL: '/api/settings/model',
  SETTINGS_SEARCH: '/api/settings/search',
  SETTINGS_PATHS: '/api/settings/paths',
  SETTINGS_HEARTBEAT: '/api/settings/heartbeat',
  SETTINGS_HOOKS: '/api/settings/hooks',

  // Heartbeat
  HEARTBEAT_AGENTS: '/api/heartbeat/agents',
  heartbeatAgent: (id) => `/api/heartbeat/agents/${encodeURIComponent(id)}`,

  // Channels
  CHANNELS_STATUS: '/api/channels/status',
  CHANNELS_CONFIG: '/api/channels/config',
  channelTest: (ch) => `/api/channels/test/${ch}`,
  channelSendTest: (ch) => `/api/channels/send-test/${ch}`,

  // Models
  MODELS_TEST: '/api/models/test',
  OLLAMA_MODELS: '/api/ollama/models',
  OPENAI_MODELS: '/api/openai/models',

  // Auth
  AUTH_OPENAI_STATUS: '/api/auth/openai/status',
  AUTH_OPENAI_START: '/api/auth/openai/start',
  AUTH_OPENAI_MANUAL: '/api/auth/openai/manual',
  AUTH_OPENAI_DISCONNECT: '/api/auth/openai/disconnect',

  // Credentials
  CREDENTIALS_STATUS: '/api/credentials/status',
  CREDENTIALS_AUDIT: '/api/credentials/audit',

  // Connections
  EXTENSIONS_CATALOG: '/api/extensions/catalog',
  CONNECTIONS: '/api/connections',
  CONNECTIONS_CREDENTIALS: '/api/connections/credentials',
  CONNECTIONS_SAVE: '/api/connections/save',
  CONNECTIONS_DISCONNECT: '/api/connections/disconnect',
  CONNECTIONS_OAUTH_START: '/api/connections/oauth/start',
  CONNECTIONS_OAUTH_POLL: '/api/connections/oauth/poll',
  CONNECTIONS_XURL_SETUP: '/api/connections/xurl/setup',
  CONNECTIONS_XURL_POLL: '/api/connections/xurl/poll',
  CONNECTIONS_BROWSER_OPEN: '/api/connections/browser-open',
  CONNECTIONS_BROWSER_VERIFY: '/api/connections/browser-verify',
  CONNECTIONS_ACTIVITY: '/api/connections/activity',

  // MCP
  MCP_SERVERS: '/api/mcp/servers',
  mcpServer: (id) => `/api/mcp/servers/${id}`,
  mcpServerAction: (id, action) => `/api/mcp/servers/${id}/${action}`,

  // Skills
  SKILLS: '/api/skills',

  // Shortcuts
  SHORTCUTS: '/api/shortcuts',
  INSTALLED_APPS: '/api/installed-apps',
  INSTALLED_APPS_SEARCH: '/api/installed-apps/search',

  // Canvas
  CANVAS_FILE: '/api/canvas/file',
  CANVAS_HISTORY: '/api/canvas/history',
  CANVAS_HISTORY_RESTORE: '/api/canvas/history/restore',
  CANVAS_UPLOAD: '/api/canvas/upload',
  CANVAS_FILES: '/api/canvas/files',

  // System
  SYSTEM_STATS: '/api/system-stats',
  MEMORY_CONFIRM: '/api/memory/confirm',
  OPEN_PATH: '/api/open-path',
};
