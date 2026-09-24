// Login handoff viewer (mobile), styled as an iOS Safari sheet.
//
// The agent parks this chat's in-app browser (in Electron on the PC) on a login
// page and posts a login card. "Open & log in" slides up this sheet: Electron
// puts the page into a phone-sized layout, frames stream from the gateway, taps
// map to page coordinates, and tapping a text field opens the real iOS keyboard
// (a hidden input is focused inside the same tap, which iOS requires). Typing is
// sent as native input. Credentials go straight to the browser, never the model.
// "Use my Chrome" copies the existing sign-in for this site from the paired
// Chrome extension so Google/Apple accounts are already signed in.
import { mobileGatewayFetch } from './mobile-api.js';

const FRAME_IDLE_MS = 900;
const FRAME_ACTIVE_MS = 220;
const ACTIVE_WINDOW_MS = 3000;
const STATE_MS = 1200;

let viewer = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10.5" width="12" height="9" rx="2" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  chrome: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.6h8.2M9.1 13.7 5 6.6M14.9 13.7 10.8 20.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

async function post(path, body, timeoutMs = 10000) {
  return mobileGatewayFetch(path, { method: 'POST', body: JSON.stringify(body), timeoutMs });
}

function toast(state, text, ms = 2600) {
  state.toast.textContent = text || '';
  state.toast.classList.toggle('is-on', !!text);
  clearTimeout(state.toastTimer);
  if (text) state.toastTimer = setTimeout(() => state.toast.classList.remove('is-on'), ms);
}

async function sendInput(state, body) {
  state.lastInputAt = Date.now();
  try {
    await post('/api/browser/login-input', { sessionId: state.sessionId, ...body });
  } catch (err) {
    toast(state, String(err?.message || 'Input failed'));
  }
  scheduleFrame(state, 90);
  scheduleState(state, 350);
}

function scheduleFrame(state, delay) {
  if (state.closed) return;
  clearTimeout(state.frameTimer);
  state.frameTimer = setTimeout(() => loadFrame(state), Math.max(0, delay));
}

function scheduleState(state, delay) {
  if (state.closed) return;
  clearTimeout(state.stateTimer);
  state.stateTimer = setTimeout(() => loadState(state), Math.max(0, delay));
}

function setHost(state, url) {
  let host = '';
  let secure = false;
  try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); secure = u.protocol === 'https:'; } catch {}
  state.host.textContent = host || 'Loading…';
  state.lock.style.visibility = secure ? 'visible' : 'hidden';
}

async function loadFrame(state) {
  if (state.closed) return;
  if (state.frameInFlight) { scheduleFrame(state, 120); return; }
  state.frameInFlight = true;
  const t0 = Date.now();
  try {
    const width = Math.round(Math.min(1300, (window.innerWidth || 390) * Math.min(3, window.devicePixelRatio || 2)));
    const data = await mobileGatewayFetch(
      `/api/browser/login-frame?sessionId=${encodeURIComponent(state.sessionId)}&maxWidth=${width}`,
      { timeoutMs: 12000 },
    );
    if (state.closed) return;
    if (data?.image) {
      state.img.src = data.image;
      state.viewportWidth = Number(data.viewportWidth || 0);
      state.viewportHeight = Number(data.viewportHeight || 0);
      setHost(state, String(data.url || ''));
      state.root.classList.add('is-live');
    }
  } catch (err) {
    if (!state.closed) toast(state, String(err?.message || 'Could not load the page'));
  } finally {
    state.frameInFlight = false;
  }
  const active = Date.now() - state.lastInputAt < ACTIVE_WINDOW_MS;
  const took = Date.now() - t0;
  scheduleFrame(state, Math.max(60, (active ? FRAME_ACTIVE_MS : FRAME_IDLE_MS) - took));
}

async function loadState(state) {
  if (state.closed) return;
  try {
    const data = await mobileGatewayFetch(`/api/browser/login-state?sessionId=${encodeURIComponent(state.sessionId)}`, { timeoutMs: 8000 });
    if (state.closed) return;
    state.editables = Array.isArray(data?.editables) ? data.editables : [];
    state.back.disabled = !data?.canGoBack;
    state.fwd.disabled = !data?.canGoForward;
    state.progress.classList.toggle('is-loading', !!data?.loading);
    if (data?.focus) configureKeyboard(state, data.focus);
  } catch {}
  scheduleState(state, STATE_MS);
}

function configureKeyboard(state, field) {
  const type = String(field?.type || 'text');
  const ac = String(field?.ac || '');
  const input = state.input;
  const secure = type === 'password';
  input.setAttribute('type', secure ? 'password' : (type === 'email' ? 'email' : (type === 'tel' ? 'tel' : 'text')));
  input.setAttribute('inputmode', field?.mode || (type === 'email' ? 'email' : (type === 'tel' ? 'tel' : (type === 'number' ? 'numeric' : 'text'))));
  input.setAttribute('autocomplete', ac || (secure ? 'current-password' : (type === 'email' ? 'username' : 'off')));
}

