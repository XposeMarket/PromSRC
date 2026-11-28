/**
 * settings-kit.js — shared building blocks for every Settings page (desktop and
 * phone; the phone uses the same #settings-modal at <=760px).
 *
 * Grouped sections: a small heading, then one card of rows. One row per
 * setting: label + short description on the left, the control on the right.
 * Plus: switch, segmented buttons, fold (collapsed row that expands in place),
 * the one model picker, sheets, the single save bar and a change tracker.
 *
 * The kit owns no settings state and never talks to the gateway. Pages keep
 * their existing controls (the "store") as the only thing the existing save
 * code reads; the kit only renders and reports user intent.
 *
 * Importable from Node (no DOM access at module load) so the pure helpers are
 * unit-tested by scripts/test-settings-kit.mjs.
 */

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const ICONS = {
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  zap: '<path d="M13 3L5 13.5h6L10 21l9-11h-6z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  device: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
};

export function skIcon(name, cls = 'sk-ico') {
  const paths = ICONS[name] || ICONS.cog;
  return `<svg class="${esc(cls)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Section heading. `right` is trusted HTML (e.g. the Preset button). */
export function skSection({ title, hint = '', right = '', id = '' } = {}) {
  return `<div class="sk-sec"${id ? ` id="${esc(id)}"` : ''}><h2>${esc(title)}${hint ? ` <span class="sk-hint">${esc(hint)}</span>` : ''}</h2>${right || ''}</div>`;
}

export function skCard(inner, { cls = '', id = '', attrs = '' } = {}) {
  return `<div class="sk-card${cls ? ` ${esc(cls)}` : ''}"${id ? ` id="${esc(id)}"` : ''}${attrs ? ` ${attrs}` : ''}>${inner}</div>`;
}

/**
 * One setting row. `control` and `icon` are trusted HTML built by the kit or the
 * page; label/desc are escaped. `forId` links the label to its control.
 */
export function skRow({ label = '', desc = '', control = '', icon = '', cls = '', id = '', attrs = '', forId = '' } = {}) {
  const labelHtml = forId
    ? `<label class="sk-name" for="${esc(forId)}">${esc(label)}</label>`
    : `<div class="sk-name">${esc(label)}</div>`;
  return `<div class="sk-row${cls ? ` ${esc(cls)}` : ''}"${id ? ` id="${esc(id)}"` : ''}${attrs ? ` ${attrs}` : ''}>`
    + `<div class="sk-who">${icon ? `<span class="sk-tile" aria-hidden="true">${icon}</span>` : ''}<div class="sk-copy">${labelHtml}${desc ? `<div class="sk-desc">${esc(desc)}</div>` : ''}</div></div>`
    + `${control ? `<div class="sk-ctl">${control}</div>` : ''}</div>`;
}

export function skSwitch({ id = '', checked = false, label = '', disabled = false, attrs = '' } = {}) {
  return `<button type="button" class="sk-switch" role="switch" aria-checked="${checked ? 'true' : 'false'}"${id ? ` id="${esc(id)}"` : ''}${label ? ` aria-label="${esc(label)}"` : ''}${disabled ? ' disabled' : ''}${attrs ? ` ${attrs}` : ''}><span class="sk-knob"></span></button>`;
}

/** Segmented buttons for small fixed choices. options: [{ value, label, disabled }] */
export function skSegmented({ name = '', options = [], value = '', label = '', attrs = '', disabled = false } = {}) {
  const buttons = options.map((option) => {
    const on = String(option.value) === String(value);
    return `<button type="button" class="sk-seg-btn${on ? ' on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-value="${esc(option.value)}"${option.disabled || disabled ? ' disabled' : ''}>${esc(option.label)}</button>`;
  }).join('');
  return `<div class="sk-seg" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}${name ? ` data-seg="${esc(name)}"` : ''}${attrs ? ` ${attrs}` : ''}>${buttons}</div>`;
}

