/**
 * state.js — F1 Scaffold
 *
 * All mutable global state lives here. Pages import and mutate directly.
 * No getters/setters — keep it simple for this phase.
 *
 * Usage:
 *   import { state } from './state.js';
 *   state.currentMode = 'teams';
 *   if (state.isThinking) { ... }
 */

export const state = {
  // ─── App Shell ───────────────────────────────────────────────
  currentMode: 'chat',
  sidebarTab: 'jobs',
  useAgentMode: true,

  // ─── WebSocket ───────────────────────────────────────────────
  ws: null,

  // ─── Chat / Sessions ────────────────────────────────────────
  chatHistory: [],
  chatSessions: [],
  activeChatSessionId: null,
  agentSessionId: '',
  streamingSessionId: null,
  isThinking: false,
  sessionsEditMode: false,

  // ─── Process Log ─────────────────────────────────────────────
  processLogEntries: [],
  currentTurnStartIndex: -1,
  lastAgentMode: '-',
  lastTurnKind: '-',
  processLogAutoFollow: true,
  rightColumnAutoFollow: true,

  // ─── Progress / Preflight ────────────────────────────────────
  runtimeProgressState: { source: 'none', activeIndex: -1, items: [] },
  currentPreflightStatus: '',
  currentProgressLines: [],

  // ─── Quick Settings ──────────────────────────────────────────
  quickSearchRigor: 'verified',
  quickThinkingEffort: localStorage.getItem('prometheus_quick_thinking_effort') || 'standard',

  // ─── Queued Prompts ──────────────────────────────────────────
  queuedPrompts: [],

  // ─── Agent Execution (right panel) ───────────────────────────
  agentExecutionMap: new Map(),
  agentIdCounter: 0,

  // ─── Settings / Agents ───────────────────────────────────────
  agentsConfigList: [],
  selectedAgentId: '',
  agentMdEditor: null,
  heartbeatEditor: null,
  heartbeatSettingsLoaded: false,
  heartbeatSettingsCache: {
    enabled: false,
    intervalMinutes: 30,
    quietHoursStart: null,
    quietHoursEnd: null,
    md: '',
  },
  lastHeartbeat: {
    timestamp: null,
    status: null,
    summary: null,
    agentCount: 0,
    nextRun: null,
  },
  lastHeartbeatLogSignature: '',
  settingsTab: 'system',

  // ─── Schedule ────────────────────────────────────────────────
  allJobs: [],
  selectedJobId: null,
  pollInterval: null,

  // ─── Tasks / BGT ─────────────────────────────────────────────
  // bgtOpenTaskId is managed locally in TasksPage but referenced by WS handler
  bgtOpenTaskId: null,
};

// ─── Constants ──────────────────────────────────────────────────
export const API = '';
export const CHAT_SESSIONS_KEY = 'prometheus_chat_sessions_v1';
export const AGENT_SESSION_KEY = 'prometheus_agent_session_id';
export const THEME_KEY = 'prometheus_theme';
export const MAX_QUEUED_PROMPTS = 8;
export const AGENT_STATUS = { ACTIVE: 'active', COMPLETED: 'completed', PAUSED: 'paused' };
