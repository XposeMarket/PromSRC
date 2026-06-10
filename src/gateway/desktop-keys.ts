// ─── Canonical key model: shared across desktop backends ──────────────────────
//
// The `desktop_press_key` tool accepts a human/SendKeys-ish string ("enter",
// "ctrl+s", "alt+f4"). To keep that public contract identical across platforms,
// we parse it ONCE into a platform-neutral DesktopCanonicalKey, then each backend
// emits it natively:
//   - Win32:  canonicalKeyToSendKeys()  -> System.Windows.Forms.SendKeys syntax
//   - Darwin: (Phase A) canonicalKeyToCGEvent() -> CGEvent keycodes in the helper
//
// desktop-tools.ts's toSendKeysSpec() delegates here, so there is no second
// mapping to drift out of sync.

import type { DesktopCanonicalKey, DesktopModifier } from './desktop-backend.js';

/** Parse a "+"-separated key spec ("ctrl+shift+s", "enter", "f5") into the
 *  canonical model. Modifier synonyms are normalized: control->ctrl,
 *  command/cmd->cmd, option->alt. The final token is the base key. */
export function parseCanonicalKey(raw: string): DesktopCanonicalKey {
  const text = String(raw || '').trim();
  if (!text) return { key: '', modifiers: [] };

  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  // Base-key case is preserved (emitters normalize per platform); only modifier
  // synonyms are normalized. This matches the original toSendKeysSpec behavior,
  // which passed single chars through unchanged.
  if (parts.length <= 1) return { key: parts[0] || text, modifiers: [] };

  const modifiers: DesktopModifier[] = [];
  for (const m of parts.slice(0, -1)) {
    const mm = m.toLowerCase();
    if (mm === 'ctrl' || mm === 'control') modifiers.push('ctrl');
    else if (mm === 'cmd' || mm === 'command') modifiers.push('cmd');
    else if (mm === 'shift') modifiers.push('shift');
    else if (mm === 'alt' || mm === 'option') modifiers.push('alt');
  }
  return { key: parts[parts.length - 1], modifiers };
}

/** Map a canonical base-key token to its SendKeys representation. Mirrors the
 *  original toSendKeysSpec mapBase() exactly. */
function baseKeyToSendKeys(token: string): string {
  const t = token.toLowerCase();
  if (t === 'enter' || t === 'return') return '{ENTER}';
  if (t === 'escape' || t === 'esc') return '{ESC}';
  if (t === 'tab') return '{TAB}';
  if (t === 'space') return ' ';
  if (t === 'backspace') return '{BACKSPACE}';
  if (t === 'delete' || t === 'del') return '{DEL}';
  if (t === 'up' || t === 'arrowup') return '{UP}';
  if (t === 'down' || t === 'arrowdown') return '{DOWN}';
  if (t === 'left' || t === 'arrowleft') return '{LEFT}';
  if (t === 'right' || t === 'arrowright') return '{RIGHT}';
  if (t === 'pagedown' || t === 'pgdn') return '{PGDN}';
  if (t === 'pageup' || t === 'pgup') return '{PGUP}';
  if (t === 'home') return '{HOME}';
  if (t === 'end') return '{END}';
  if (t === 'insert' || t === 'ins') return '{INS}';
  const fn = t.match(/^f([1-9]|1[0-2])$/);
  if (fn) return `{F${fn[1]}}`;
  // Single alphanumerics and unknown tokens pass through unchanged.
  return token;
}

/** Emit a DesktopCanonicalKey as a Windows SendKeys spec. Empty key -> {ENTER}
 *  (preserves the original default). On Windows, 'cmd' has no equivalent and is
 *  treated as ctrl, matching prior behavior. */
export function canonicalKeyToSendKeys(key: DesktopCanonicalKey): string {
  if (!key.key && key.modifiers.length === 0) return '{ENTER}';
  const base = baseKeyToSendKeys(key.key || '');
  let mods = '';
  for (const m of key.modifiers) {
    if (m === 'ctrl' || m === 'cmd') mods += '^';
    else if (m === 'shift') mods += '+';
    else if (m === 'alt') mods += '%';
  }
  return `${mods}${base}`;
}
