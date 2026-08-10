/**
 * inhouse-browser-preload.js — runs inside the Prometheus in-house browser
 * WebContentsView (the embedded native browser surface).
 *
 * It supports Teach-mode capture and the native Design interaction layer: when
 * the renderer turns capture/design on,
 * we intercept the user's clicks in the capturing phase (so the page does NOT act
 * on them), describe the clicked element, and relay it to the main process, which
 * forwards it to the Prometheus renderer to stage a Teach step. When capture is
 * off (the normal case, and while a staged step is pending), clicks pass straight
 * through to the page so Co-pilot control and Teach "Continue" execution work.
 *
 * Sandbox-safe: only uses ipcRenderer + DOM. No other Node APIs.
 */
const { ipcRenderer } = require('electron');

let teachCapture = false;
let designMode = false;
let designSelectMode = false;
let designOverlay = null;
let designSelectedInfo = null;
let designMultiSelections = [];
let lastHoverAt = 0;
try { console.log('[inhouse-preload] loaded'); } catch {}

function cssEscape(value) {
  try { return (window.CSS && window.CSS.escape) ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  catch { return String(value); }
}

// Build a reasonably-stable CSS selector for the element (id wins; otherwise a
// short structural path with nth-of-type disambiguation).
function buildSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return '#' + cssEscape(el.id);
  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 6) {
    if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
    let part = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
    }
    parts.unshift(part);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

function isSensitiveElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = String(el.tagName || '').toLowerCase();
  const type = String((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
  if (tag === 'input' && ['password'].includes(type)) return true;
  const autocomplete = String((el.getAttribute && el.getAttribute('autocomplete')) || '').toLowerCase();
  if (/^(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)$/.test(autocomplete)) return true;
  const hints = [
    el.id,
    el.getAttribute && el.getAttribute('name'),
    el.getAttribute && el.getAttribute('aria-label'),
    el.getAttribute && el.getAttribute('placeholder'),
    el.getAttribute && el.getAttribute('data-testid'),
  ].filter(Boolean).join(' ').toLowerCase();
  return /(?:password|passwd|passcode|one[ _-]?time|\botp\b|\btotp\b|\bpin\b|security[ _-]?code|\bcvv\b|\bcvc\b|card[ _-]?number|payment|recovery[ _-]?(?:code|key|phrase)|seed[ _-]?phrase|private[ _-]?key|api[ _-]?key|access[ _-]?token|auth[ _-]?token|client[ _-]?secret)/i.test(hints);
}

function describeElement(el) {
  if (!el || el.nodeType !== 1) return null;
  const rect = el.getBoundingClientRect();
  const tag = String(el.tagName || '').toLowerCase();
  const sensitive = isSensitiveElement(el);
  return {
    selector: buildSelector(el),
    tagName: tag,
    id: String(el.id || ''),
    role: String((el.getAttribute && el.getAttribute('role')) || ''),
    classList: Array.from(el.classList || []).slice(0, 24),
    text: sensitive ? '' : String((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    // A human label that ISN'T the typed value (for naming fill steps).
    label: sensitive ? 'Sensitive field' : String((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title'))) || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    editable: tag === 'input' || tag === 'textarea' || el.isContentEditable === true,
    sensitive,
    htmlSnippet: sensitive ? '' : String(el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: String(window.location.href || ''),
    title: String(document.title || ''),
  };
}

function elementValue(el) {
  if (!el) return '';
  if (el.value != null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return String(el.value);
  if (el.isContentEditable) return String(el.innerText || el.textContent || '');
  return '';
}

ipcRenderer.on('prometheus-teach-capture', (_event, enabled) => {
  teachCapture = !!enabled;
  try { console.log('[inhouse-preload] capture=' + teachCapture); } catch {}
});

function isDesignOverlayTarget(target) {
  return !!(designOverlay && target && designOverlay.contains(target));
}

function ensureDesignOverlay() {
  if (designOverlay || !document.body) return designOverlay;
  designOverlay = document.createElement('div');
  designOverlay.id = 'prometheus-native-design-overlay';
  designOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  designOverlay.innerHTML = `
    <div data-design-highlight style="display:none;position:fixed;pointer-events:none;border:2px solid #38bdf8;background:rgba(56,189,248,0.1);box-shadow:0 0 0 1px rgba(2,6,23,0.55),0 0 22px rgba(56,189,248,0.34);border-radius:4px;transition:all 70ms ease"></div>
    <div data-design-toolbar style="display:none;position:fixed;pointer-events:auto;align-items:center;gap:4px;padding:5px;border:1px solid rgba(125,211,252,0.36);border-radius:10px;background:rgba(8,15,28,0.97);box-shadow:0 12px 28px rgba(2,6,23,0.5);backdrop-filter:blur(12px)">
      <button data-design-action="edit" style="border:0;border-radius:7px;padding:7px 10px;background:rgba(249,115,22,0.18);color:#fed7aa;font:700 11px sans-serif;cursor:pointer">Edit</button>
      <button data-design-action="chat" style="border:0;border-radius:7px;padding:7px 10px;background:rgba(56,189,248,0.18);color:#bae6fd;font:700 11px sans-serif;cursor:pointer">Chat</button>
      <button data-design-action="select" style="border:0;border-radius:7px;padding:7px 10px;background:rgba(168,85,247,0.2);color:#e9d5ff;font:700 11px sans-serif;cursor:pointer">Select</button>
    </div>
    <div data-design-chat style="display:none;position:fixed;pointer-events:auto;width:min(350px,calc(100vw - 24px));padding:11px;border:1px solid rgba(125,211,252,0.36);border-radius:11px;background:rgba(8,15,28,0.98);box-shadow:0 16px 36px rgba(2,6,23,0.56);backdrop-filter:blur(14px)">
      <div data-design-chat-label style="font-size:11px;font-weight:800;color:#e0f2fe;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
      <textarea data-design-chat-input rows="3" placeholder="What should Prometheus change or explain?" style="width:100%;box-sizing:border-box;margin-top:8px;resize:vertical;border:1px solid rgba(148,163,184,0.2);border-radius:8px;background:rgba(15,23,42,0.8);color:#f8fafc;padding:8px;font:11px/1.45 sans-serif"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button data-design-chat-close style="border:1px solid rgba(148,163,184,0.2);border-radius:7px;padding:6px 9px;background:transparent;color:#cbd5e1;font:700 10px sans-serif;cursor:pointer">Close</button><button data-design-chat-send style="border:1px solid rgba(56,189,248,0.35);border-radius:7px;padding:6px 10px;background:rgba(56,189,248,0.17);color:#e0f2fe;font:800 10px sans-serif;cursor:pointer">Send to chat</button></div>
    </div>
  `;
  document.body.appendChild(designOverlay);
  const toolbar = designOverlay.querySelector('[data-design-toolbar]');
  toolbar?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const action = String(event.target?.closest?.('[data-design-action]')?.dataset?.designAction || '').trim();
    if (!action || !designSelectedInfo) return;
    ipcRenderer.send('prometheus-design-action', { action, selection: designSelectedInfo, selections: designMultiSelections });
    if (action === 'select') {
      designSelectMode = true;
      if (!designMultiSelections.some((entry) => entry.selector === designSelectedInfo.selector && entry.bounds?.x === designSelectedInfo.bounds?.x && entry.bounds?.y === designSelectedInfo.bounds?.y)) {
        designMultiSelections.push(designSelectedInfo);
      }
      toolbar.style.display = 'none';
      return;
    }
    const chat = designOverlay.querySelector('[data-design-chat]');
    const input = designOverlay.querySelector('[data-design-chat-input]');
    const label = designOverlay.querySelector('[data-design-chat-label]');
    if (label) label.textContent = action === 'edit' ? 'Edit this browser element' : 'Chat about this browser element';
    if (input) input.value = action === 'edit' ? 'Edit this browser element so that ' : '';
    if (chat) {
      chat.style.display = 'block';
      positionDesignBox(chat, designSelectedInfo, true);
      input?.focus();
    }
  });
  designOverlay.querySelector('[data-design-chat-close]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const chat = designOverlay.querySelector('[data-design-chat]');
    if (chat) chat.style.display = 'none';
  });
  designOverlay.querySelector('[data-design-chat-send]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const input = designOverlay.querySelector('[data-design-chat-input]');
    const text = String(input?.value || '').trim();
    if (!text || !designSelectedInfo) return;
    ipcRenderer.send('prometheus-design-chat', { text, selection: designSelectedInfo, selections: designMultiSelections });
    const chat = designOverlay.querySelector('[data-design-chat]');
    if (chat) chat.style.display = 'none';
  });
  return designOverlay;
}

function positionDesignBox(box, info, below = false) {
  if (!box || !info?.bounds) return;
  const bounds = info.bounds;
  const width = box.offsetWidth || 240;
  const height = box.offsetHeight || 40;
  let left = Number(bounds.x) || 8;
  let top = below ? (Number(bounds.y) || 8) + (Number(bounds.height) || 0) + 8 : (Number(bounds.y) || 8) - height - 8;
  if (top < 8) top = (Number(bounds.y) || 8) + (Number(bounds.height) || 0) + 8;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  box.style.left = `${Math.max(8, left)}px`;
  box.style.top = `${Math.max(8, top)}px`;
}

function renderDesignOverlay(info) {
  const overlay = ensureDesignOverlay();
  if (!overlay || !info?.bounds) return;
  const highlight = overlay.querySelector('[data-design-highlight]');
  const toolbar = overlay.querySelector('[data-design-toolbar]');
  if (highlight) {
    highlight.style.display = 'block';
    highlight.style.left = `${Math.max(0, Number(info.bounds.x) || 0)}px`;
    highlight.style.top = `${Math.max(0, Number(info.bounds.y) || 0)}px`;
    highlight.style.width = `${Math.max(1, Number(info.bounds.width) || 1)}px`;
    highlight.style.height = `${Math.max(1, Number(info.bounds.height) || 1)}px`;
  }
  if (toolbar && designSelectedInfo) {
    toolbar.style.display = 'flex';
    positionDesignBox(toolbar, designSelectedInfo, true);
  }
}

function hideDesignOverlay() {
  if (!designOverlay) return;
  designOverlay.remove();
  designOverlay = null;
  designSelectedInfo = null;
  designMultiSelections = [];
  designSelectMode = false;
}

ipcRenderer.on('prometheus-design-mode', (_event, payload = {}) => {
  designMode = payload?.enabled === true;
  if (designMode) ensureDesignOverlay();
  else hideDesignOverlay();
  try { console.log('[inhouse-preload] design=' + designMode); } catch {}
});

window.addEventListener('pointermove', (event) => {
  if (!designMode || event.isTrusted !== true || isDesignOverlayTarget(event.target)) return;
  const info = describeElement(event.target);
  if (!info) return;
  renderDesignOverlay(info);
  const now = Date.now();
  if (now - lastHoverAt < 70) return;
  lastHoverAt = now;
  ipcRenderer.send('prometheus-design-hover', { x: Math.round(event.clientX), y: Math.round(event.clientY), ...info });
}, true);

window.addEventListener('click', (event) => {
  if (!designMode || event.isTrusted !== true || event.button !== 0 || isDesignOverlayTarget(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const info = describeElement(event.target);
  if (!info) return;
  designSelectedInfo = info;
  if (designSelectMode && !designMultiSelections.some((entry) => entry.selector === info.selector && entry.bounds?.x === info.bounds?.x && entry.bounds?.y === info.bounds?.y)) {
    designMultiSelections.push(info);
  }
  ensureDesignOverlay();
  renderDesignOverlay(info);
  ipcRenderer.send('prometheus-design-select', { selection: info, selections: designMultiSelections, selectMode: designSelectMode });
}, true);

// Live-macro recording: while capturing, REPORT the click (so Prometheus records
// a step) but let it pass through to the page so the workflow advances naturally —
// exactly like a macro recorder. We report on the trailing click (not pointerdown)
// so we capture the element that actually received the activation.
window.addEventListener('click', (event) => {
  try { console.log('[inhouse-preload] click capture=' + teachCapture + ' btn=' + event.button); } catch {}
  if (!teachCapture || event.isTrusted !== true) return;
  if (event.button !== 0) return;
  const info = describeElement(event.target);
  ipcRenderer.send('prometheus-teach-click', {
    x: Math.round(event.clientX),
    y: Math.round(event.clientY),
    button: event.button,
    ...(info || {}),
  });
}, true);

// ── Typing capture ──────────────────────────────────────────────────────────
// Accumulate input into the focused field and emit ONE fill step when the user
// finishes (blur, focus change, or a submit/navigation key), so we record the
// final text rather than one step per keystroke.
let pendingFill = null;

function flushPendingFill() {
  if (!pendingFill) return;
  const f = pendingFill;
  pendingFill = null;
  if (f.sensitive) return;
  const text = elementValue(f.el);
  if (!text) return;
  ipcRenderer.send('prometheus-teach-fill', {
    selector: f.selector,
    text: text,
    label: f.label,
    tagName: f.tagName,
    role: f.role,
    bounds: f.bounds,
  });
}

window.addEventListener('input', (event) => {
  if (!teachCapture || event.isTrusted !== true) return;
  const el = event.target;
  if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)) return;
  const info = describeElement(el);
  // New target — flush the previous field first.
  if (pendingFill && pendingFill.el !== el) flushPendingFill();
  pendingFill = { el, selector: info.selector, label: info.label, tagName: info.tagName, role: info.role, bounds: info.bounds, sensitive: info.sensitive === true };
}, true);

window.addEventListener('blur', (event) => {
  if (!teachCapture || event.isTrusted !== true) return;
  if (pendingFill && event.target === pendingFill.el) flushPendingFill();
}, true);

// ── Special keys ────────────────────────────────────────────────────────────
window.addEventListener('keydown', (event) => {
  if (!teachCapture || event.isTrusted !== true) return;
  const key = String(event.key || '');
  if (['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    // Commit any typed text as a fill step BEFORE the submit/navigation key.
    flushPendingFill();
    ipcRenderer.send('prometheus-teach-key', {
      key,
      ctrlKey: event.ctrlKey === true,
      altKey: event.altKey === true,
      metaKey: event.metaKey === true,
      shiftKey: event.shiftKey === true,
    });
  }
}, true);

// ── Scroll capture (debounced into bursts) ──────────────────────────────────
let scrollAccumX = 0;
let scrollAccumY = 0;
let scrollTimer = 0;
window.addEventListener('wheel', (event) => {
  if (!teachCapture || event.isTrusted !== true) return;
  scrollAccumX += event.deltaX || 0;
  scrollAccumY += event.deltaY || 0;
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const dx = scrollAccumX;
    const dy = scrollAccumY;
    scrollAccumX = 0; scrollAccumY = 0; scrollTimer = 0;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    ipcRenderer.send('prometheus-teach-scroll', { deltaX: Math.round(dx), deltaY: Math.round(dy) });
  }, 450);
}, true);

// Lightweight hover reporting for the recording highlight overlay.
window.addEventListener('pointermove', (event) => {
  if (!teachCapture || event.isTrusted !== true) return;
  const now = Date.now();
  if (now - lastHoverAt < 90) return;
  lastHoverAt = now;
  const info = describeElement(event.target);
  if (info) ipcRenderer.send('prometheus-teach-hover', { x: Math.round(event.clientX), y: Math.round(event.clientY), ...info });
}, true);
