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

/**
 * Fetch wrapper with JSON content-type and error handling.
 * Returns parsed JSON response.
 */
export async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, signal: controller.signal, ...opts });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`API ${r.status}: ${body}`);
    }
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
  MEMORY_REFRESH: '/api/memory/refresh',

  // Settings
  SETTINGS_PROVIDER: '/api/settings/provider',
  SETTINGS_MODEL: '/api/settings/model',
  SETTINGS_SEARCH: '/api/settings/search',
  SETTINGS_AGENT: '/api/settings/agent',
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
  CONNECTIONS: '/api/connections',
  CONNECTIONS_SAVE: '/api/connections/save',
  CONNECTIONS_DISCONNECT: '/api/connections/disconnect',
  CONNECTIONS_OAUTH_START: '/api/connections/oauth/start',
  CONNECTIONS_OAUTH_POLL: '/api/connections/oauth/poll',
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

  // Canvas
  CANVAS_FILE: '/api/canvas/file',
  CANVAS_UPLOAD: '/api/canvas/upload',
  CANVAS_FILES: '/api/canvas/files',

  // System
  SYSTEM_STATS: '/api/system-stats',
  MEMORY_CONFIRM: '/api/memory/confirm',
  OPEN_PATH: '/api/open-path',
};
