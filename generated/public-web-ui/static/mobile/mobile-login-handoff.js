// Login handoff viewer (mobile).
//
// The agent parks this chat's in-app browser (running on the PC) on a login
// page and posts a login card. "Open & log in" opens this full-screen live view:
// frames are polled from the gateway, taps are mapped to page coordinates and
// typing is forwarded as native input. The user logs in themselves (OAuth, 2FA);
// credentials go straight to the browser and never through the model.
import { mobileGatewayFetch } from './mobile-api.js';

const FRAME_IDLE_MS = 1200;
const FRAME_ACTIVE_MS = 350;
const ACTIVE_WINDOW_MS = 2500;

let viewer = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

async function sendInput(state, body) {
  state.lastInputAt = Date.now();
  try {
    await mobileGatewayFetch('/api/browser/login-input', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.sessionId, ...body }),
      timeoutMs: 10000,
    });
    state.status.textContent = '';
  } catch (err) {
    state.status.textContent = String(err?.message || 'Input failed');
  }
  scheduleFrame(state, 120);
}

function scheduleFrame(state, delay) {
  if (state.closed) return;
  clearTimeout(state.frameTimer);
  state.frameTimer = setTimeout(() => loadFrame(state), Math.max(0, delay));
}

async function loadFrame(state) {
  if (state.closed) return;
  if (state.frameInFlight) { scheduleFrame(state, 150); return; }
  state.frameInFlight = true;
  try {
    const width = Math.round(Math.min(1400, (window.innerWidth || 400) * (window.devicePixelRatio || 2)));
    const data = await mobileGatewayFetch(
      `/api/browser/login-frame?sessionId=${encodeURIComponent(state.sessionId)}&maxWidth=${width}`,
      { timeoutMs: 12000 },
    );
    if (state.closed) return;
    if (data?.image) {
      state.img.src = data.image;
      state.viewportWidth = Number(data.viewportWidth || 0);
      state.viewportHeight = Number(data.viewportHeight || 0);
      state.url.textContent = String(data.url || '').replace(/^https?:\/\//, '');
      state.status.textContent = '';
    }
  } catch (err) {
    if (!state.closed) state.status.textContent = String(err?.message || 'Could not load the browser view');
  } finally {
    state.frameInFlight = false;
  }
  const active = Date.now() - state.lastInputAt < ACTIVE_WINDOW_MS;
  scheduleFrame(state, active ? FRAME_ACTIVE_MS : FRAME_IDLE_MS);
}

function pagePoint(state, clientX, clientY) {
  const rect = state.img.getBoundingClientRect();
  if (!rect.width || !rect.height || !state.viewportWidth) return null;
  const x = ((clientX - rect.left) / rect.width) * state.viewportWidth;
  const y = ((clientY - rect.top) / rect.height) * state.viewportHeight;
  if (x < 0 || y < 0 || x > state.viewportWidth || y > state.viewportHeight) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function bindGestures(state) {
  let start = null;
  state.img.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY, lastY: event.clientY, moved: false };
  });
  state.img.addEventListener('pointermove', (event) => {
    if (!start) return;
    if (Math.abs(event.clientY - start.y) > 12 || Math.abs(event.clientX - start.x) > 12) start.moved = true;
  });
  state.img.addEventListener('pointerup', (event) => {
    if (!start) return;
    const s = start;
    start = null;
    if (s.moved) {
      // Drag = scroll. Map the drag distance into page pixels.
      const rect = state.img.getBoundingClientRect();
      const scale = rect.height ? state.viewportHeight / rect.height : 1;
      const deltaY = Math.round((s.y - event.clientY) * scale);
      const point = pagePoint(state, s.x, s.y) || { x: Math.round(state.viewportWidth / 2), y: Math.round(state.viewportHeight / 2) };
      if (deltaY) sendInput(state, { action: 'wheel', x: point.x, y: point.y, deltaX: 0, deltaY });
      return;
    }
    const point = pagePoint(state, event.clientX, event.clientY);
    if (!point) return;
    sendInput(state, { action: 'click', x: point.x, y: point.y });
    // Tapping a field on the page should bring up the keyboard.
    try { state.input.focus({ preventScroll: true }); } catch {}
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
    if (value) sendInput(state, { action: 'text', text: value });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); sendInput(state, { action: 'key', key: 'Enter' }); }
    else if (event.key === 'Tab') { event.preventDefault(); sendInput(state, { action: 'key', key: 'Tab' }); }
  });
}

function closeViewer() {
  if (!viewer) return;
  viewer.closed = true;
  clearTimeout(viewer.frameTimer);
  viewer.root.remove();
  document.body.classList.remove('pm-login-handoff-open');
  viewer = null;
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
  const img = el('img', { class: 'pm-login-frame', alt: 'Live browser view', draggable: 'false' });
  const input = el('input', {
    class: 'pm-login-type',
    type: 'text',
    placeholder: 'Tap a field on the page, then type here',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    'aria-label': 'Type into the page',
  });
  const mask = el('button', { class: 'pm-login-mask', type: 'button', 'aria-pressed': 'false', text: 'Hide' });
  mask.addEventListener('click', () => {
    const hidden = input.type === 'text';
    input.type = hidden ? 'password' : 'text';
    mask.textContent = hidden ? 'Show' : 'Hide';
    mask.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  });
  const url = el('div', { class: 'pm-login-url' });
  const status = el('div', { class: 'pm-login-status', role: 'status' });
  const close = el('button', { class: 'pm-login-close', type: 'button', text: 'Close' });
  const done = el('button', { class: 'pm-login-done', type: 'button', text: "I'm logged in" });
  close.addEventListener('click', closeViewer);
  done.addEventListener('click', () => { finishLogin(questionId); });
  const root = el('div', { class: 'pm-login-handoff', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Log in${site ? ` to ${site}` : ''}` }, [
    el('div', { class: 'pm-login-head' }, [
      close,
      el('div', { class: 'pm-login-title' }, [el('strong', { text: site ? `Log in to ${site}` : 'Log in' }), url]),
      done,
    ]),
    el('div', { class: 'pm-login-stage' }, [img]),
    status,
    el('div', { class: 'pm-login-keys' }, [input, mask]),
  ]);
  document.body.appendChild(root);
  document.body.classList.add('pm-login-handoff-open');
  viewer = {
    root, img, input, url, status, sessionId: sid, closed: false,
    frameTimer: 0, frameInFlight: false, lastInputAt: Date.now(),
    viewportWidth: 0, viewportHeight: 0,
  };
  status.textContent = 'Loading the browser view…';
  bindGestures(viewer);
  bindTyping(viewer);
  loadFrame(viewer);
}

if (typeof window !== 'undefined') {
  window._pmOpenLoginHandoff = openMobileLoginHandoff;
}
