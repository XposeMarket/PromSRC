import { state } from './state.js';

const VIEWER_ID = 'prom-computer-use-live-view';
const PILL_ID = 'prom-watch-computer-use';
const SOURCE_TAB_ID = 'prom-source-computer-use-tab';
const ACTIVE_HIDE_GRACE_MS = 850;
const FRAME_INTERVAL_MS = 700;

let active = false;
let activeSource = 'browser';
let seenBrowser = false;
let seenDesktop = false;
let viewerOpen = false;
let frameTimer = null;
let settleTimer = null;
let lastRelevantMutationAt = 0;
let cursor = { browser: null, desktop: null };

function mobileSurface() {
  return document.body?.classList?.contains('pm-mobile-active') || String(location.hash || '').startsWith('#mobile');
}

function currentSessionId() {
  if (mobileSurface()) {
    const chat = window.__pmChat;
    const raw = String(chat?.activeSessionId || localStorage.getItem('pm_mobile_last_chat_session') || '').trim();
    if (raw) {
      try { return decodeURIComponent(raw).split('::').pop() || raw; } catch { return raw; }
    }
  }
  return String(state.streamingSessionId || state.activeChatSessionId || state.agentSessionId || 'default').trim() || 'default';
}

function gatewayRequest(path) {
  const base = String(window.__pmMobileActiveGatewayOrigin || '').replace(/\/+$/, '');
  const token = String(window.__pmMobileActiveGatewayToken || localStorage.getItem('pm_device_token') || '').trim();
  const headers = new Headers();
  if (token) headers.set('X-Pairing-Token', token);
  return fetch(`${base}${path}`, { headers, cache: 'no-store' });
}

function ensureStyles() {
  if (document.getElementById('prom-computer-use-live-view-style')) return;
  const style = document.createElement('style');
  style.id = 'prom-computer-use-live-view-style';
  style.textContent = `
#${PILL_ID}{position:fixed;z-index:2147481200;left:50%;bottom:calc(92px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:none;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:8px 13px;background:rgba(20,20,22,.88);color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.3);backdrop-filter:blur(18px);font:600 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer}
#${PILL_ID}.is-active{display:flex} #${PILL_ID} .prom-watch-dot{width:7px;height:7px;border-radius:50%;background:#72d572;box-shadow:0 0 0 4px rgba(114,213,114,.11)}
#${VIEWER_ID}{position:fixed;z-index:2147481300;right:18px;bottom:86px;width:min(430px,calc(100vw - 28px));display:none;border:1px solid rgba(255,255,255,.13);border-radius:20px;overflow:hidden;background:#101012;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.46);font-family:system-ui,-apple-system,sans-serif}
#${VIEWER_ID}.is-open{display:block} .prom-cu-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.045)} .prom-cu-title{font-size:13px;font-weight:700;flex:1}.prom-cu-live{font-size:10px;color:#8fe38f}.prom-cu-close{border:0;background:transparent;color:#aaa;font-size:18px;cursor:pointer}.prom-cu-tabs{display:flex;padding:0 10px 9px;gap:6px}.prom-cu-tab{border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:5px 9px;background:transparent;color:#aaa;font-size:11px;cursor:pointer}.prom-cu-tab.active{background:rgba(255,255,255,.1);color:white}.prom-cu-stage{position:relative;aspect-ratio:16/10;background:#050506;display:grid;place-items:center;overflow:hidden}.prom-cu-frame{display:block;width:100%;height:100%;object-fit:contain}.prom-cu-status{position:absolute;inset:0;display:grid;place-items:center;color:#777;font-size:12px;padding:24px;text-align:center}.prom-cu-cursor{position:absolute;width:17px;height:22px;transform:translate(-2px,-2px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.9));pointer-events:none}.prom-cu-foot{display:flex;justify-content:space-between;padding:8px 11px;color:#777;font-size:10px;background:rgba(255,255,255,.025)}
body.pm-mobile-active #${VIEWER_ID}{left:12px;right:12px;bottom:calc(82px + env(safe-area-inset-bottom,0px));width:auto;border-radius:22px} body.pm-mobile-active #${PILL_ID}{bottom:calc(84px + env(safe-area-inset-bottom,0px))}
`;
  document.head.appendChild(style);
}