/** Collapsed row that expands in place. The body is the next sibling `.sk-sub[data-fold-body=id]`. */
export function skFold({ id, label, desc = '', icon = '', open = false, cls = '' } = {}) {
  return `<button type="button" class="sk-row sk-fold${open ? ' open' : ''}${cls ? ` ${esc(cls)}` : ''}" data-fold="${esc(id)}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="sk-fold-${esc(id)}">`
    + `<span class="sk-who">${icon ? `<span class="sk-tile" aria-hidden="true">${icon}</span>` : ''}<span class="sk-copy"><span class="sk-name">${esc(label)}</span>${desc ? `<span class="sk-desc">${esc(desc)}</span>` : ''}</span></span>`
    + `${skIcon('down', 'sk-ico sk-chev')}</button>`;
}

export function skFoldBody(id, inner, { open = false, cls = '' } = {}) {
  return `<div class="sk-sub${cls ? ` ${esc(cls)}` : ''}" id="sk-fold-${esc(id)}" data-fold-body="${esc(id)}"${open ? '' : ' hidden'}>${inner}</div>`;
}

export function skButton(label, { kind = '', attrs = '', id = '', disabled = false } = {}) {
  return `<button type="button" class="sk-btn${kind ? ` ${esc(kind)}` : ''}"${id ? ` id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}${attrs ? ` ${attrs}` : ''}>${esc(label)}</button>`;
}

export function skEmpty({ title, body = '', actions = '', icon = 'sparkle' } = {}) {
  return `<div class="sk-empty"><span class="sk-empty-ico" aria-hidden="true">${skIcon(icon)}</span><div class="sk-empty-title">${esc(title)}</div>${body ? `<div class="sk-empty-body">${esc(body)}</div>` : ''}${actions ? `<div class="sk-empty-actions">${actions}</div>` : ''}</div>`;
}

export function skNote(text, { tone = '' } = {}) {
  return `<div class="sk-note${tone ? ` sk-note-${esc(tone)}` : ''}">${esc(text)}</div>`;
}

/* ─── Model slots: pure helpers (unit tested) ─────────────────────────────── */

/** Split "provider/model" (model ids may contain further slashes). */
export function splitModelRef(ref) {
  const raw = String(ref || '').trim();
  const slash = raw.indexOf('/');
  return slash > 0 ? { provider: raw.slice(0, slash), model: raw.slice(slash + 1) } : { provider: '', model: raw };
}

/**
 * What a model slot shows.
 *  - 'same'        nothing saved: "Same as main chat" (or the slot's inherit label)
 *  - 'set'         saved and offered by a connected provider
 *  - 'unavailable' saved but the provider is not connected or no longer lists it.
 * An unavailable slot keeps its saved id; it is never shown as Off/blank and the
 * store keeps the saved value, so saving the page sends it back unchanged.
 */
export function modelSlotState({ provider = '', model = '', connected = [], available = null } = {}) {
  const p = String(provider || '').trim();
  const m = String(model || '').trim();
  if (!p || !m) return { state: 'same', reason: '' };
  if (Array.isArray(connected) && connected.length && !connected.includes(p)) return { state: 'unavailable', reason: 'not-connected' };
  if (Array.isArray(connected) && !connected.length) return { state: 'unavailable', reason: 'not-connected' };
  if (Array.isArray(available) && available.length && !available.includes(m)) return { state: 'unavailable', reason: 'not-listed' };
  return { state: 'set', reason: '' };
}

/** Picker groups, with the saved-but-unlisted model kept visible in its group. */
export function buildPickerGroups(providers = [], saved = null) {
  const groups = providers.map((group) => ({ ...group, models: [...(group.models || [])] }));
  if (saved?.provider && saved?.model) {
    let group = groups.find((item) => item.provider === saved.provider);
    if (!group) {
      group = { provider: saved.provider, name: saved.providerName || saved.provider, note: 'Not connected', models: [], disconnected: true };
      groups.push(group);
    }
    if (!group.models.some((item) => item.id === saved.model)) group.models.unshift({ id: saved.model, label: saved.label || saved.model, unavailable: true });
  }
  return groups;
}

/** Case-insensitive filter on model label, id and group name. */
export function filterPickerGroups(groups = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return groups;
  return groups.map((group) => {
    const groupHit = String(group.name || '').toLowerCase().includes(q);
    const models = groupHit ? group.models : group.models.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(q));
    return { ...group, models };
  }).filter((group) => group.models.length);
}

/**
 * Change tracker. track(key, label, before, after): the first call remembers
 * `before`; a later call that returns to it clears the change. Labels are what
 * the save bar lists ("Background agents, Team coordinator").
 */
export function createChangeTracker() {
  const entries = new Map();
  return {
    track(key, label, before, after) {
      const k = String(key);
      const existing = entries.get(k);
      const original = existing ? existing.original : before;
      if (JSON.stringify(original) === JSON.stringify(after)) entries.delete(k);
      else entries.set(k, { label: label || k, original });
    },
    has(key) { return entries.has(String(key)); },
    forget(key) { entries.delete(String(key)); },
    original(key) { return entries.get(String(key))?.original; },
    count() { return entries.size; },
    labels() { return Array.from(new Set(Array.from(entries.values()).map((entry) => entry.label))); },
    keys() { return Array.from(entries.keys()); },
    clear() { entries.clear(); },
  };
}

/** "2 unsaved changes · Background agents, Team coordinator" (labels cut at 3). */
export function summarizeChanges(labels = []) {
  const list = Array.from(new Set(labels.filter(Boolean)));
  const n = list.length;
  if (!n) return { title: '', detail: '' };
  const shown = list.slice(0, 3).join(', ');
  return { title: `${n} unsaved change${n === 1 ? '' : 's'}`, detail: n > 3 ? `${shown} and ${n - 3} more` : shown };
}

/* ─── DOM behaviors (browser only) ────────────────────────────────────────── */

/**
 * Delegated behavior for switches, segmented buttons and folds inside `root`.
 * Emits `sk-switch` {checked} and `sk-seg` {value} CustomEvents on the control.
 */
export function wireKit(root) {
  if (!root || root.__skWired) return;
  root.__skWired = true;
  root.addEventListener('click', (event) => {
    const sw = event.target.closest('.sk-switch');
    if (sw && root.contains(sw) && !sw.disabled) {
      const checked = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', checked ? 'true' : 'false');
      sw.dispatchEvent(new CustomEvent('sk-switch', { bubbles: true, detail: { checked } }));
      return;
    }
    const seg = event.target.closest('.sk-seg-btn');
    if (seg && root.contains(seg) && !seg.disabled) {
      const group = seg.closest('.sk-seg');
      group?.querySelectorAll('.sk-seg-btn').forEach((btn) => {
        const on = btn === seg;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      seg.dispatchEvent(new CustomEvent('sk-seg', { bubbles: true, detail: { value: seg.getAttribute('data-value') } }));
      return;
    }
    const fold = event.target.closest('.sk-fold');
    if (fold && root.contains(fold)) {
      const id = fold.getAttribute('data-fold');
      const body = root.querySelector(`[data-fold-body="${CSS.escape(id)}"]`);
      const open = !fold.classList.contains('open');
      fold.classList.toggle('open', open);
      fold.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (body) body.hidden = !open;
      fold.dispatchEvent(new CustomEvent('sk-fold', { bubbles: true, detail: { id, open } }));
    }
  });
  root.addEventListener('keydown', (event) => {
    const seg = event.target.closest?.('.sk-seg-btn');
    if (!seg || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = Array.from(seg.closest('.sk-seg').querySelectorAll('.sk-seg-btn:not([disabled])'));
    const next = buttons[(buttons.indexOf(seg) + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    if (next) { event.preventDefault(); next.focus(); next.click(); }
  });
}

function settingsHost() {
  // Sheets and the picker live in a <section> layer inside #settings-modal so the
  // settings CSS applies, but theme rules for `#settings-modal > div` do not.
  const modal = document.getElementById('settings-modal');
  if (!modal) return document.body;
  let layer = modal.querySelector(':scope > section.sk-layer');
  if (!layer) {
    layer = document.createElement('section');
    layer.className = 'sk-layer';
    modal.appendChild(layer);
  }
  return layer;
}

