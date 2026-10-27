/**
 * provider-accounts-list.js — shared (desktop + mobile) provider-grouped
 * accounts list for Settings > Models.
 *
 * Renders every account of every account-aware provider grouped under its
 * provider, with a status pill and a per-provider "Add account" action.
 * Tapping an account opens a bottom sheet to rename it, make it the default,
 * jump to its connection controls, or remove it. Removal previews (dryRun)
 * which agent roles used the account before asking for confirmation.
 *
 * The module owns no settings state: it reads window._llmSettingsCache via
 * deps.getCache() and persists through the gateway routes
 * /api/settings/provider-accounts/{update,remove}.
 */

export const ACCOUNT_PROVIDER_ORDER = ['anthropic', 'openai_codex', 'openai', 'xai'];

const PROVIDER_META = {
  anthropic: { name: 'Anthropic', letter: 'A' },
  openai_codex: { name: 'ChatGPT / Codex', letter: 'C' },
  openai: { name: 'OpenAI API', letter: 'O' },
  xai: { name: 'xAI', letter: 'X' },
};

const AUTH_LABELS = { setup_token: 'Setup token', oauth: 'Sign-in', api_key: 'API key' };

const ROLE_LABELS = {
  main_chat: 'Main chat',
  background_spawn: 'Background agents',
  switch_model_low: 'Fast switch',
  switch_model_medium: 'Careful switch',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function providerAccountMeta(providerId) {
  return PROVIDER_META[providerId] || { name: providerId, letter: String(providerId || '?').charAt(0).toUpperCase() };
}

export function roleLabel(role) {
  const key = String(role || '');
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  const cleaned = key.replace(/^subagent[-_]/, '').replace(/[-_]+/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : key;
}

/**
 * Pure view model: which provider groups to show and their accounts.
 * A provider is listed when it has explicitly configured accounts or is the
 * active chat provider; everything else is offered under "Add a provider".
 */
export function buildAccountGroups(llm, normalizeAccounts, savedAccountIds = null) {
  const cache = llm && typeof llm === 'object' ? llm : {};
  const providers = cache.providers && typeof cache.providers === 'object' ? cache.providers : {};
  const groups = [];
  const addable = [];
  for (const providerId of ACCOUNT_PROVIDER_ORDER) {
    const cfg = providers[providerId] && typeof providers[providerId] === 'object' ? providers[providerId] : null;
    const hasAccounts = !!(cfg && cfg.accounts && typeof cfg.accounts === 'object' && Object.keys(cfg.accounts).length);
    if (!hasAccounts && cache.provider !== providerId) {
      addable.push(providerId);
      continue;
    }
    const accounts = typeof normalizeAccounts === 'function' ? normalizeAccounts(providerId, cfg || {}) : [];
    const defaultId = String(cfg?.defaultAccountId || accounts[0]?.id || '');
    const savedIds = savedAccountIds && Array.isArray(savedAccountIds[providerId]) ? savedAccountIds[providerId] : null;
    groups.push({
      providerId,
      ...providerAccountMeta(providerId),
      accounts: accounts.map((account) => ({
        id: String(account.id),
        label: String(account.label || account.id),
        authType: String(account.authType || ''),
        authLabel: AUTH_LABELS[account.authType] || 'Account',
        connected: String(account.status || '') === 'connected',
        isDefault: String(account.id) === defaultId,
        draft: Array.isArray(savedIds) ? !savedIds.includes(String(account.id)) : false,
      })),
    });
  }
  return { groups, addable };
}

function renderList(state) {
  const { groups, addable } = state;
  const groupHtml = groups.map((group) => `
    <div class="spa-group" data-provider="${esc(group.providerId)}">
      <div class="spa-group-head">
        <span class="spa-prov spa-prov-${esc(group.providerId)}" aria-hidden="true">${esc(group.letter)}</span>
        <span class="spa-group-name">${esc(group.name)}</span>
        <button class="spa-add" type="button" data-spa-add="${esc(group.providerId)}">+ Add account</button>
      </div>
      ${group.accounts.length ? group.accounts.map((account) => `
        <button class="spa-row" type="button" data-spa-provider="${esc(group.providerId)}" data-spa-account="${esc(account.id)}">
          <span class="spa-row-main">
            <span class="spa-row-label">${esc(account.label)}</span>
            <span class="spa-row-meta">${esc(account.authLabel)}${account.isDefault ? ' · Default' : ''}${account.draft ? ' · Not saved yet' : ''}</span>
          </span>
          <span class="spa-pill ${account.connected ? 'spa-pill-ok' : 'spa-pill-off'}">${account.connected ? 'Connected' : 'Not connected'}</span>
          <span class="spa-chev" aria-hidden="true">›</span>
        </button>`).join('') : '<div class="spa-empty">No accounts yet.</div>'}
    </div>`).join('');
  const addableHtml = addable.length ? `
    <div class="spa-group spa-group-addable">
      <div class="spa-group-head"><span class="spa-group-name">Add a provider</span></div>
      ${addable.map((providerId) => {
        const meta = providerAccountMeta(providerId);
        return `<button class="spa-row" type="button" data-spa-add="${esc(providerId)}">
          <span class="spa-prov spa-prov-${esc(providerId)}" aria-hidden="true">${esc(meta.letter)}</span>
          <span class="spa-row-main"><span class="spa-row-label">${esc(meta.name)}</span></span>
          <span class="spa-chev" aria-hidden="true">+</span>
        </button>`;
      }).join('')}
    </div>` : '';
  return `<section class="spa-root" aria-label="Accounts">
    <div class="spa-head"><h2>Accounts</h2><span class="spa-sub">Tap an account to rename, test, or remove it.</span></div>
    ${groupHtml || '<div class="spa-empty">No provider accounts yet.</div>'}
    ${addableHtml}
  </section>`;
}

function closeSheet() {
  document.querySelectorAll('.spa-sheet-backdrop').forEach((node) => node.remove());
  document.removeEventListener('keydown', onSheetKeydown, true);
}

function onSheetKeydown(event) {
  // While the remove confirmation is open, Escape belongs to it, not the sheet.
  if (document.querySelector('#__sc-confirm-ok')) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeSheet();
  }
}

function openSheet(group, account, deps) {
  closeSheet();
  // Unsaved drafts don't count: the gateway refuses to remove the only saved account.
  const savedCount = group.accounts.filter((item) => !item.draft).length;
  const canRemove = !account.draft && savedCount > 1;
  const host = document.getElementById('settings-modal') || document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'spa-sheet-backdrop';
  backdrop.innerHTML = `
    <div class="spa-sheet" role="dialog" aria-modal="true" aria-label="${esc(account.label)} account">
      <div class="spa-sheet-grab" aria-hidden="true"></div>
      <div class="spa-sheet-title">${esc(account.label)}<small>${esc(group.name)} · ${esc(account.authLabel)}${account.isDefault ? ' · Default' : ''}</small></div>
      <label class="spa-field"><span>Name</span><input class="settings-input" data-spa-name maxlength="64" value="${esc(account.label)}" autocomplete="off"></label>
      <div class="spa-sheet-status" data-spa-status role="status" aria-live="polite"></div>
      ${canRemove || account.draft ? '' : `<div class="spa-sheet-note">This is your only ${esc(group.name)} account. To sign it out, use Disconnect under ${account.connected ? 'Manage connection' : 'Connect'}.</div>`}
      <div class="spa-actions">
        <button class="spa-btn" type="button" data-act="rename">Save name</button>
        ${account.isDefault ? '' : '<button class="spa-btn" type="button" data-act="default">Make default</button>'}
        <button class="spa-btn" type="button" data-act="connect">${account.connected ? 'Manage connection' : 'Connect'}</button>
        ${canRemove ? '<button class="spa-btn spa-btn-danger" type="button" data-act="remove">Remove account</button>' : ''}
      </div>
      <button class="spa-btn spa-done" type="button" data-act="done">Done</button>
    </div>`;
  host.appendChild(backdrop);
  document.addEventListener('keydown', onSheetKeydown, true);
  const statusEl = backdrop.querySelector('[data-spa-status]');
  const setStatus = (text, tone = '') => {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.dataset.tone = tone;
  };
  const busy = (on) => backdrop.querySelectorAll('.spa-btn').forEach((btn) => { btn.disabled = !!on; });
  const post = (path, body) => deps.api(path, { method: 'POST', body: JSON.stringify(body), timeoutMs: 15000 });

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { closeSheet(); return; }
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'done') { closeSheet(); return; }
    if (act === 'connect') {
      closeSheet();
      deps.onManage?.(group.providerId, account.id);
      return;
    }
    // Rows added with "+ Add account" exist only in the unsaved settings draft
    // until connected/saved; the gateway doesn't know them yet.
    if (account.draft && act !== 'connect') {
      setStatus('Finish connecting this account (or press Save) before renaming or removing it.', 'error');
      return;
    }
    if (act === 'rename' || act === 'default') {
      const label = String(backdrop.querySelector('[data-spa-name]')?.value || '').trim();
      if (act === 'rename' && !label) { setStatus('Name cannot be empty.', 'error'); return; }
      busy(true);
      try {
        const body = { providerId: group.providerId, accountId: account.id };
        if (act === 'rename') body.label = label;
        else body.makeDefault = true;
        const res = await post('/api/settings/provider-accounts/update', body);
        if (res && res.success === false) throw new Error(res.error || 'Update failed');
        closeSheet();
        deps.showToast?.(act === 'rename' ? 'Account renamed' : 'Default account updated', `${group.name}: ${act === 'rename' ? label : account.label}`, 'success', 3000);
        await deps.onReload?.();
      } catch (err) {
        setStatus(err?.message || 'Update failed', 'error');
        busy(false);
      }
      return;
    }
    if (act === 'remove') {
      busy(true);
      let preview;
      try {
        preview = await post('/api/settings/provider-accounts/remove', { providerId: group.providerId, accountId: account.id, dryRun: true });
        if (preview && preview.success === false) throw new Error(preview.error || 'Could not check this account');
      } catch (err) {
        setStatus(err?.message || 'Could not check this account', 'error');
        busy(false);
        return;
      }
      const roles = Array.isArray(preview?.affectedRoles) ? preview.affectedRoles : [];
      const nextDefault = group.accounts.find((item) => item.id === preview?.nextDefaultAccountId);
      const fallback = nextDefault ? `"${nextDefault.label}"` : 'the provider default';
      const details = roles.length
        ? `These agent roles used it and will switch to ${fallback}: ${roles.map(roleLabel).join(', ')}.`
        : '';
      const confirmRemove = async () => {
        try {
          const res = await post('/api/settings/provider-accounts/remove', { providerId: group.providerId, accountId: account.id });
          if (res && res.success === false) throw new Error(res.error || 'Remove failed');
          closeSheet();
          if (res && res.credentialsCleared === false) {
            deps.showToast?.('Account removed', `${group.name}: ${account.label}. Some saved credentials could not be deleted; check the gateway log.`, 'warning', 6000);
          } else {
            deps.showToast?.('Account removed', `${group.name}: ${account.label}`, 'success', 3000);
          }
          await deps.onReload?.();
        } catch (err) {
          setStatus(err?.message || 'Remove failed', 'error');
          busy(false);
        }
      };
      deps.showConfirm(
        'This signs it out and deletes its saved credentials.',
        confirmRemove,
        () => busy(false),
        { title: `Remove "${account.label}" from ${group.name}?`, confirmText: 'Remove', danger: true, details, onDismiss: () => busy(false) },
      );
    }
  });
  setTimeout(() => backdrop.querySelector('.spa-sheet')?.classList.add('spa-sheet-open'), 0);
}

/**
 * Mount (or re-render) the accounts list. Idempotent: replaces the
 * container's content and rebinds one delegated click handler.
 */
export function mountProviderAccountsList(container, deps) {
  if (!container || !deps) return;
  const state = buildAccountGroups(deps.getCache?.(), deps.normalizeAccounts, deps.getSavedAccountIds?.() || null);
  container.innerHTML = renderList(state);
  container.__spaState = state;
  container.__spaDeps = deps;
  if (container.__spaBound) return;
  container.__spaBound = true;
  container.addEventListener('click', (event) => {
    const current = container.__spaState;
    const currentDeps = container.__spaDeps;
    const addBtn = event.target.closest('[data-spa-add]');
    if (addBtn) {
      currentDeps.onAdd?.(addBtn.getAttribute('data-spa-add'));
      return;
    }
    const row = event.target.closest('[data-spa-account]');
    if (!row) return;
    const group = current.groups.find((item) => item.providerId === row.getAttribute('data-spa-provider'));
    const account = group?.accounts.find((item) => item.id === row.getAttribute('data-spa-account'));
    if (group && account) openSheet(group, account, currentDeps);
  });
}

export { closeSheet as closeProviderAccountSheet };
