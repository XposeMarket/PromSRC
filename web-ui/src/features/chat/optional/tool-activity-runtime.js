// Keep the rich tool/terminal renderer out of plain text chat. The facade
// preserves the synchronous call surface used by desktop and mobile while the
// real feature is fetched only after a tool activity record actually exists.

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

export function loadToolActivityFeature() {
  if (feature) return Promise.resolve(feature);
  if (featureError) return Promise.reject(featureError);
  if (!featurePromise) {
    publishState('loading');
    featurePromise = import('../../../tool-activity.js')
      .then((module) => {
        feature = module;
        publishState('ready');
        flushPending(module);
        return module;
      })
      .catch((error) => {
        featureError = error;
        publishState('error', error);
        pendingOperations.length = 0;
        throw error;
      });
  }
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
    || /^tool_(?:call|result|progress)$/i.test(String(entry?.eventType || entry?.type || ''))
  ));
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
  if (feature) return feature.coalesceToolActivityEntries(entries);
  if (hasStructuredActivity(entries)) {
    void loadToolActivityFeature().catch(() => {});
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
  return `<div class="tool-activity-entry tool-activity-entry--loading" data-tool-activity-loading="true"><span>${escapeHtml(label)}</span></div>`;
}

export function appendCommandTerminalChunkToDom(runId, chunk, sequence = 0) {
  if (feature) return feature.appendCommandTerminalChunkToDom(runId, chunk, sequence);
  defer((module) => module.appendCommandTerminalChunkToDom(runId, chunk, sequence));
  return false;
}

export function getToolActivityFeatureState() {
  return Object.freeze({
    state: feature ? 'ready' : featureError ? 'error' : featurePromise ? 'loading' : 'idle',
    pendingOperations: pendingOperations.length,
  });
}