function ensureUi() {
  ensureStyles();
  let pill = document.getElementById(PILL_ID);
  if (!pill) {
    pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.innerHTML = '<span class="prom-watch-dot"></span><span>Watch Prometheus</span>';
    pill.addEventListener('click', () => openViewer());
    document.body.appendChild(pill);
  }
  let viewer = document.getElementById(VIEWER_ID);
  if (!viewer) {
    viewer = document.createElement('section');
    viewer.id = VIEWER_ID;
    viewer.setAttribute('aria-label', 'Watch Prometheus');
    viewer.innerHTML = `<div class="prom-cu-head"><div class="prom-cu-title">Watch Prometheus</div><div class="prom-cu-live">LIVE</div><button class="prom-cu-close" aria-label="Close">×</button></div><div class="prom-cu-tabs"><button class="prom-cu-tab" data-cu-source="browser">Browser</button><button class="prom-cu-tab" data-cu-source="desktop">Desktop</button></div><div class="prom-cu-stage"><img class="prom-cu-frame" alt="Prometheus computer use live view"><div class="prom-cu-status">Waiting for a live frame…</div><svg class="prom-cu-cursor" viewBox="0 0 24 30" aria-hidden="true"><path d="M2 2v22l6-6 4 9 4-2-4-9h8z" fill="white" stroke="#111" stroke-width="1.5"/></svg></div><div class="prom-cu-foot"><span class="prom-cu-source-label">Browser</span><span>View only</span></div>`;
    viewer.querySelector('.prom-cu-close').addEventListener('click', closeViewer);
    viewer.querySelectorAll('[data-cu-source]').forEach(btn => btn.addEventListener('click', () => setSource(btn.dataset.cuSource)));
    document.body.appendChild(viewer);
  }
  injectSourcesTab();
  renderUiState();
  return viewer;
}

function injectSourcesTab() {
  if (mobileSurface() || document.getElementById(SOURCE_TAB_ID)) return;
  const tabs = document.getElementById('source-panel-tabs');
  if (!tabs) return;
  const button = document.createElement('button');
  button.id = SOURCE_TAB_ID;
  button.className = 'source-panel-tab';
  button.type = 'button';
  button.textContent = 'Computer Use';
  button.title = 'Open Watch Prometheus';
  button.addEventListener('click', () => openViewer());
  tabs.appendChild(button);
}

function renderUiState() {
  const pill = document.getElementById(PILL_ID);
  pill?.classList.toggle('is-active', active);
  const viewer = document.getElementById(VIEWER_ID);
  viewer?.classList.toggle('is-open', viewerOpen);
  viewer?.querySelectorAll('[data-cu-source]').forEach(btn => {
    const source = btn.dataset.cuSource;
    btn.classList.toggle('active', source === activeSource);
    btn.hidden = source === 'browser' ? !seenBrowser : !seenDesktop;
  });
  const label = viewer?.querySelector('.prom-cu-source-label');
  if (label) label.textContent = activeSource === 'desktop' ? 'Desktop' : 'Browser';
}

function openViewer(source = activeSource) {
  ensureUi(); viewerOpen = true; setSource(source); renderUiState(); refreshFrame(true); startFrames();
}
function closeViewer() { viewerOpen = false; stopFrames(); renderUiState(); }
function setSource(source) {
  if (source !== 'browser' && source !== 'desktop') return;
  if (source === 'browser' && !seenBrowser && seenDesktop) source = 'desktop';
  if (source === 'desktop' && !seenDesktop && seenBrowser) source = 'browser';
  activeSource = source; renderUiState(); if (viewerOpen) refreshFrame(true);
}

