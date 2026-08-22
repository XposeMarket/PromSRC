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

function getMobileGatewayRequestContext() {
  try {
    const rawOrigin = String(window.__pmMobileActiveGatewayOrigin || '').trim();
    if (!rawOrigin) return null;
    const pageOrigin = String(window.location?.origin || '').trim() || 'http://localhost';
    const origin = new URL(rawOrigin, pageOrigin).origin;
    const apiOrigin = new URL(String(API || '').trim() || pageOrigin, pageOrigin).origin;
    return {
      gatewayId: String(window.__pmMobileActiveGatewayId || '').trim(),
      origin,
      token: String(window.__pmMobileActiveGatewayToken || '').trim(),
      executionEnabled: window.__pmMobileActiveGatewayExecutionEnabled === true,
      remote: origin !== apiOrigin,
    };
  } catch {
    return null;
  }
}

function assertRemoteMobileGatewayTarget(target) {
  if (!target?.remote) return;
  if (target.executionEnabled && target.token) return;
  const error = new Error(target.token
    ? 'Remote execution is not enabled for this gateway target. Refresh the gateway connection and try again.'
    : 'This gateway is not paired on this phone. Reconnect it before sending a request.');
  error.code = target.token ? 'REMOTE_EXECUTION_NOT_ENABLED' : 'GATEWAY_NOT_PAIRED';
  throw error;
}

function buildApiCandidateUrls(path) {
  const rawPath = String(path || '');
  const candidates = [];
  const pushCandidate = (url) => {
    if (!url || candidates.includes(url)) return;
    candidates.push(url);
  };

  // The mobile multi-gateway shell sets an explicit target before loading or
  // mutating gateway-owned data. Never fall back to this PWA's original API
  // origin while a different computer is selected: doing so can read or write
  // the wrong Prometheus instance with the wrong device grant.
  const mobileTarget = getMobileGatewayRequestContext();
  if (mobileTarget?.remote && rawPath.startsWith('/api/')) {
    assertRemoteMobileGatewayTarget(mobileTarget);
    pushCandidate(mobileTarget.origin.replace(/\/$/, '') + rawPath);
    return candidates;
  }

  pushCandidate(API + rawPath);

  if (rawPath.startsWith('/api/')) {
    try {
      const origin = String(window.location?.origin || '').trim();
      if (API && /^https?:/i.test(origin)) pushCandidate(origin.replace(/\/$/, '') + rawPath);
    } catch {}
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
  const target = getMobileGatewayRequestContext();
  const scope = target?.remote
    ? `gateway:${target.gatewayId || target.origin}`
    : 'default';
  return `${scope}:${String(path || '')}`;
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
      // Attach the target-scoped paired-device grant when the mobile shell is
      // pointed at a remote gateway. The legacy device token remains valid only
      // for this PWA's original/current gateway.
      let pairingHeader = {};
      try {
        const mobileTarget = getMobileGatewayRequestContext();
        if (mobileTarget?.remote) {
          assertRemoteMobileGatewayTarget(mobileTarget);
          pairingHeader = { 'X-Pairing-Token': mobileTarget.token };
        } else {
          const tok = localStorage.getItem('pm_device_token');
          if (tok) pairingHeader = { 'X-Pairing-Token': tok };
        }
      } catch (error) {
        if (error?.code === 'REMOTE_EXECUTION_NOT_ENABLED' || error?.code === 'GATEWAY_NOT_PAIRED') throw error;
      }
      const mergedHeaders = { 'Content-Type': 'application/json', ...pairingHeader, ...(fetchOpts.headers || {}) };
      const r = await fetch(candidates[index], {
        ...fetchOpts,
        headers: mergedHeaders,
        signal: controller.signal,
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`API ${r.status}: ${getApiErrorMessage(body)}`);
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

/** Keep failed API responses actionable without leaking whole JSON payloads. */
export function getApiErrorMessage(body, fallback = 'Request failed') {
  let message = String(body || '').trim();
  if (message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === 'object') {
        message = String(parsed.error || parsed.message || parsed.detail || '').trim();
      }
    } catch {
      // The server may have returned a plain-text error.
    }
  }
  message = message.replace(/\s+/g, ' ').trim();
  if (!message) return fallback;
  return message.length > 500 ? `${message.slice(0, 499).trimEnd()}…` : message;
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
  CODING_CONTEXT: '/api/coding/context',
  CODING_TREE: '/api/coding/tree',
  CODING_DIFF: '/api/coding/diff',
  CODING_BRANCHES: '/api/coding/branches',
  CODING_HISTORY: '/api/coding/history',
  CODING_PRS: '/api/coding/prs',
  CODING_CHECKS: '/api/coding/checks',
  CODING_BRANCH: '/api/coding/branch',
  CODING_CHECKOUT: '/api/coding/checkout',
  CODING_PUSH: '/api/coding/push',
  CODING_PULL: '/api/coding/pull',
  CODING_PR: '/api/coding/pr',
  CODING_STAGE: '/api/coding/stage',
  CODING_UNSTAGE: '/api/coding/unstage',
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
