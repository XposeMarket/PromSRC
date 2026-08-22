import './features/chat/multi-chat-workspace.js';
import './context-window-live-tracking.js';

if (!window.__PROM_SHOULD_BOOT_MOBILE?.()) {
  void import('./prom-bot.js')
    .then(() => import('./prom-bot-roster.js'))
    .then(() => import('./prom-bot-collab.js'))
    .then(() => import('./prom-bot-collab-hardening.js'))
    .then(() => import('./team-prom-bot-flow.js'))
    .catch((error) => console.warn('[Prom Bot] Desktop shell failed to load:', error));
}

/**
 * Privacy-conscious client performance marks.
 *
 * Marks stay in the current page unless a benchmark explicitly reads the
 * in-memory ring. We retain timing and opaque correlation identifiers only;
 * message text, token text, URLs with query data, and request bodies are never
 * accepted as detail fields.
 */

const MAX_EVENTS = 400;
const events = [];
const SAFE_STRING_KEYS = new Set(['traceId', 'clientRequestId', 'runtimeId', 'streamId', 'surface', 'telemetryId', 'toolCallId', 'toolFamily', 'toolName']);
const SAFE_NUMBER_KEYS = new Set(['elapsedMs', 'durationMs', 'seq', 'count', 'size', 'bytes', 'eventCount', 'resultBytes', 'resultTokens', 'dispatchMs', 'executorMs', 'firstOutputMs', 'resultToModelMs', 'modelToVisibleMs', 'toolWallMs', 'transportMs']);

function safeString(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160);
}

function safeDetails(input) {
  if (!input || typeof input !== 'object') return {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (SAFE_STRING_KEYS.has(key)) {
      const clean = safeString(value);
      if (clean) output[key] = clean;
      continue;
    }
    if (SAFE_NUMBER_KEYS.has(key)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) output[key] = Math.max(0, Math.round(numeric * 100) / 100);
    }
  }
  return output;
}

export function markClientPerformance(name, details = {}) {
  const cleanName = safeString(name).slice(0, 100) || 'mark';
  const at = performance.now();
  const safe = safeDetails(details);
  const entry = { name: cleanName, atMs: Math.round(at * 100) / 100, ...safe };
  events.push(entry);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  try {
    performance.mark(`prom:${cleanName}`, { detail: safe });
  } catch {}
  // Only the already-scrubbed entry is published. This lets the context meter
  // react to current-turn tool token telemetry without exposing message/tool text.
  try {
    window.dispatchEvent(new CustomEvent('prometheus:client-performance-mark', { detail: entry }));
  } catch {}
  return at;
}

export function getClientPerformanceEvents() {
  return events.slice();
}

window.__PROM_PERF_MARK = markClientPerformance;
window.__PROM_PERF_GET_EVENTS = getClientPerformanceEvents;

// Bot creation is a desktop shell affordance. performance.js is also imported
// by the mobile router, so keep these modules completely out of the PWA runtime.
if (!window.__PROM_SHOULD_BOOT_MOBILE?.()) {
  void import('./bot-create.js')
    .then(() => import('./bot-create-settings-bridge.js'))
    .catch((error) => {
      console.warn('[Bot Create] Desktop creation module failed to load:', error);
    });
}