function setCursorFromLabel(source, text) {
  if (source !== 'desktop') return;
  const match = String(text || '').match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
  if (!match) return;
  cursor.desktop = { x: Number(match[1]), y: Number(match[2]) };
}

function markComputerUse(source, label) {
  active = true; activeSource = source; lastRelevantMutationAt = Date.now();
  if (source === 'browser') seenBrowser = true; else seenDesktop = true;
  setCursorFromLabel(source, label);
  ensureUi(); renderUiState();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(waitForTurnSettlement, ACTIVE_HIDE_GRACE_MS);
  if (viewerOpen) refreshFrame(true);
}

function waitForTurnSettlement() {
  const elapsed = Date.now() - lastRelevantMutationAt;
  if (state.isThinking || state.streamingSessionId || elapsed < ACTIVE_HIDE_GRACE_MS) {
    settleTimer = setTimeout(waitForTurnSettlement, 500);
    return;
  }
  active = false; renderUiState();
}

function inspectNode(root) {
  const rows = [];
  if (root?.matches?.('.tool-activity-entry')) rows.push(root);
  root?.querySelectorAll?.('.tool-activity-entry').forEach(row => rows.push(row));
  for (const row of rows) {
    if (row.dataset.kind && row.dataset.kind !== 'operation') continue;
    const label = String(row.querySelector('.tool-activity-label')?.textContent || row.textContent || '').trim();
    if (/\bbrowser\b/i.test(label)) markComputerUse('browser', label);
    else if (/\bdesktop\b|\bwindow focus\b/i.test(label)) markComputerUse('desktop', label);
  }
}

function installActivityObserver() {
  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(node => { if (node.nodeType === 1) inspectNode(node); });
    injectSourcesTab();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('.tool-activity-entry').forEach(inspectNode);
}

async function refreshFrame(force = false) {
  if (!viewerOpen && !force) return;
  const viewer = ensureUi();
  const status = viewer.querySelector('.prom-cu-status');
  const image = viewer.querySelector('.prom-cu-frame');
  try {
    const sessionId = encodeURIComponent(currentSessionId());
    const response = await gatewayRequest(`/api/computer-use/frame/${sessionId}?source=${encodeURIComponent(activeSource)}&t=${Date.now()}`);
    const payload = await response.json();
    if (!response.ok || !payload?.frame?.base64) throw new Error(payload?.error || 'No live frame available');
    image.src = `data:${payload.frame.mimeType || 'image/png'};base64,${payload.frame.base64}`;
    status.style.display = 'none';
    renderCursor(payload.frame);
  } catch (error) {
    status.textContent = String(error?.message || 'Waiting for a live frame…'); status.style.display = 'grid';
  }
}

function renderCursor(frame) {
  const viewer = document.getElementById(VIEWER_ID); if (!viewer) return;
  const marker = viewer.querySelector('.prom-cu-cursor');
  const point = cursor[activeSource];
  if (!point || !frame?.width || !frame?.height) { marker.style.display = 'none'; return; }
  marker.style.display = 'block';
  marker.style.left = `${Math.max(0, Math.min(100, point.x / frame.width * 100))}%`;
  marker.style.top = `${Math.max(0, Math.min(100, point.y / frame.height * 100))}%`;
}

function startFrames() { stopFrames(); frameTimer = setInterval(() => refreshFrame(), FRAME_INTERVAL_MS); }
function stopFrames() { if (frameTimer) clearInterval(frameTimer); frameTimer = null; }

window.__PROM_COMPUTER_USE_VIEW = { open: openViewer, close: closeViewer, refresh: () => refreshFrame(true), getState: () => ({ active, activeSource, seenBrowser, seenDesktop, viewerOpen }) };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensureUi(); installActivityObserver(); }, { once: true });
else { ensureUi(); installActivityObserver(); }
