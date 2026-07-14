/**
 * inhouse-browser-preload.js — runs inside the Prometheus in-house browser
 * WebContentsView (the embedded native browser surface).
 *
 * Its only job today is Teach-mode capture: when the renderer turns capture on,
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
    text: sensitive ? '' : String((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    // A human label that ISN'T the typed value (for naming fill steps).
    label: sensitive ? 'Sensitive field' : String((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title'))) || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    editable: tag === 'input' || tag === 'textarea' || el.isContentEditable === true,
    sensitive,
    bounds: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
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