function isPhone() {
  try { return !!window.matchMedia?.('(max-width: 760px)').matches; } catch { return false; }
}

/**
 * Modal sheet (centered dialog on desktop, bottom sheet on phones).
 * body: Node or trusted HTML. Returns { el, body, close }.
 */
export function openSheet({ title = '', sub = '', body = '', footer = '', onClose = null, cls = '', label = '' } = {}) {
  closeSheets();
  const backdrop = document.createElement('div');
  backdrop.className = `sk-sheet-backdrop${isPhone() ? ' sk-phone' : ''}`;
  backdrop.innerHTML = `<div class="sk-sheet${cls ? ` ${esc(cls)}` : ''}" role="dialog" aria-modal="true" aria-label="${esc(label || title)}">
    <div class="sk-sheet-grab" aria-hidden="true"></div>
    <div class="sk-sheet-head"><div><div class="sk-sheet-title">${esc(title)}</div>${sub ? `<div class="sk-sheet-sub">${esc(sub)}</div>` : ''}</div>
      <button type="button" class="sk-icon-btn" data-sheet-close aria-label="Close">${skIcon('close')}</button></div>
    <div class="sk-sheet-body"></div>
    ${footer ? `<div class="sk-sheet-foot">${footer}</div>` : ''}
  </div>`;
  const bodyEl = backdrop.querySelector('.sk-sheet-body');
  if (body && typeof body === 'object' && body.nodeType) bodyEl.appendChild(body);
  else bodyEl.innerHTML = String(body || '');
  settingsHost().appendChild(backdrop);
  wireKit(backdrop);
  const previousFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    try { onClose?.(); } finally {
      backdrop.remove();
      try { previousFocus?.focus?.({ preventScroll: true }); } catch {}
    }
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.sk-pop') || document.querySelector('#__sc-confirm-ok') || document.querySelector('.spa-sheet-backdrop')) return;
    event.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-sheet-close]')) close();
  });
  backdrop.__skClose = close;
  setTimeout(() => {
    backdrop.classList.add('open');
    backdrop.querySelector('.sk-sheet-body input, .sk-sheet-body select, .sk-sheet-body button, [data-sheet-close]')?.focus?.({ preventScroll: true });
  }, 0);
  return { el: backdrop, body: bodyEl, close };
}

