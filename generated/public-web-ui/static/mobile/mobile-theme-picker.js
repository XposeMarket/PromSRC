// Drawer theme gestures and a registry-backed, non-persisting preview wheel.
import { pmHaptic, attachMobileHapticGestureSurface } from './mobile-model-badge.js';

export function bindMobileThemePicker(button, { themes, current, apply, cycle }) {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  const cssUrl = new URL('../styles/mobile-theme-picker.css', import.meta.url);
  if (cssUrl.pathname.includes('/build/')) cssUrl.pathname = '/static/styles/mobile-theme-picker.css';
  css.href = cssUrl.href;
  if (!document.querySelector('link[data-mobile-theme-picker]')) {
    css.dataset.mobileThemePicker = '1'; document.head.append(css);
  }
  // Keep the native switch outside the button: theme label/icon updates must
  // never remove the live touch target or its change listener.
  const host = document.createElement('span');
  host.className = 'pm-haptic-host';
  button.replaceWith(host); host.append(button);
  const input = document.createElement('input');
  input.type = 'checkbox'; input.setAttribute('switch', '');
  input.className = 'pm-haptic-switch-overlay'; input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true'); host.append(input);
  // pressSeq counts physical presses; activatedSeq is the press that already
  // stepped the theme. Dedupe is per press, never by time, so fast taps all count.
  let timer = null, origin = null, held = false, moved = false, pressSeq = 0, activatedSeq = -1;
  const clear = () => { clearTimeout(timer); timer = null; };
  const openWheel = () => openThemeWheel(button, { themes, current, apply });
  // Touch and pointer both start a press (iOS may deliver only one of them once
  // its native switch claims the touch). Restarting is harmless.
  let pressOpen = false;
  const begin = (x, y) => {
    // touchstart and pointerdown of the same finger share one press.
    if (!pressOpen) { pressSeq += 1; pressOpen = true; }
    clear(); held = false; moved = false;
    origin = { x, y };
    timer = setTimeout(() => { timer = null; held = true; openWheel(); }, 420);
  };
  const track = (x, y) => {
    if (origin && Math.hypot(x - origin.x, y - origin.y) > 10) { moved = true; clear(); }
  };
  // One physical tap can surface as the switch `change`, the switch `click`, or
  // the button `click`. Whichever arrives first activates; the others inside the
  // window belong to the same tap, so a tap is always exactly one step.
  const activate = () => {
    clear();
    if (held || moved) return;
    // Keyboard/AT activations arrive without a press; give them their own.
    if (!pressOpen && activatedSeq === pressSeq) pressSeq += 1;
    if (activatedSeq === pressSeq) return;
    activatedSeq = pressSeq;
    cycle();
  };
  host.addEventListener('pointerdown', (event) => begin(event.clientX, event.clientY));
  host.addEventListener('touchstart', (event) => { const t = event.touches[0]; if (t) begin(t.clientX, t.clientY); }, { passive: true });
  host.addEventListener('pointermove', (event) => track(event.clientX, event.clientY));
  host.addEventListener('touchmove', (event) => { const t = event.touches[0]; if (t) track(t.clientX, t.clientY); }, { passive: true });
  // iOS sends pointercancel when its native switch takes over the touch. That is
  // not a drag, so it must not veto the tap (it used to set `moved`, which
  // silently swallowed taps on real iPhones). Only release ends the long press.
  // The press stays open until its trailing click/change have been delivered.
  const release = () => { clear(); setTimeout(() => { pressOpen = false; }, 0); };
  host.addEventListener('pointerup', release);
  host.addEventListener('touchend', release, { passive: true });
  host.addEventListener('touchcancel', release, { passive: true });
  host.addEventListener('contextmenu', (event) => event.preventDefault());
  input.addEventListener('change', activate);
  input.addEventListener('click', (event) => {
    if (held || moved) { event.preventDefault(); event.stopPropagation(); return; }
    activate();
  });
  button.addEventListener('click', (event) => { event.stopPropagation(); if (!held && !moved) pmHaptic(10); activate(); });
  button.addEventListener('keydown', (event) => {
    held = false; moved = false;
    if (event.key === 'ArrowDown') { event.preventDefault(); openWheel(); }
  });
  button.setAttribute('aria-haspopup', 'dialog');
}

const PREVIEW_KEYS = ['bg', 'panel', 'text', 'accent', 'muted', 'sidebar'];
const CARD_W = 180, CARD_GAP = 16;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
// Registry ids only: 'system' resolves to the current system target palette.
const paletteFor = (id) => window.PROM_THEME_ENGINE?.palette(
  id === 'system' ? window.PROM_RESOLVE_THEME('system', 'mobile').id : id) || {};

