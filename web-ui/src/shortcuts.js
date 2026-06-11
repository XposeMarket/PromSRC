/**
 * shortcuts.js - Global keyboard shortcuts for the desktop web UI.
 *
 * Lightweight registry modeled on the creative-editor shortcut pattern
 * (components/creative/editor/shortcuts/index.js), but attached once at
 * app startup and active across the whole shell.
 *
 * Usage:
 *   import { registerShortcut, initGlobalShortcuts } from './shortcuts.js';
 *   initGlobalShortcuts();
 */

const bindings = [];

function normalizeCombo(combo) {
  return combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean).sort().join('+');
}

function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) parts.push(key);
  return parts.sort().join('+');
}

function isEditableTarget(e) {
  const tag = e.target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!e.target?.isContentEditable;
}

/**
 * Register a global keyboard shortcut.
 * @param {string} combo - e.g. 'ctrl+k', 'ctrl+shift+l', 'ctrl+/'
 * @param {(e: KeyboardEvent) => void} handler
 * @param {{ allowInInputs?: boolean, preventDefault?: boolean }} [opts]
 */
export function registerShortcut(combo, handler, opts = {}) {
  bindings.push({
    combo: normalizeCombo(combo),
    handler,
    allowInInputs: !!opts.allowInInputs,
    preventDefault: opts.preventDefault !== false,
  });
}

function onKeyDown(e) {
  const combo = comboFromEvent(e);
  const editable = isEditableTarget(e);
  for (const b of bindings) {
    if (b.combo !== combo) continue;
    if (editable && !b.allowInInputs) continue;
    if (b.preventDefault) e.preventDefault();
    b.handler(e);
    return;
  }
}

let initialized = false;

export function initGlobalShortcuts() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', onKeyDown);

  // New chat
  registerShortcut('ctrl+n', () => {
    if (typeof window.newChatSession === 'function') window.newChatSession();
  }, { allowInInputs: true });

  // Command palette
  registerShortcut('ctrl+k', () => {
    import('./command-palette.js').then((m) => m.openCommandPalette());
  }, { allowInInputs: true });

  // Keyboard shortcuts help
  registerShortcut('ctrl+/', () => {
    import('./shortcuts-help.js').then((m) => m.toggleShortcutsHelp());
  }, { allowInInputs: true });
}
