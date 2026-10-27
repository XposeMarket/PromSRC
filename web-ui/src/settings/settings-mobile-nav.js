/**
 * settings-mobile-nav.js — phone layout for the shared Settings modal.
 *
 * At <=760px the 14-item tab strip becomes an iOS-style grouped home list
 * (built from the existing #settings-tabstrip buttons, so new tabs appear
 * automatically) and each section opens as its own page with a
 * "‹ Settings" back button. Desktop widths are untouched.
 *
 * State lives in two classes on #settings-modal: `smh-home` (list visible)
 * and `smh-page` (one section visible). Both are removed above 760px.
 */

const MOBILE_QUERY = '(max-width: 760px)';
let mediaQuery = null;
let mode = 'home';

// Tabs injected at runtime (Voice) have no sidebar icon node.
const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const FALLBACK_ICONS = {
  voice: `<svg ${SVG_ATTRS}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>`,
};

function modal() {
  return document.getElementById('settings-modal');
}

export function isMobileSettingsLayout() {
  try { return !!window.matchMedia?.(MOBILE_QUERY).matches; } catch { return false; }
}

function tabIdFromButton(btn) {
  return String(btn?.id || '').replace(/^settings-tab-/, '');
}

function buildHomeList() {
  const root = modal();
  const strip = document.getElementById('settings-tabstrip');
  const main = root?.querySelector('.settings-page-main');
  if (!root || !strip || !main) return null;
  let home = document.getElementById('settings-mobile-home');
  if (!home) {
    home = document.createElement('nav');
    home.id = 'settings-mobile-home';
    home.className = 'smh';
    home.setAttribute('aria-label', 'Settings sections');
    main.insertBefore(home, main.firstChild);
    home.addEventListener('click', (event) => {
      const row = event.target.closest('[data-smh-tab]');
      if (!row) return;
      const tab = row.getAttribute('data-smh-tab');
      if (typeof window.setSettingsTab === 'function') window.setSettingsTab(tab);
      showMobileSettingsPage();
    });
  }
  const parts = [];
  let open = false;
  for (const node of Array.from(strip.children)) {
    if (node.classList.contains('settings-nav-group-label')) {
      if (open) parts.push('</div>');
      parts.push(`<div class="smh-sec"${node.hidden ? ' hidden' : ''}>${escapeText(node.textContent)}</div><div class="smh-grp">`);
      open = true;
      continue;
    }
    if (node.tagName !== 'BUTTON') continue;
    const tab = tabIdFromButton(node);
    if (!tab) continue;
    if (!open) { parts.push('<div class="smh-grp">'); open = true; }
    const icon = node.querySelector('.settings-nav-icon');
    // Skip the icon and count badges (e.g. Pairing shows a device count).
    const label = Array.from(node.querySelectorAll('span'))
      .filter((span) => !span.classList.contains('settings-nav-icon') && !/badge|count/i.test(span.className) && !/^\s*\d+\s*$/.test(span.textContent || ''))
      .map((span) => span.textContent).join(' ').trim() || node.textContent.replace(/\s+\d+\s*$/, '').trim();
    parts.push(`<button type="button" class="smh-row" data-smh-tab="${escapeAttr(tab)}"${node.hidden ? ' hidden' : ''}>
      <span class="smh-ico" aria-hidden="true">${icon ? icon.innerHTML : (FALLBACK_ICONS[tab] || '')}</span>
      <span class="smh-lb">${escapeText(label)}</span>
      <span class="smh-chev" aria-hidden="true">›</span>
    </button>`);
  }
  if (open) parts.push('</div>');
  home.innerHTML = parts.join('');
  return home;
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function ensureBackButton() {
  const toolbar = modal()?.querySelector('.settings-page-toolbar');
  if (!toolbar || toolbar.querySelector('.smh-back')) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'smh-back';
  back.setAttribute('aria-label', 'Back to all settings');
  back.innerHTML = '<span aria-hidden="true">‹</span> Settings';
  back.addEventListener('click', () => showMobileSettingsHome());
  toolbar.insertBefore(back, toolbar.firstChild);
}

function applyMode() {
  const root = modal();
  if (!root) return;
  const active = isMobileSettingsLayout();
  root.classList.toggle('smh-home', active && mode === 'home');
  root.classList.toggle('smh-page', active && mode === 'page');
  if (active && mode === 'home') {
    const main = root.querySelector('.settings-page-main');
    if (main) main.scrollTop = 0;
  }
}

export function showMobileSettingsHome() {
  mode = 'home';
  buildHomeList();
  applyMode();
}

export function showMobileSettingsPage() {
  mode = 'page';
  ensureBackButton();
  applyMode();
  const main = modal()?.querySelector('.settings-page-main');
  if (main) main.scrollTop = 0;
}

/** Keep the home list in sync with the sidebar search filter. */
export function refreshMobileSettingsHome() {
  if (document.getElementById('settings-mobile-home')) buildHomeList();
}

/**
 * Called on every Settings open. `startOnHome` is false when a specific
 * section was deep-linked (e.g. /mobile/settings/models).
 */
export function initSettingsMobileNav({ startOnHome = true } = {}) {
  if (!mediaQuery && window.matchMedia) {
    mediaQuery = window.matchMedia(MOBILE_QUERY);
    const onChange = () => applyMode();
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onChange);
    else mediaQuery.addListener?.(onChange);
    const search = document.getElementById('settings-search-input');
    search?.addEventListener('input', () => {
      refreshMobileSettingsHome();
      if (isMobileSettingsLayout() && mode !== 'home' && search.value.trim()) showMobileSettingsHome();
    });
  }
  buildHomeList();
  ensureBackButton();
  if (startOnHome) showMobileSettingsHome();
  else showMobileSettingsPage();
}
