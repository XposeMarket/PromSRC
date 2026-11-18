// Drawer search morph: while the drawer's bottom-left search input is focused,
// the bar widens to composer-like side margins, fades the theme/new-chat
// buttons and lifts above the real keyboard. It is the same input element, so
// focus, value and search behaviour are untouched.
//
// Keyboard inset uses the composer controller's math (layout height minus the
// visual viewport bottom) but is deliberately independent of it: it never
// touches `pm-keyboard-open`, the tab bar or chat layout. Viewport listeners
// exist only while the field is focused.

const KEYBOARD_MIN_INSET = 60;
export const DRAWER_SEARCH_MORPH_CLASS = 'pm-drawer-search-morph';
export const DRAWER_SEARCH_LIFT_CLASS = 'pm-drawer-search-kb-up';
export const DRAWER_SEARCH_INSET_VAR = '--pm-drawer-search-kb';

export function measureDrawerKeyboardInset(win) {
  const vv = win?.visualViewport || null;
  if (!vv) return 0;
  const layout = Math.max(
    Number(win.innerHeight || 0),
    Number(win.document?.documentElement?.clientHeight || 0),
  );
  const visualBottom = Number(vv.height || 0) + Number(vv.offsetTop || 0);
  if (!layout || !visualBottom) return 0;
  const inset = Math.round(layout - visualBottom);
  return inset > KEYBOARD_MIN_INSET ? inset : 0;
}

export function attachDrawerSearchMorph(drawerEl, { win = (typeof window !== 'undefined' ? window : null) } = {}) {
  const bar = drawerEl?.querySelector?.('.pm-drawer-bottom-bar');
  const input = drawerEl?.querySelector?.('#pm-drawer-search-input');
  const noop = () => {};
  if (!bar || !input || !win) return { deactivate: noop, dispose: noop, isActive: () => false, listenerCount: () => 0 };

  let active = false;
  let raf = 0;
  let viewport = null;
  let listeners = 0;

  const apply = () => {
    raf = 0;
    if (!active) return;
    const inset = measureDrawerKeyboardInset(win);
    const value = `${inset}px`;
    if (bar.style.getPropertyValue(DRAWER_SEARCH_INSET_VAR) !== value) bar.style.setProperty(DRAWER_SEARCH_INSET_VAR, value);
    bar.classList.toggle(DRAWER_SEARCH_LIFT_CLASS, inset > 0);
  };
  const schedule = () => {
    if (!active || raf) return;
    raf = win.requestAnimationFrame ? win.requestAnimationFrame(apply) : (apply(), 0);
  };
  const on = (target, type) => { if (!target?.addEventListener) return; target.addEventListener(type, schedule, { passive: true }); listeners += 1; };
  const off = (target, type) => { if (!target?.removeEventListener) return; target.removeEventListener(type, schedule); listeners -= 1; };

  function activate() {
    if (active) return;
    active = true;
    viewport = win.visualViewport || null;
    on(viewport, 'resize');
    on(viewport, 'scroll');
    on(win, 'resize');
    on(win, 'orientationchange');
    bar.classList.add(DRAWER_SEARCH_MORPH_CLASS);
    apply();
    schedule();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    raf = 0;
    off(viewport, 'resize');
    off(viewport, 'scroll');
    off(win, 'resize');
    off(win, 'orientationchange');
    viewport = null;
    bar.classList.remove(DRAWER_SEARCH_MORPH_CLASS, DRAWER_SEARCH_LIFT_CLASS);
    bar.style.removeProperty(DRAWER_SEARCH_INSET_VAR);
  }

  const onFocus = () => activate();
  const onBlur = () => deactivate();
  // Escape inside the field collapses it; it must not also close the drawer.
  const onKeydown = (event) => {
    if (event?.key !== 'Escape') return;
    // type=search clears its value on Escape by default; keep the query.
    event.preventDefault?.();
    event.stopPropagation?.();
    input.blur?.();
    deactivate();
  };
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);
  if (win.document?.activeElement === input) activate();

  return {
    deactivate,
    dispose() {
      deactivate();
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);
    },
    isActive: () => active,
    listenerCount: () => listeners,
  };
}
