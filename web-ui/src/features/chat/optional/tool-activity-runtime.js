// Keep the rich tool/terminal renderer out of plain text chat. The facade
// preserves the synchronous call surface used by desktop and mobile while the
// real feature is fetched only after a tool activity record actually exists.

import { renderConnectorLogo } from '../../connectors/connector-logo-runtime.js';

let feature = null;
let featurePromise = null;
let featureError = null;
let readyDispatched = false;
const installRoots = new Set();
const pendingOperations = [];

function publishState(state, error = null) {
  if (typeof window === 'undefined') return;
  const registry = window.__PROM_OPTIONAL_CHAT_FEATURES || (window.__PROM_OPTIONAL_CHAT_FEATURES = {});
  registry.toolActivity = {
    state,
    loaded: state === 'ready',
    error: error ? String(error?.message || error) : '',
  };
}

function dispatchReady() {
  if (readyDispatched || typeof window === 'undefined') return;
  readyDispatched = true;
  try {
    window.dispatchEvent(new CustomEvent('prometheus:tool-activity-ready'));
  } catch {}
}

function flushPending(module) {
  for (const root of installRoots) {
    try { module.installToolActivityExpansionPersistence(root); } catch {}
  }
  while (pendingOperations.length) {
    const operation = pendingOperations.shift();
    try { operation(module); } catch (error) {
      console.warn('[tool activity] deferred operation failed:', error);
    }
  }
  dispatchReady();
}

function importToolActivityModule() {
  const testImporter = globalThis.__PROM_TOOL_ACTIVITY_IMPORT_FOR_TESTS;
  if (typeof testImporter === 'function') return Promise.resolve().then(() => testImporter());
  return import('../../../tool-activity.js');
}

export function loadToolActivityFeature() {
  if (feature) return Promise.resolve(feature);
  if (featurePromise) return featurePromise;
  // A failed hashed/dynamic chunk request is recoverable. Keep queued tool
  // operations intact, expose the error state, and allow the next first-use
  // attempt to request the module again without requiring a page reload.
  featureError = null;
  publishState('loading');
  featurePromise = importToolActivityModule()
    .then((module) => {
      feature = module;
      featurePromise = Promise.resolve(module);
      publishState('ready');
      flushPending(module);
      return module;
    })
    .catch((error) => {
      featureError = error;
      featurePromise = null;
      publishState('error', error);
      throw error;
    });
  return featurePromise;
}

function defer(operation) {
  pendingOperations.push(operation);
  void loadToolActivityFeature().catch((error) => {
    console.warn('[tool activity] optional feature failed to load:', error);
  });
}

function hasStructuredActivity(entries) {
  return (Array.isArray(entries) ? entries : []).some((entry) => (
    !!entry?.activity
    || /^tool_(?:call|result|progress)$/i.test(String(entry?.eventType || entry?.event || entry?.extra?.event || entry?.kind || entry?.type || ''))
    || (String(entry?.extra?.action || entry?.extra?.toolName || entry?.action || entry?.toolName || '').trim()
      && ['tool', 'skill', 'result', 'error', 'progress'].includes(String(entry?.type || '').toLowerCase()))
  ));
}

function pendingToolActivityEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.activity) return entry;
  const normalized = normalizeLegacyToolActivityEntry(entry);
  const type = String(normalized.type || '').toLowerCase();
  const event = String(normalized.eventType || normalized.event || normalized.extra?.event || '').toLowerCase();
  const resultLike = type === 'result' || type === 'error' || event === 'tool_result';
  const action = String(
    normalized.extra?.action
      || normalized.extra?.toolName
      || normalized.action
      || normalized.toolName
      || 'tool',
  ).trim() || 'tool';
  const args = normalized.extra?.args || normalized.args || {};
  const result = resultLike
    ? String(normalized.extra?.result ?? normalized.result ?? normalized.text ?? normalized.content ?? normalized.message ?? '')
    : '';
  return {
    ...normalized,
    type: resultLike ? (type === 'error' || normalized.extra?.error ? 'error' : 'result') : 'tool',
    // Do not carry a multi-kilobyte recovered result into the fallback paint.
    // The full result returns when the rich module is ready; the cold state
    // only needs a compact label that matches the live activity card.
    text: resultLike ? `${action}${type === 'error' || normalized.extra?.error ? ' failed' : ' complete'}` : `Preparing ${action}`,
    activity: {
      kind: resultLike ? 'result' : 'operation',
      action,
      technicalName: action,
      args: args && typeof args === 'object' ? args : {},
      status: resultLike ? (type === 'error' || normalized.extra?.error ? 'failed' : 'succeeded') : 'running',
      ok: resultLike ? !(type === 'error' || normalized.extra?.error) : undefined,
      result,
    },
  };
}

function normalizeLegacyToolActivityEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.activity) return entry;
  const rawType = String(entry.type || '').toLowerCase();
  const event = String(entry.eventType || entry.event || entry.extra?.event || '').toLowerCase();
  const isCall = rawType === 'tool_call' || event === 'tool_call';
  const isResult = rawType === 'tool_result' || event === 'tool_result';
  const isProgress = rawType === 'tool_progress' || event === 'tool_progress';
  if (!isCall && !isResult && !isProgress) return entry;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const action = String(extra.action || extra.toolName || entry.action || entry.toolName || '').trim();
  return {
    ...entry,
    type: isCall ? 'tool' : isResult ? (entry.error === true || extra.error === true ? 'error' : 'result') : 'progress',
    extra: {
      ...extra,
      ...(action ? { action, toolName: extra.toolName || action } : {}),
      event: event || rawType,
    },
  };
}

function normalizeLegacyToolActivityEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map(normalizeLegacyToolActivityEntry);
}

function pendingToolActivityEntries(entries) {
  return normalizeLegacyToolActivityEntries(entries).map(pendingToolActivityEntry);
}

export function installToolActivityExpansionPersistence(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  installRoots.add(root);
  if (feature) feature.installToolActivityExpansionPersistence(root);
}

export function setToolActivityDisclosureState(key, open) {
  if (feature) return feature.setToolActivityDisclosureState(key, open);
  defer((module) => module.setToolActivityDisclosureState(key, open));
  return undefined;
}

export function applyToolActivityEvent(entries, phase, payload = {}) {
  if (feature) return feature.applyToolActivityEvent(entries, phase, payload);
  defer((module) => module.applyToolActivityEvent(entries, phase, payload));
  return null;
}

export function applyCommandProcessEvent(entries, eventType, payload = {}) {
  if (feature) return feature.applyCommandProcessEvent(entries, eventType, payload);
  defer((module) => module.applyCommandProcessEvent(entries, eventType, payload));
  // The operation is accepted into the ordered queue. Returning true prevents
  // the caller from creating retry timers that would duplicate it after load.
  return true;
}

export function coalesceToolActivityEntries(entries) {
  if (feature) return feature.coalesceToolActivityEntries(normalizeLegacyToolActivityEntries(entries));
  if (hasStructuredActivity(entries)) {
    void loadToolActivityFeature().catch(() => {});
    // Never paint a recovered legacy tool/result as a giant raw protocol block
    // while the rich renderer chunk is loading. The ready event will repaint
    // these same entries through the full coalescer; this placeholder keeps the
    // first recovery paint compact even on a cold mobile launch or cache miss.
    return pendingToolActivityEntries(entries);
  }
  return Array.isArray(entries) ? entries : [];
}

export function toolActivitySummary(entries, options = {}) {
  if (feature) return feature.toolActivitySummary(entries, options);
  if (hasStructuredActivity(entries)) {
    void loadToolActivityFeature().catch(() => {});
  }
  return '';
}

export function renderToolActivityEntry(entry, escapeHtml = (value) => String(value ?? '')) {
  if (feature) return feature.renderToolActivityEntry(entry, escapeHtml);
  void loadToolActivityFeature().catch(() => {});
  const activity = entry?.activity || {};
  const label = String(activity.label || activity.action || entry?.text || 'Tool activity').trim();
  const wrench = '<svg class="tool-activity-tool-icon" data-tool-icon="wrench" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-5.8 5.8l-5.4 5.4a2.1 2.1 0 0 0 3 3l5.4-5.4a4.5 4.5 0 0 0 5.8-5.8l-3.2 3.2-2.6-.6-.6-2.6z"/></svg>';
  const icon = renderConnectorLogo(activity, escapeHtml) || wrench;
  return `<div class="tool-activity-entry tool-activity-entry--loading" data-tool-activity-loading="true"><div class="tool-activity-entry-summary">${icon}<span class="tool-activity-label">${escapeHtml(label)}</span></div></div>`;
}

export function renderToolActivityIcon(activity = {}, escapeHtml = (value) => String(value ?? '')) {
  if (feature) return feature.renderToolActivityIcon(activity, escapeHtml);
  void loadToolActivityFeature().catch(() => {});
  const connectorLogo = renderConnectorLogo(activity, escapeHtml);
  if (connectorLogo) return connectorLogo;
  return '<svg class="tool-activity-tool-icon" data-tool-icon="wrench" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-5.8 5.8l-5.4 5.4a2.1 2.1 0 0 0 3 3l5.4-5.4a4.5 4.5 0 0 0 5.8-5.8l-3.2 3.2-2.6-.6-.6-2.6z"/></svg>';
}

export function appendCommandTerminalChunkToDom(runId, chunk, sequence = 0) {
  if (feature) return feature.appendCommandTerminalChunkToDom(runId, chunk, sequence);
  defer((module) => module.appendCommandTerminalChunkToDom(runId, chunk, sequence));
  return false;
}

export function getToolActivityFeatureState() {
  return Object.freeze({
    state: feature ? 'ready' : featurePromise ? 'loading' : featureError ? 'error' : 'idle',
    pendingOperations: pendingOperations.length,
  });
}
