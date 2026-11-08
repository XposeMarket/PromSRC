/** Inline, presentation-only carousel enhancement shared by every chat surface. */
export const FOCUSED_TRACKS = '.sources-cards .src-track,.pm-src-track,.product-carousel .pc-track,.pm-product-track,.pc-gallery-grid';
const states = new Map();
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const FOCUSED_CSS = `
.fc-track.fc-track{display:flex;position:relative;box-sizing:border-box;gap:12px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding:0;padding:12px var(--fc-edge) 16px;max-width:100%;min-width:0;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;grid-auto-rows:auto}
.fc-track::-webkit-scrollbar{display:none}
.fc-track.fc-track>*{box-sizing:border-box;flex:0 0 var(--fc-width);width:var(--fc-width);min-width:0;max-width:none;scroll-snap-align:center;transform:scale(.94);opacity:.6;transition:transform .18s ease,opacity .18s ease;transform-origin:center;white-space:normal}
.fc-track.fc-track>.fc-active{transform:scale(1);opacity:1}
.fc-track.fc-track>.pc-gallery-tile{height:240px;grid-column:auto;grid-row:auto}
.fc-track.fc-track>.pc-gallery-tile img{object-fit:contain;transform:none}
.fc-track:focus-visible{outline:2px solid var(--brand,var(--pm-orange,#c49343));outline-offset:-2px}
.fc-controls{display:flex;align-items:center;justify-content:center;gap:12px;padding:0 0 8px;color:var(--pm-muted,var(--muted,currentColor));font:12px/1.4 system-ui}
.fc-controls button{display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:1px solid var(--pm-border,var(--line,rgba(127,127,127,.3)));border-radius:50%;background:transparent;color:inherit;font:22px/1 system-ui;cursor:pointer}
.fc-controls button:disabled{opacity:.3;cursor:default}
.fc-position{min-width:42px;text-align:center;font-variant-numeric:tabular-nums}
.product-carousel:has(>.fc-track)>.pc-arrow{display:none!important}
@media(prefers-reduced-motion:reduce){.fc-track.fc-track>*{transition:none}}
`;

function mount(track) {
  const items = [...track.children];
  if (items.length < 2 || track.closest('.pm-voice-preview-wheel,.pm-theme-wheel-backdrop')) return;
  track.classList.add('fc-track');
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-roledescription', 'carousel');
  const label = track.matches('.pc-gallery-grid') ? 'Images' : track.matches('.src-track,.pm-src-track') ? 'Sources' : 'Products';
  track.setAttribute('aria-label', label);
  const controls = document.createElement('div');
  controls.className = 'fc-controls';
  const prev = document.createElement('button');
  const next = document.createElement('button');
  const position = document.createElement('span');
  position.className = 'fc-position';
  position.setAttribute('aria-live', 'polite');
  position.setAttribute('aria-atomic', 'true');
  prev.type = next.type = 'button';
  prev.textContent = '‹'; next.textContent = '›';
  prev.setAttribute('aria-label', `Previous ${label.toLowerCase()} item`);
  next.setAttribute('aria-label', `Next ${label.toLowerCase()} item`);
  controls.append(prev, position, next);
  track.after(controls);
  const listeners = new AbortController();
  const listen = (type, handler, options = {}) => track.addEventListener(type, handler, { ...options, signal: listeners.signal });
  let active = 0, frame = 0, resizeFrame = 0, lastWidth = 0, down = null, dragged = false;
  function paint() {
    frame = 0;
    const box = track.getBoundingClientRect();
    const center = box.left + box.width / 2;
    let nearest = 0, distance = Infinity;
    items.forEach((item, i) => {
      const rect = item.getBoundingClientRect();
      const delta = Math.abs(rect.left + rect.width / 2 - center);
      if (delta < distance) { distance = delta; nearest = i; }
    });
    active = nearest;
    items.forEach((item, i) => item.classList.toggle('fc-active', i === active));
    const text = `${active + 1} / ${items.length}`;
    if (position.textContent !== text) position.textContent = text;
    prev.disabled = active === 0;
    next.disabled = active === items.length - 1;
  }
  function go(index, smooth = true) {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    const box = track.getBoundingClientRect(), rect = item.getBoundingClientRect();
    track.scrollBy({ left: rect.left + rect.width / 2 - box.left - box.width / 2, behavior: smooth && !reduceMotion() ? 'smooth' : 'instant' });
    schedule();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  function resize() {
    resizeFrame = 0;
    if (!track.clientWidth || track.clientWidth === lastWidth) return;
    lastWidth = track.clientWidth;
    const width = Math.min(360, track.clientWidth * .82);
    track.style.setProperty('--fc-width', `${width}px`);
    track.style.setProperty('--fc-edge', `${(track.clientWidth - width) / 2}px`);
    go(active, false);
  }
  prev.addEventListener('click', () => go(active - 1));
  next.addEventListener('click', () => go(active + 1));
  listen('scroll', schedule, { passive: true });
  listen('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.matches('input,textarea,select')) return;
    const target = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: items.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault(); event.stopPropagation(); go(target);
  });
  listen('focusin', event => {
    const index = items.findIndex(item => item === event.target || item.contains(event.target));
    if (index >= 0) go(index);
  });
  listen('pointerdown', event => { down = [event.clientX, event.clientY]; dragged = false; }, { passive: true });
  listen('pointermove', event => {
    if (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 8) dragged = true;
  }, { passive: true });
  listen('pointerup', () => { down = null; }, { passive: true });
  listen('pointercancel', () => { down = null; }, { passive: true });
  listen('click', event => {
    if (dragged) { event.preventDefault(); event.stopImmediatePropagation(); dragged = false; }
  }, { capture: true });
  const observer = new ResizeObserver(() => {
    if (!resizeFrame && track.clientWidth !== lastWidth) resizeFrame = requestAnimationFrame(resize);
  });
  observer.observe(track);
  states.set(track, { items, dispose: () => {
    listeners.abort(); observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame); controls.remove();
    track.classList.remove('fc-track');
    items.forEach(item => item.classList.remove('fc-active'));
    ['tabindex','role','aria-roledescription','aria-label'].forEach(name => track.removeAttribute(name));
  } });
  resize(); paint();
}

export function hydrateFocusedCarousels(root = document) {
  for (const [track, state] of states) {
    if (!track.isConnected || track.children.length !== state.items.length || state.items.some((item, i) => item !== track.children[i])) {
      state.dispose(); states.delete(track);
    }
  }
  root.querySelectorAll(FOCUSED_TRACKS).forEach(track => { if (!states.has(track)) mount(track); });
}