function pagePoint(state, clientX, clientY) {
  const rect = state.img.getBoundingClientRect();
  if (!rect.width || !rect.height || !state.viewportWidth) return null;
  const x = ((clientX - rect.left) / rect.width) * state.viewportWidth;
  const y = ((clientY - rect.top) / rect.height) * state.viewportHeight;
  if (x < 0 || y < 0 || x > state.viewportWidth || y > state.viewportHeight) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function hitEditable(state, p) {
  if (!p) return null;
  const pad = 6;
  return state.editables.find((r) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad) || null;
}

function bindGestures(state) {
  let start = null;
  const stage = state.stage;
  stage.addEventListener('touchstart', (event) => {
    const t = event.touches[0];
    if (!t) return;
    start = { x: t.clientX, y: t.clientY, lastY: t.clientY, lastX: t.clientX, moved: false };
  }, { passive: true });
  stage.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (!start || !t) return;
    if (Math.abs(t.clientY - start.y) > 10 || Math.abs(t.clientX - start.x) > 10) start.moved = true;
    if (!start.moved) return;
    event.preventDefault();
    const rect = state.img.getBoundingClientRect();
    const scale = rect.height ? state.viewportHeight / rect.height : 1;
    const dy = Math.round((start.lastY - t.clientY) * scale);
    const dx = Math.round((start.lastX - t.clientX) * scale);
    start.lastY = t.clientY; start.lastX = t.clientX;
    if (Math.abs(dy) + Math.abs(dx) < 4) return;
    const p = pagePoint(state, t.clientX, t.clientY) || { x: Math.round(state.viewportWidth / 2), y: Math.round(state.viewportHeight / 2) };
    // Coalesce scroll into one request per animation frame.
    state.pendingWheel = { x: p.x, y: p.y, deltaX: (state.pendingWheel?.deltaX || 0) + dx, deltaY: (state.pendingWheel?.deltaY || 0) + dy };
    if (!state.wheelRaf) state.wheelRaf = requestAnimationFrame(() => {
      state.wheelRaf = 0;
      const w = state.pendingWheel; state.pendingWheel = null;
      if (w) sendInput(state, { action: 'wheel', ...w });
    });
  }, { passive: false });
  stage.addEventListener('touchend', (event) => {
    const s = start;
    start = null;
    if (!s || s.moved) return;
    const t = event.changedTouches[0];
    const p = pagePoint(state, t.clientX, t.clientY);
    if (!p) return;
    const field = hitEditable(state, p);
    if (field) {
      // Must happen inside this user gesture or iOS will not show the keyboard.
      configureKeyboard(state, field);
      state.input.value = '';
      try { state.input.focus({ preventScroll: true }); } catch {}
      state.root.classList.add('is-typing');
    } else {
      try { state.input.blur(); } catch {}
    }
    sendInput(state, { action: 'click', x: p.x, y: p.y });
  });
}

function bindTyping(state) {
  const input = state.input;
  input.addEventListener('beforeinput', (event) => {
    const type = String(event.inputType || '');
    if (type === 'deleteContentBackward') {
      event.preventDefault();
      sendInput(state, { action: 'key', key: 'Backspace' });
    } else if (type === 'insertLineBreak' || type === 'insertParagraph') {
      event.preventDefault();
      sendInput(state, { action: 'key', key: 'Enter' });
    }
  });
  input.addEventListener('input', () => {
    const value = input.value;
    input.value = '';
    // iOS password AutoFill inserts the whole value at once; send it as one chunk.
    if (value) sendInput(state, { action: 'text', text: value });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); sendInput(state, { action: 'key', key: 'Enter' }); }
    else if (event.key === 'Tab') { event.preventDefault(); sendInput(state, { action: 'key', key: 'Tab' }); }
  });
  input.addEventListener('blur', () => state.root.classList.remove('is-typing'));
}

async function useMyChrome(state) {
  state.chrome.disabled = true;
  toast(state, 'Copying your sign-in from Chrome…', 8000);
  try {
    const res = await post('/api/browser/login-import-chrome', { sessionId: state.sessionId }, 30000);
    toast(state, res?.imported
      ? `Signed in from Chrome (${res.imported} cookies). Reloading…`
      : 'Chrome has no sign-in for this site yet. Log in once in Chrome, then try again.', 4200);
    state.lastInputAt = Date.now();
    scheduleFrame(state, 600);
  } catch (err) {
    toast(state, String(err?.message || 'Could not reach your Chrome'), 5200);
  } finally {
    state.chrome.disabled = false;
  }
}

