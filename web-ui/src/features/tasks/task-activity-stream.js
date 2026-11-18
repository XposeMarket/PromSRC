// Tasks Activity tab rendered with the SAME tool-stream renderer the chat uses
// (clean tool labels, icons, inline details), instead of raw tool ids.
// Task journals only keep compact one-line call/result records, so they are
// adapted into the chat's legacy trace-entry shape before coalescing.
import {
  coalesceToolActivityEntries,
  installToolActivityExpansionPersistence,
  loadToolActivityFeature,
  renderToolActivityEntry,
} from '../chat/optional/tool-activity-runtime.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Journal call text is `name({json...})` (JSON may be truncated); planned runs store bare JSON. */
export function parseTaskToolArgs(call, name = '') {
  let body = String(call || '').trim();
  const wrapped = body.match(/^([\w.:-]+)\(([\s\S]*)\)$/);
  if (wrapped && (!name || wrapped[1] === name)) body = wrapped[2];
  if (!body.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Truncated JSON: salvage complete simple string/number/bool fields only.
    const out = {};
    for (const m of body.matchAll(/"([\w-]+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)/g)) {
      try { out[m[1]] = JSON.parse(m[2]); } catch { /* skip */ }
    }
    return out;
  }
}

/** Journal result text is `name: result`; strip the redundant prefix. */
export function taskToolResultText(result, name = '') {
  const text = String(result || '');
  return name && text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

/** Collapsed task rows of type "tool" → chat trace entries (call + result pairs). */
export function taskToolEntries(rows, { live = false, scope = 'task' } = {}) {
  const entries = [];
  (Array.isArray(rows) ? rows : []).forEach((row, idx) => {
    if (!row || row.type !== 'tool') return;
    const action = String(row.name || 'tool').trim() || 'tool';
    const callId = `${scope}:${idx}:${row.t || 0}`;
    const args = parseTaskToolArgs(row.call, action);
    entries.push({ type: 'tool', text: action, timestamp: row.t, extra: { action, toolName: action, args, callId, event: 'tool_call' } });
    // A finished task never shows a forever-spinning call: close it with an empty result.
    if (row.pending && live) return;
    const result = taskToolResultText(row.result, action);
    entries.push({ type: row.error ? 'error' : 'result', text: result, timestamp: row.t, extra: { action, toolName: action, callId, result, error: row.error === true, event: 'tool_result' } });
  });
  return entries;
}

/**
 * Render collapsed activity rows. Consecutive tool rows become one chat-style
 * tool stream; status/error/hidden rows still use the caller's renderer.
 */
export function renderTaskActivityStream(rows, { renderOther, live = false, scope = 'task', className = 'task-tool-stream' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const entries = coalesceToolActivityEntries(taskToolEntries(run, { live, scope: `${scope}:${out.length}` }));
    out.push(`<div class="${className}" data-task-tool-stream>${entries.map(entry => renderToolActivityEntry(entry, escape)).join('')}</div>`);
    run = [];
  };
  list.forEach((row, idx) => {
    if (row?.type === 'tool') { run.push(row); return; }
    flush();
    out.push(typeof renderOther === 'function' ? renderOther(row, idx) : '');
  });
  flush();
  return out.join('');
}

let readyListenerInstalled = false;
const readyCallbacks = new Set();
/** Repaint hook: the rich renderer chunk loads lazily on first use. */
export function onTaskToolStreamReady(callback, root = null) {
  if (typeof callback === 'function') readyCallbacks.add(callback);
  if (root) { try { installToolActivityExpansionPersistence(root); } catch { /* optional */ } }
  if (!readyListenerInstalled && typeof window !== 'undefined') {
    readyListenerInstalled = true;
    window.addEventListener('prometheus:tool-activity-ready', () => {
      for (const cb of readyCallbacks) { try { cb(); } catch { /* ignore */ } }
    });
  }
  void loadToolActivityFeature().catch(() => {});
  return () => readyCallbacks.delete(callback);
}
