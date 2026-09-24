/**
 * Banked usage reset row + confirmation, shared by the desktop and mobile
 * context-window popovers.
 *
 * - Renders only when a provider reports an available credit.
 * - Consuming is irreversible, so it always goes through a confirm dialog and
 *   the server also requires confirm:true.
 * - Self-mounting: watches both popovers and fills a slot at their bottom
 *   whenever they open, so neither popover renderer needs to know about it.
 */

const PROVIDER_LABELS = { openai_codex: 'Codex', anthropic: 'Claude', xai: 'Grok' };
const CACHE_MS = 60_000;
const POPOVER_IDS = ['chat-context-window-popover', 'pm-ctx-popover'];

let cache = null; // { at, providers }
let inflight = null;

// Mobile injects its paired-token fetcher (returns parsed JSON, throws on HTTP
// errors); desktop uses window.api from api.js (same contract).
let injectedFetch = null;
export function setBankedResetFetcher(fn) { injectedFetch = typeof fn === 'function' ? fn : null; }

async function request(path, { method = 'GET', body } = {}) {
  if (injectedFetch) {
    return injectedFetch(path, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
      timeoutMs: 25_000,
    });
  }
  if (typeof window.api === 'function') return window.api(path, { method, body, timeoutMs: 25_000 });
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  return res.json();
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmtExpiry(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.round((t - Date.now()) / 86_400_000);
  const date = new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return days <= 1 ? `expires ${date} (soon)` : `expires ${date}`;
}