function closeViewer() {
  if (!viewer) return;
  const state = viewer;
  viewer = null;
  state.closed = true;
  clearTimeout(state.frameTimer);
  clearTimeout(state.stateTimer);
  post('/api/browser/login-view', { sessionId: state.sessionId, mode: 'off' }).catch(() => {});
  state.root.classList.remove('is-open');
  state.root.classList.add('is-closing');
  document.body.classList.remove('pm-login-handoff-open');
  setTimeout(() => state.root.remove(), 320);
}

async function finishLogin(questionId) {
  closeViewer();
  const card = document.querySelector(`[data-pm-q-card="${(window.CSS && CSS.escape) ? CSS.escape(questionId) : questionId}"]`);
  const option = card?.querySelector('.pm-q-opt[data-pm-q-opt="I\'m logged in"]');
  if (option && !option.classList.contains('selected')) window._mobileQuestionToggleOption?.(option, 'single_select');
  await window._submitMobileQuestion?.(questionId);
}

export function openMobileLoginHandoff(questionId, sessionId, site = '') {
  closeViewer();
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const img = el('img', { class: 'pm-lh-frame', alt: '', draggable: 'false' });
  const input = el('input', {
    class: 'pm-lh-ime', type: 'text', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Type into the page',
  });
  const lock = el('span', { class: 'pm-lh-lock', html: ICON.lock });
  const host = el('span', { class: 'pm-lh-host', text: site || 'Loading…' });
  const progress = el('div', { class: 'pm-lh-progress is-loading' });
  const done = el('button', { class: 'pm-lh-done', type: 'button', text: 'Done' });
  const finish = el('button', { class: 'pm-lh-finish', type: 'button', text: "I'm in" });
  const back = el('button', { class: 'pm-lh-tool', type: 'button', 'aria-label': 'Back', html: ICON.back });
  const fwd = el('button', { class: 'pm-lh-tool', type: 'button', 'aria-label': 'Forward', html: ICON.fwd });
  const reload = el('button', { class: 'pm-lh-tool', type: 'button', 'aria-label': 'Reload', html: ICON.reload });
  const chrome = el('button', { class: 'pm-lh-tool pm-lh-chrome', type: 'button', 'aria-label': 'Use my Chrome sign-in', html: `${ICON.chrome}<span>Use my Chrome</span>` });
  const toastEl = el('div', { class: 'pm-lh-toast', role: 'status' });
  const stage = el('div', { class: 'pm-lh-stage' }, [el('div', { class: 'pm-lh-skeleton' }), img]);
  const sheet = el('div', { class: 'pm-lh-sheet' }, [
    el('div', { class: 'pm-lh-grabber' }),
    el('header', { class: 'pm-lh-bar' }, [
      done,
      el('div', { class: 'pm-lh-address' }, [lock, host]),
      finish,
    ]),
    progress,
    stage,
    toastEl,
    el('footer', { class: 'pm-lh-toolbar' }, [back, fwd, chrome, reload]),
    input,
  ]);
  const root = el('div', { class: 'pm-lh', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Log in${site ? ` to ${site}` : ''}` }, [
    el('div', { class: 'pm-lh-scrim' }),
    sheet,
  ]);
  document.body.appendChild(root);
  document.body.classList.add('pm-login-handoff-open');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
  const state = viewer = {
    root, img, input, stage, host, lock, progress, back, fwd, chrome, toast: toastEl,
    sessionId: sid, closed: false, frameTimer: 0, stateTimer: 0, toastTimer: 0,
    frameInFlight: false, lastInputAt: Date.now(), viewportWidth: 0, viewportHeight: 0,
    editables: [], pendingWheel: null, wheelRaf: 0,
  };
  const nav = (action, delay) => {
    if (action === 'reload') progress.classList.add('is-loading');
    post('/api/browser/login-nav', { sessionId: sid, action }).catch(() => {});
    state.lastInputAt = Date.now();
    scheduleFrame(state, delay);
    scheduleState(state, delay + 200);
  };
  done.addEventListener('click', closeViewer);
  finish.addEventListener('click', () => { finishLogin(questionId); });
  back.addEventListener('click', () => nav('back', 250));
  fwd.addEventListener('click', () => nav('forward', 250));
  reload.addEventListener('click', () => nav('reload', 400));
  chrome.addEventListener('click', () => { useMyChrome(state); });
  bindGestures(state);
  bindTyping(state);
  // Electron lays the page out at this sheet's size in mobile mode, so the site
  // renders its real phone layout instead of a shrunken desktop page.
  const rect = stage.getBoundingClientRect();
  post('/api/browser/login-view', {
    sessionId: sid, mode: 'phone',
    width: Math.round(rect.width || window.innerWidth || 390),
    height: Math.round(rect.height || (window.innerHeight || 800) - 150),
  }).then((res) => {
    if (res && res.chromePaired === false) chrome.classList.add('is-unpaired');
  }).catch(() => {}).finally(() => { loadFrame(state); loadState(state); });
}

if (typeof window !== 'undefined') {
  window._pmOpenLoginHandoff = openMobileLoginHandoff;
}
