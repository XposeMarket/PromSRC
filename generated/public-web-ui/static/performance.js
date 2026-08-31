const shouldBootMobile = window.__PROM_SHOULD_BOOT_MOBILE?.() === true;

// performance.js is shared by both documents. Resolve the surface before any
// desktop module is requested so the mobile entry never parses or evaluates a
// composer, side-chat workspace, context tracker, or optional desktop feature.
const desktopFeatureLoads = new Map();

function loadDesktopFeature(name, loader) {
  if (shouldBootMobile) return Promise.resolve(null);
  if (!desktopFeatureLoads.has(name)) {
    desktopFeatureLoads.set(name, loader().catch((error) => {
      desktopFeatureLoads.delete(name);
      console.warn(`[${name}] Desktop feature failed to load:`, error);
      throw error;
    }));
  }
  return desktopFeatureLoads.get(name);
}

function startDesktopFeature(name, loader) {
  void loadDesktopFeature(name, loader).catch(() => {});
}

function activateDesktopPageFeatures(mode) {
  if (shouldBootMobile) return;
  const page = String(mode || '').trim().toLowerCase();
  if (page === 'chat') {
    startDesktopFeature('Chat Intent', () => import('./features/chat/multi-chat-intent.js'));
  }
  if (page === 'subagents' || page === 'teams') {
    // Keep these calls as a retry path if a desktop entry chunk failed on the
    // first attempt. Successful loads are keyed and therefore not duplicated.
    startDesktopFeature('Prom Bot', () => import('./prom-bot.js')
      .then(() => import('./prom-bot-roster.js'))
      .then(() => import('./prom-bot-collab.js'))
      .then(() => import('./prom-bot-collab-hardening.js'))
      .then(() => import('./team-prom-bot-flow.js')));
    startDesktopFeature('Canonical Composer', () => import('./features/chat/canonical-desktop-composer.js'));
    startDesktopFeature('Bot Create', () => import('./bot-create.js')
      .then(() => import('./bot-create-settings-bridge.js')));
  }
}

function installTurnDiffIntent() {
  const selector = '.file-changes-card .file-change-row.is-openable';
  const activate = async (event) => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target?.closest?.(selector);
    if (!row) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const feature = await loadDesktopFeature('Turn Diff', () => import('./features/chat/desktop-turn-file-diff.js'));
      feature?.openTurnFileDiff?.(row);
    } catch {}
  };
  document.addEventListener('click', activate, true);
  document.addEventListener('keydown', activate, true);
}

if (!shouldBootMobile) {
  // Prom Bot and Bot Create own controls in the global desktop sidebar. They
  // must be ready on the initial Chat route rather than waiting for a
  // Subagents or Teams page activation. The heavier Chat workspace remains
  // page-gated above.
  startDesktopFeature('Prom Bot', () => import('./prom-bot.js')
    .then(() => import('./prom-bot-roster.js'))
    .then(() => import('./prom-bot-collab.js'))
    .then(() => import('./prom-bot-collab-hardening.js'))
    .then(() => import('./team-prom-bot-flow.js')));
  startDesktopFeature('Bot Create', () => import('./bot-create.js')
    .then(() => import('./bot-create-settings-bridge.js')));
  window.addEventListener('prometheus:page-activated', (event) => {
    activateDesktopPageFeatures(event?.detail?.mode);
  });
  installTurnDiffIntent();
  window.__PROM_DESKTOP_FEATURE_LOADS = () => Object.freeze([...desktopFeatureLoads.keys()].sort());
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
