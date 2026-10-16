// Drawer theme gestures and a registry-backed, non-persisting preview wheel.
import { pmHaptic } from './mobile-model-badge.js';

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
  let timer, origin, held = false, moved = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  host.addEventListener('pointerdown', (event) => {
    clear(); held = false; moved = false;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => { held = true; openThemeWheel(button, { themes, current, apply }); }, 400);
  });
  host.addEventListener('pointermove', (event) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) { moved = true; clear(); }
  });
  host.addEventListener('pointerup', clear);
  host.addEventListener('pointercancel', () => { moved = true; clear(); });
  // Native iOS switch activation can deliver change without the compatibility
  // click. Both checked states are activations; click is never a second cycle.
  input.addEventListener('change', () => { if (!held && !moved) cycle(); });
  input.addEventListener('click', (event) => {
    if (held || moved) { event.preventDefault(); event.stopPropagation(); return; }
    // The checkbox's default action emits change after click. Activation is
    // deliberately owned by change alone, including direct accessibility changes.
  });
  button.addEventListener('click', () => { if (!held && !moved) { pmHaptic(10); cycle(); } });
  button.addEventListener('keydown', (event) => {
    held = false; moved = false;
    if (event.key === 'ArrowDown') { event.preventDefault(); openThemeWheel(button, { themes, current, apply }); }
  });
  button.setAttribute('aria-haspopup', 'dialog');
}

let closeActive;
export function openThemeWheel(trigger, { themes, current, apply }) {
  closeActive?.();
  const original = current();
  const list = themes();
  if (!list.length) return;
  let selected = Math.max(0, list.findIndex((theme) => theme.id === original));
  let lastTick = 0, frame = 0, closed = false;
  const overlay = document.createElement('div'); overlay.className = 'pm-theme-wheel-backdrop';
  const sheet = document.createElement('section'); sheet.className = 'pm-theme-wheel';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Choose theme');
  const handle = document.createElement('div'); handle.className = 'pm-theme-wheel-handle';
  const title = document.createElement('h2'); title.textContent = 'Find your atmosphere';
  const track = document.createElement('div'); track.className = 'pm-theme-wheel-track';
  track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Themes'); track.tabIndex = 0;
  const footer = document.createElement('div'); footer.className = 'pm-theme-wheel-actions';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  const use = document.createElement('button'); use.textContent = 'Use theme';
  footer.append(cancel, use); sheet.append(handle, title, track, footer); overlay.append(sheet);
  const cards = list.map((theme, index) => {
    const card = document.createElement('button'); card.className = 'pm-theme-wheel-card';
    card.type = 'button'; card.setAttribute('role', 'option'); card.id = `pm-theme-option-${index}`;
    card.dataset.themeId = theme.id;
    const palette = window.PROM_THEME_ENGINE?.palette(theme.id === 'system' ? window.PROM_RESOLVE_THEME('system', 'mobile').id : theme.id);
    if (palette) for (const key of ['bg', 'panel', 'text', 'accent']) {
      if (palette[key]) card.style.setProperty(`--preview-${key}`, palette[key]);
    }
    const preview = document.createElement('span'); preview.className = 'pm-theme-wheel-mini'; preview.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) preview.append(document.createElement('i'));
    const label = document.createElement('span'); label.textContent = theme.label;
    card.append(preview, label); card.addEventListener('click', () => { select(index); finish(true); });
    track.append(card); return card;
  });
  function select(index, tick = true) {
    const different = index !== selected; selected = index;
    cards.forEach((card, i) => { card.classList.toggle('is-centered', i === index); card.setAttribute('aria-selected', String(i === index)); card.tabIndex = i === index ? 0 : -1; });
    track.setAttribute('aria-activedescendant', cards[index].id);
    // Preview attributes only. Storage and prom-theme-change remain untouched
    // until Use, so cancel/reload cannot accidentally persist a preview.
    window.PROM_APPLY_THEME_ATTRIBUTES?.(list[index].id);
    overlay.dataset.previewTheme = list[index].id;
    if (different && tick && performance.now() - lastTick >= 40) { lastTick = performance.now(); pmHaptic(8); }
  }
  function center(index, smooth = true) {
    const card = cards[index];
    track.scrollTo({ left: card.offsetLeft - track.clientWidth / 2 + card.offsetWidth / 2, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }
  function finish(commit) {
    if (closed) return; closed = true;
    cancelAnimationFrame(frame); document.removeEventListener('keydown', keys);
    overlay.remove(); closeActive = null;
    apply(commit ? list[selected].id : original);
    if (commit) pmHaptic(20);
    const focusTarget = trigger.isConnected ? trigger : document.querySelector('[data-mobile-theme-toggle]');
    focusTarget?.focus?.({ preventScroll: true });
  }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)));
      select(index); center(index);
    }
    if (event.key === 'Enter' && event.target === track) { event.preventDefault(); finish(true); }
    if (event.key === 'Tab') {
      const focusable = [cards[selected], cancel, use]; const index = focusable.indexOf(document.activeElement);
      event.preventDefault(); focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    }
  }
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const midpoint = track.getBoundingClientRect().left + track.clientWidth / 2;
      let closest = 0, distance = Infinity;
      cards.forEach((card, index) => { const rect = card.getBoundingClientRect(); const delta = Math.abs(rect.left + rect.width / 2 - midpoint); if (delta < distance) { distance = delta; closest = index; } });
      if (closest !== selected) select(closest);
    });
  }, { passive: true });
  let drag;
  sheet.addEventListener('pointerdown', (event) => { if (!track.contains(event.target)) drag = { x: event.clientX, y: event.clientY }; });
  const endDrag = (event) => { if (drag && event.clientY - drag.y > 65 && Math.abs(event.clientX - drag.x) < 50) finish(false); drag = null; };
  sheet.addEventListener('pointerup', endDrag);
  // A pan-y gesture may cancel pointer events once Safari starts native scroll.
  sheet.addEventListener('touchstart', (event) => { if (!track.contains(event.target)) { const touch = event.touches[0]; drag = { x: touch.clientX, y: touch.clientY }; } }, { passive: true });
  sheet.addEventListener('touchend', (event) => { const touch = event.changedTouches[0]; if (touch) endDrag(touch); }, { passive: true });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
  cancel.addEventListener('click', () => finish(false)); use.addEventListener('click', () => finish(true));
  document.addEventListener('keydown', keys); document.body.append(overlay);
  closeActive = () => finish(false); select(selected, false); center(selected, false); track.focus(); pmHaptic(20);
}