export function closeSheets() {
  document.querySelectorAll('.sk-sheet-backdrop').forEach((node) => (node.__skClose ? node.__skClose() : node.remove()));
}

/**
 * The one model picker. Searchable, grouped by provider (logo + name + note),
 * optional "Same as …" first option, and a footer with Reasoning and Fast mode
 * when the chosen model supports them.
 *
 * opts: { anchor, groups:[{provider,name,note,logo,models:[{id,label,unavailable}]}],
 *   value:{provider,model}, same:{label,note}|null, footer:(value)=>({account:{options:[{value,label}],value}|null,
 *   reasoning:{options:[{value,label}],value}|null, fast:{supported,checked}|null}),
 *   onPick(value), onAccount(v), onReasoning(v), onFast(bool), onClose() }
 * The Account choice shows only when the slot's provider has more than one account.
 */
export function openModelPicker(opts = {}) {
  closeModelPicker();
  const anchor = opts.anchor;
  const phone = isPhone();
  const pop = document.createElement('div');
  pop.className = `sk-pop${phone ? ' sk-pop-phone' : ''}`;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', opts.title || 'Choose a model');
  let current = { ...(opts.value || {}) };
  let query = '';
  let active = -1;
  pop.innerHTML = `${phone ? `<div class="sk-pop-head"><span>${esc(opts.title || 'Choose a model')}</span><button type="button" class="sk-icon-btn" data-pop-close aria-label="Close">${skIcon('close')}</button></div>` : ''}
    <label class="sk-pop-q">${skIcon('search')}<input type="search" placeholder="Search models" autocomplete="off" aria-label="Search models"></label>
    <div class="sk-pop-list" role="listbox"></div>
    <div class="sk-pop-foot"></div>`;
  const list = pop.querySelector('.sk-pop-list');
  const foot = pop.querySelector('.sk-pop-foot');
  const input = pop.querySelector('input');
  const options = () => Array.from(list.querySelectorAll('.sk-opt'));
  const renderList = () => {
    const groups = filterPickerGroups(opts.groups || [], query);
    const parts = [];
    if (opts.same && !query) {
      const on = !current.provider || !current.model;
      parts.push(`<div class="sk-opt${on ? ' on' : ''}" role="option" aria-selected="${on}" data-provider="" data-model=""><span class="sk-opt-main">${esc(opts.same.label)}</span>${opts.same.note ? `<small>${esc(opts.same.note)}</small>` : ''}${on ? skIcon('check') : ''}</div>`);
    }
    for (const group of groups) {
      parts.push(`<div class="sk-grp"><span>${group.logo || ''}${esc(group.name)}</span>${group.note ? `<em>${esc(group.note)}</em>` : ''}</div>`);
      for (const item of group.models) {
        const on = current.provider === group.provider && current.model === item.id;
        parts.push(`<div class="sk-opt${on ? ' on' : ''}${item.unavailable ? ' sk-opt-off' : ''}" role="option" aria-selected="${on}" data-provider="${esc(group.provider)}" data-model="${esc(item.id)}"><span class="sk-opt-main">${esc(item.label)}${item.unavailable ? ' <small class="sk-unavail">unavailable</small>' : ''}</span>${item.unavailable && item.label !== item.id ? `<small>${esc(item.id)}</small>` : ''}${on ? skIcon('check') : ''}</div>`);
      }
    }
    if (!parts.length) parts.push('<div class="sk-pop-empty">No models match.</div>');
    list.innerHTML = parts.join('');
    active = -1;
  };
  const renderFoot = () => {
    const f = typeof opts.footer === 'function' ? opts.footer(current) : null;
    const bits = [];
    if (f?.account?.options?.length > 1) {
      const acct = f.account;
      const control = acct.options.length <= 3
        ? skSegmented({ name: 'pop-account', options: acct.options, value: acct.value, label: 'Account' })
        : `<select class="sk-select" data-pop-account aria-label="Account">${acct.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(acct.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      bits.push(`<div class="sk-pop-f"><div>Account<small>Which sign-in this job uses</small></div>${control}</div>`);
    }
    if (f?.reasoning?.options?.length) {
      bits.push(`<div class="sk-pop-f"><div>Reasoning<small>Higher thinks longer before answering</small></div>${skSegmented({ name: 'pop-reasoning', options: f.reasoning.options, value: f.reasoning.value, label: 'Reasoning' })}</div>`);
    }
    if (f?.fast?.supported) {
      bits.push(`<div class="sk-pop-f"><div>Fast mode<small>Quicker, uses your allowance faster</small></div>${skSwitch({ checked: f.fast.checked, label: 'Fast mode' })}</div>`);
    }
    foot.innerHTML = bits.join('');
    foot.hidden = !bits.length;
  };
  const pick = (el) => {
    if (!el) return;
    current = { provider: el.getAttribute('data-provider') || '', model: el.getAttribute('data-model') || '' };
    opts.onPick?.(current);
    renderList();
    renderFoot();
    if (!opts.stayOpen) closeModelPicker();
  };
  renderList();
  renderFoot();
  wireKit(pop);
  list.addEventListener('click', (event) => pick(event.target.closest('.sk-opt')));
  foot.addEventListener('sk-seg', (event) => {
    const group = event.target.closest?.('[data-seg]')?.getAttribute('data-seg');
    if (group === 'pop-account') opts.onAccount?.(event.detail.value);
    else opts.onReasoning?.(event.detail.value);
  });
  foot.addEventListener('change', (event) => {
    if (event.target.matches?.('[data-pop-account]')) opts.onAccount?.(event.target.value);
  });
  foot.addEventListener('sk-switch', (event) => opts.onFast?.(!!event.detail.checked));
  input.addEventListener('input', () => { query = input.value; renderList(); });
  pop.addEventListener('keydown', (event) => {
    const items = options();
    if (event.key === 'Escape') { event.stopPropagation(); closeModelPicker(); anchor?.focus?.(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items.forEach((item, i) => item.classList.toggle('kb', i === active));
      items[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    }
  });
  pop.querySelector('[data-pop-close]')?.addEventListener('click', () => closeModelPicker());
  let shade = null;
  if (phone) {
    shade = document.createElement('div');
    shade.className = 'sk-pop-shade';
    shade.addEventListener('click', () => closeModelPicker());
    settingsHost().appendChild(shade);
  }
  settingsHost().appendChild(pop);
  anchor?.classList.add('open');
  anchor?.setAttribute('aria-expanded', 'true');
  const place = () => {
    if (phone || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.max(300, Math.min(360, r.width + 40));
    const vh = window.innerHeight;
    const below = vh - r.bottom - 14;
    const above = r.top - 14;
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.left))}px`;
    pop.style.maxHeight = 'none';
    const natural = pop.scrollHeight;
    const goBelow = below >= Math.min(natural, 360) || below >= above;
    const maxH = Math.max(200, Math.min(460, goBelow ? below : above));
    pop.style.maxHeight = `${maxH}px`;
    const height = Math.min(natural, maxH);
    pop.style.top = goBelow ? `${r.bottom + 6}px` : `${Math.max(8, r.top - height - 6)}px`;
  };
  place();
  const onDoc = (event) => { if (!pop.contains(event.target) && !anchor?.contains(event.target)) closeModelPicker(); };
  const onScroll = (event) => { if (!pop.contains(event.target)) closeModelPicker(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeModelPicker, { once: true });
    input.focus({ preventScroll: true });
    pop.querySelector('.sk-opt.on')?.scrollIntoView?.({ block: 'nearest' });
  }, 0);
  pop.__skClose = () => {
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('scroll', onScroll, true);
    anchor?.classList.remove('open');
    anchor?.setAttribute('aria-expanded', 'false');
    shade?.remove();
    pop.remove();
    opts.onClose?.();
  };
  return { el: pop, close: closeModelPicker };
}