export async function loadBankedResets(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.providers;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const data = await request(`/api/usage/reset-credits${force ? '?force=1' : ''}`);
      const providers = Array.isArray(data?.providers) ? data.providers : [];
      cache = { at: Date.now(), providers };
      return providers;
    } catch {
      return cache?.providers || [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function slotFor(popover) {
  let slot = popover.querySelector(':scope > .pm-banked-reset');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'pm-banked-reset';
    slot.hidden = true;
    popover.appendChild(slot);
  }
  return slot;
}

// The provider the ACTIVE chat is on. A reset only helps the provider you are
// actually using, so a Claude chat must never show a Codex reset (and vice
// versa). Desktop keeps window._activeProvider in sync with the per-chat
// route; mobile keeps window.__pmChatModelRoute (effective > override).
// Unknown provider => show nothing rather than guess.
function activeChatProvider(popover) {
  const mobile = popover?.id === 'pm-ctx-popover' || document.body?.classList?.contains('pm-mobile-active');
  const route = mobile ? window.__pmChatModelRoute : window._activeChatModelRoute;
  const fromRoute = route?.effective?.providerId || route?.override?.providerId || route?.providerId;
  const raw = fromRoute || (!mobile ? window._activeProvider : '') || '';
  return String(raw).trim().toLowerCase();
}

function render(slot, providers, activeProvider = '') {
  const available = providers.filter((p) => Number(p?.available) > 0 && p?.next?.id
    && activeProvider && String(p.provider).toLowerCase() === activeProvider);
  if (!available.length) { slot.hidden = true; slot.innerHTML = ''; return; }
  slot.hidden = false;
  slot.innerHTML = available.map((p) => {
    const label = PROVIDER_LABELS[p.provider] || p.provider;
    const count = Number(p.available);
    return `<div class="pm-banked-reset-row">
      <div class="pm-banked-reset-text">
        <span class="pm-banked-reset-title">${esc(label)} reset available${count > 1 ? ` (${count})` : ''}</span>
        <span class="pm-banked-reset-sub">${esc(fmtExpiry(p.next.expiresAt))}</span>
      </div>
      <button type="button" class="pm-banked-reset-btn" data-pm-banked-reset="${esc(p.provider)}" data-credit-id="${esc(p.next.id)}">Use</button>
    </div>`;
  }).join('');
}

async function refreshPopover(popover, force = false) {
  const slot = slotFor(popover);
  const providers = await loadBankedResets(force);
  // Read the provider after the await so a chat/model switch during the fetch
  // is respected.
  render(slot, providers, activeChatProvider(popover));
}

function closeConfirm() {
  document.getElementById('pm-banked-reset-confirm')?.remove();
}

function openConfirm(provider, creditId, sourcePopover) {
  closeConfirm();
  const label = PROVIDER_LABELS[provider] || provider;
  const wrap = document.createElement('div');
  wrap.id = 'pm-banked-reset-confirm';
  wrap.className = 'pm-banked-reset-confirm-backdrop';
  wrap.innerHTML = `<div class="pm-banked-reset-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pm-brc-title">
    <div class="pm-brc-title" id="pm-brc-title">Use your ${esc(label)} reset?</div>
    <div class="pm-brc-body">This sets your ${esc(label)} usage limits back to full right away. It uses up the banked reset and <strong>can't be undone</strong>.</div>
    <div class="pm-brc-status" aria-live="polite"></div>
    <div class="pm-brc-actions">
      <button type="button" class="pm-brc-cancel">Cancel</button>
      <button type="button" class="pm-brc-confirm">Use reset</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const status = wrap.querySelector('.pm-brc-status');
  const confirmBtn = wrap.querySelector('.pm-brc-confirm');
  const cancelBtn = wrap.querySelector('.pm-brc-cancel');
  // Same soft-lock idea as the Stop button: a double tap that opened the
  // dialog must not also confirm it.
  confirmBtn.disabled = true;
  setTimeout(() => { if (confirmBtn.isConnected && !wrap.dataset.busy) confirmBtn.disabled = false; }, 700);
  cancelBtn.addEventListener('click', closeConfirm);
  wrap.addEventListener('click', (e) => { if (e.target === wrap && !wrap.dataset.busy) closeConfirm(); });
  confirmBtn.addEventListener('click', async () => {
    if (wrap.dataset.busy) return;
    wrap.dataset.busy = '1';
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    status.textContent = 'Using reset…';
    try {
      const out = await request('/api/usage/reset-credits/consume', {
        method: 'POST',
        body: { provider, credit_id: creditId, confirm: true },
      });
      if (!out?.success) throw new Error(out?.error || 'Reset failed');
      const msg = {
        reset: `${label} limits reset.`,
        nothing_to_reset: `Nothing to reset. Your ${label} limits are already full, so the reset was kept.`,
        no_credit: 'That reset is no longer available.',
        already_redeemed: 'That reset was already used.',
      }[out.outcome] || `Done (${out.outcome}).`;
      status.textContent = msg;
      cache = { at: Date.now(), providers: out.credits ? [out.credits] : [] };
      if (sourcePopover?.isConnected) render(slotFor(sourcePopover), cache.providers);
      try { window.dispatchEvent(new CustomEvent('pm-usage-reset', { detail: { provider, outcome: out.outcome } })); } catch {}
      try { window.refreshChatContextWindow?.({ force: true }); } catch {}
      try { window.__pmMobileRefreshContextWindow?.({ force: true }); } catch {}
      cancelBtn.textContent = 'Close';
      cancelBtn.disabled = false;
      delete wrap.dataset.busy;
      confirmBtn.hidden = true;
    } catch (err) {
      status.textContent = `Couldn't use the reset: ${err?.message || err}`;
      cancelBtn.disabled = false;
      delete wrap.dataset.busy;
      confirmBtn.disabled = false;
    }
  });
}

function onClick(e) {
  const btn = e.target?.closest?.('[data-pm-banked-reset]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openConfirm(btn.dataset.pmBankedReset, btn.dataset.creditId, btn.closest(POPOVER_IDS.map((id) => `#${id}`).join(',')) || btn.closest('.chat-context-window-popover'));
}

function watchPopover(popover) {
  if (!popover || popover.__pmBankedResetWatched) return;
  popover.__pmBankedResetWatched = true;
  const obs = new MutationObserver(() => { if (!popover.hidden) void refreshPopover(popover); });
  obs.observe(popover, { attributes: true, attributeFilter: ['hidden'] });
  if (!popover.hidden) void refreshPopover(popover);
}

function scan() {
  for (const id of POPOVER_IDS) watchPopover(document.getElementById(id));
  // Secondary desktop composers render their own popover copies.
  document.querySelectorAll('.chat-context-window-popover').forEach(watchPopover);
}

export function installBankedResetUi() {
  if (window.__pmBankedResetInstalled) return;
  window.__pmBankedResetInstalled = true;
  document.addEventListener('click', onClick, true);
  scan();
  // Popovers only open from a tap, and mobile re-renders them per page. Re-scan
  // after taps instead of observing the whole DOM (which would fire on every
  // streamed token).
  let pending = false;
  document.addEventListener('pointerup', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); });
  }, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBankedResetUi, { once: true });
  else installBankedResetUi();
}