// Each card is a miniature of the app drawn from that theme's registry palette.
function buildMock(palette) {
  const mini = el('span', 'pm-theme-wheel-mini'); mini.setAttribute('aria-hidden', 'true');
  const side = el('span', 'pm-theme-wheel-side');
  for (let i = 0; i < 3; i++) side.append(el('i'));
  const main = el('span', 'pm-theme-wheel-main');
  main.append(el('b'), el('b', 'me'), el('b', 'short'));
  const composer = el('span', 'pm-theme-wheel-composer');
  composer.append(el('span'), el('em'));
  main.append(composer);
  mini.append(side, main, el('span', 'pm-theme-wheel-check', '\u2713'));
  for (const key of PREVIEW_KEYS) if (palette[key]) mini.style.setProperty(`--preview-${key}`, palette[key]);
  return mini;
}

// Sheet background, text and accent follow the centered theme. Setting custom
// properties on the sheet lets the CSS transitions crossfade them.
function paintSheet(sheet, themeId) {
  const palette = paletteFor(themeId);
  if (palette.bg) sheet.style.setProperty('--wheel-bg', palette.bg);
  if (palette.text) sheet.style.setProperty('--wheel-text', palette.text);
  if (palette.accent) sheet.style.setProperty('--wheel-accent', palette.accent);
  if (palette.muted) sheet.style.setProperty('--wheel-muted', palette.muted);
}