export function closeModelPicker() {
  document.querySelectorAll('.sk-pop').forEach((node) => (node.__skClose ? node.__skClose() : node.remove()));
}

/**
 * The single save bar. One instance lives at the bottom of the settings column;
 * pages call show(labels) / hide(). Save and Discard call the active page.
 */
export function createSaveBar(host) {
  if (!host) return null;
  let bar = host.querySelector(':scope > .sk-savebar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'sk-savebar';
    bar.id = 'settings-savebar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Unsaved changes');
    bar.hidden = true;
    bar.innerHTML = `<div class="sk-savebar-text" role="status" aria-live="polite"><b></b><span></span></div>
      <button type="button" class="sk-btn ghost" data-savebar="discard">Discard</button>
      <button type="button" class="sk-btn primary" data-savebar="save">Save</button>`;
    host.appendChild(bar);
  }
  const title = bar.querySelector('b');
  const detail = bar.querySelector('span');
  const saveBtn = bar.querySelector('[data-savebar="save"]');
  const discardBtn = bar.querySelector('[data-savebar="discard"]');
  let handlers = { save: null, discard: null };
  let busy = false;
  bar.addEventListener('click', async (event) => {
    const which = event.target.closest('[data-savebar]')?.getAttribute('data-savebar');
    if (!which || busy) return;
    const handler = handlers[which];
    if (typeof handler === 'function') await handler();
  });
  const api = {
    el: bar,
    bind(next) { handlers = { save: next?.save || null, discard: next?.discard || null }; },
    show(labels = [], note = '') {
      const s = summarizeChanges(labels);
      if (!s.title && !note) { api.hide(); return; }
      title.textContent = s.title || note;
      detail.textContent = s.title ? (note ? `${s.detail} · ${note}` : s.detail) : '';
      bar.dataset.state = 'dirty';
      bar.hidden = false;
      host.classList.add('sk-has-savebar');
    },
    hide() {
      bar.hidden = true;
      bar.dataset.state = '';
      host.classList.remove('sk-has-savebar');
    },
    busy(on, label = 'Saving…') {
      busy = !!on;
      saveBtn.disabled = busy;
      discardBtn.disabled = busy;
      saveBtn.textContent = busy ? label : 'Save';
      bar.dataset.state = busy ? 'saving' : (bar.dataset.state === 'saving' ? 'dirty' : bar.dataset.state);
    },
    error(message) {
      bar.hidden = false;
      bar.dataset.state = 'error';
      detail.textContent = message || 'Save failed. Try again.';
    },
  };
  return api;
}