let closeActive;
export function openThemeWheel(trigger, { themes, current, apply }) {
  closeActive?.();
  // A sheet still playing its close animation must never coexist with a new one.
  document.querySelectorAll('.pm-theme-wheel-backdrop').forEach((node) => node.remove());
  const original = current();
  const list = themes();
  if (!list.length) return;
  let selected = Math.max(0, list.findIndex((theme) => theme.id === original));
  let lastTick = 0, frame = 0, closed = false, rafScroll = 0;
  const overlay = el('div', 'pm-theme-wheel-backdrop');
  const sheet = el('section', 'pm-theme-wheel');
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Choose theme');
  const handle = el('div', 'pm-theme-wheel-handle');
  const kicker = el('div', 'pm-theme-wheel-kicker', 'Appearance');
  const title = el('h2', null, 'Find your atmosphere');
  const track = el('div', 'pm-theme-wheel-track');
  track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Themes'); track.tabIndex = 0;
  const scrub = el('div', 'pm-theme-wheel-scrub'); scrub.setAttribute('aria-hidden', 'true');
  const ticks = list.map(() => { const tick = el('i'); scrub.append(tick); return tick; });
  const footer = el('div', 'pm-theme-wheel-actions');
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button';
  const use = el('button', null, 'Use theme'); use.type = 'button';
  footer.append(cancel, use);
  sheet.append(handle, kicker, title, track, scrub, footer); overlay.append(sheet);
  const cards = list.map((theme, index) => {
    const card = el('button', 'pm-theme-wheel-card');
    card.type = 'button'; card.setAttribute('role', 'option'); card.id = `pm-theme-option-${index}`;
    card.dataset.themeId = theme.id;
    if (theme.id === original) card.classList.add('is-current');
    const name = el('span', 'pm-theme-wheel-name');
    name.append(el('strong', null, theme.label));
    const word = (theme.loadingWords || [])[0];
    if (word) name.append(el('small', null, `${word}\u2026`));
    card.append(buildMock(paletteFor(theme.id)), name);
    card.addEventListener('click', () => { if (index === selected) finish(true); else { select(index); center(index); } });
    track.append(card); return card;
  });
  function select(index, tick = true, nativeTick = null) {
    const crossed = Math.abs(index - selected);
    const different = index !== selected; selected = index;
    cards.forEach((card, i) => { card.setAttribute('aria-selected', String(i === index)); card.tabIndex = i === index ? 0 : -1; card.classList.toggle('is-centered', i === index); });
    ticks.forEach((t, i) => t.classList.toggle('is-on', i === index));
    track.setAttribute('aria-activedescendant', cards[index].id);
    // Preview attributes only. Storage and prom-theme-change remain untouched
    // until Use, so cancel/reload cannot accidentally persist a preview.
    window.PROM_APPLY_THEME_ATTRIBUTES?.(list[index].id);
    overlay.dataset.previewTheme = list[index].id;
    paintSheet(sheet, list[index].id);
    // Scrub drags move a real iOS switch under the finger: one tick per theme
    // crossed. Rail scrolling has no finger-anchored switch, so it uses the
    // throttled best-effort fallback.
    if (different && tick && nativeTick) { for (let i = 0; i < crossed; i++) nativeTick(); }
    else if (different && tick && performance.now() - lastTick >= 40) { lastTick = performance.now(); pmHaptic(8); }
  }
  function center(index, smooth = true) {
    const card = cards[index];
    track.scrollTo({ left: card.offsetLeft - track.clientWidth / 2 + card.offsetWidth / 2, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  }
  // Per-frame cover-flow: transform/opacity only, driven by distance from the
  // rail midpoint. Also finds the nearest card for selection and haptics.
  function layout() {
    rafScroll = 0;
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let closest = 0, distance = Infinity;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - mid;
      const d = Math.abs(dx);
      if (d < distance) { distance = d; closest = index; }
      const t = Math.min(1, d / (CARD_W + CARD_GAP));
      const scale = 1 - 0.18 * t;
      const rot = Math.max(-28, Math.min(28, (dx / (CARD_W + CARD_GAP)) * -22));
      card.style.transform = `perspective(700px) rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = String(1 - 0.42 * t);
    });
    if (closest !== selected) select(closest);
  }
  function requestLayout() { if (!rafScroll) rafScroll = requestAnimationFrame(layout); }
  function finish(commit) {
    if (closed) return; closed = true;
    cancelAnimationFrame(frame); cancelAnimationFrame(rafScroll);
    try { scrubHaptics?.(); } catch {}
    document.removeEventListener('keydown', keys);
    closeActive = null;
    sheet.classList.add('is-closing');
    overlay.style.pointerEvents = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    const remove = () => overlay.remove();
    sheet.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 280);
    apply(commit ? list[selected].id : original);
    if (commit) pmHaptic(20);
    const focusTarget = trigger.isConnected ? trigger : document.querySelector('[data-mobile-theme-toggle]');
    focusTarget?.focus?.({ preventScroll: true });
  }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, selected + step));
      select(index); center(index);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target === track) { event.preventDefault(); finish(true); }
    if (event.key === 'Tab') {
      const focusable = [cards[selected], cancel, use];
      const index = focusable.indexOf(document.activeElement);
      event.preventDefault();
      focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    }
  }
  track.addEventListener('scroll', requestLayout, { passive: true });
  // Scrub bar: drag/tap anywhere on it to jump; one haptic per tick crossed.
  let scrubbing = false;
  const scrubTo = (clientX, gesture) => {
    const rect = scrub.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    const index = Math.floor(ratio * list.length);
    if (index !== selected) { select(index, true, gesture?.requestNativeHaptic || null); center(index, false); }
  };
  // Native haptic sensor over the scrub bar (same moving-switch technique as the
  // tab bar and reasoning slider). It sits above the sheet and forwards events.
  let scrubHaptics = null;
  try {
    scrubHaptics = attachMobileHapticGestureSurface(scrub, {
      onPointerDown: (event, gesture) => { scrubbing = true; scrubTo(event.clientX, gesture); },
      onPointerMove: (event, gesture) => { if (scrubbing) scrubTo(event.clientX, gesture); },
      onPointerUp: () => { scrubbing = false; },
      onPointerCancel: () => { scrubbing = false; },
      nativeHapticsOnMove: false,
    });
    // Measured during the rise animation; re-measure once the sheet settles.
    const refresh = () => scrubHaptics?.refresh?.();
    requestAnimationFrame(() => requestAnimationFrame(refresh));
    setTimeout(refresh, 200);
    setTimeout(refresh, 500);
    sheet.addEventListener('animationend', refresh);
  } catch { scrubHaptics = null; }
  scrub.addEventListener('pointerdown', (event) => { scrubbing = true; scrub.setPointerCapture?.(event.pointerId); scrubTo(event.clientX); });
  scrub.addEventListener('pointermove', (event) => { if (scrubbing) scrubTo(event.clientX); });
  const endScrub = () => { scrubbing = false; };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  // Swipe down on the sheet (outside the rail) cancels; the rail keeps its own pan.
  let drag;
  sheet.addEventListener('pointerdown', (event) => { if (!track.contains(event.target)) drag = { x: event.clientX, y: event.clientY }; });
  const endDrag = (point) => { if (drag && point.clientY - drag.y > 65 && Math.abs(point.clientX - drag.x) < 50) finish(false); drag = null; };
  sheet.addEventListener('pointerup', (event) => endDrag(event));
  sheet.addEventListener('touchstart', (event) => { if (!track.contains(event.target)) { const touch = event.touches[0]; drag = { x: touch.clientX, y: touch.clientY }; } }, { passive: true });
  sheet.addEventListener('touchend', (event) => { const touch = event.changedTouches[0]; if (touch) endDrag(touch); }, { passive: true });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
  cancel.addEventListener('click', () => finish(false));
  use.addEventListener('click', () => finish(true));
  document.addEventListener('keydown', keys);
  document.body.append(overlay);
  closeActive = () => finish(false);
  select(selected, false);
  center(selected, false);
  layout();
  track.focus({ preventScroll: true });
  pmHaptic(20);
}
