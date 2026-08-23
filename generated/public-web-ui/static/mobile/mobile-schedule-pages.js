// Schedule route owner. Loaded only when its route or a shared dependent feature is requested.
import { ICONS, escapeHtml, renderMobileHeader, wireHeaderActions } from './mobile-shell.js';
import { pmHaptic } from './mobile-model-badge.js';
import { pmToast } from './mobile-feedback.js';
import {
  deleteMobileSchedule,
  getCachedMobilePageData,
  loadMobileSchedules,
  runScheduleNow,
  toggleSchedule,
  updateMobileSchedule,
} from './mobile-api.js';

/* ---------------- SCHEDULE ---------------- */
function _mobileScheduleStatusLabel(s) {
  const status = String(s?.status || '').toLowerCase();
  if (status === 'running') return 'RUNNING';
  if (status === 'paused' || status === 'disabled' || s?.enabled === false) return 'PAUSED';
  return 'ACTIVE';
}

function scheduleCardHtml(s) {
  const statusLabel = _mobileScheduleStatusLabel(s);
  const statusClass = statusLabel.toLowerCase();
  const sessionId = String(s.sessionId || '').trim();
  const next = s.next && s.next !== '—'
    ? `<div class="pm-schedule-meta-item">${ICONS.clock}<span><small>Next</small><b>${escapeHtml(s.next)}</b></span></div>`
    : '';
  const last = s.last && s.last !== '—'
    ? `<div class="pm-schedule-meta-item">${ICONS.clock}<span><small>Last</small><b>${escapeHtml(s.last)}</b></span></div>`
    : '';
  const footLeft = s.assignedTo ? `Assigned to ${s.assignedTo}` : (s.footLeft || '');
  const footRight = s.footRight || '';
  return `
    <article class="pm-schedule-card ${sessionId ? 'pm-schedule-card-linked' : ''}" data-id="${escapeHtml(s.id)}" data-session-id="${escapeHtml(sessionId)}" data-linked-chat="${sessionId ? 'true' : 'false'}" role="button" tabindex="0" aria-label="${escapeHtml(s.name || 'Schedule')}${sessionId ? ': open scheduled task chat' : ': no chat session available'}">
      <div class="pm-schedule-card-kicker">
        <span class="pm-schedule-state ${statusClass}">${statusLabel}</span>
        ${s.builtin ? '<span class="pm-schedule-kind">BUILT-IN</span>' : ''}
        ${sessionId ? `<span class="pm-schedule-linked-label">${ICONS.chat} CHAT</span>` : '<span class="pm-schedule-no-chat-label">NO CHAT SESSION AVAILABLE</span>'}
      </div>
      <div class="pm-schedule-head">
        <span class="pm-emoji" aria-hidden="true">${escapeHtml(s.emoji || '⏰')}</span>
        <h3>${escapeHtml(s.name)}</h3>
        <button class="pm-toggle ${s.enabled ? 'on' : ''}" data-toggle aria-label="${s.enabled ? 'Pause' : 'Resume'} schedule"></button>
      </div>
      <p class="pm-schedule-desc">${escapeHtml(s.description)}</p>
      ${next || last ? `<div class="pm-schedule-meta">${next}${last}</div>` : ''}
      <div class="pm-schedule-foot">
        <span class="pm-schedule-foot-copy">
          ${footLeft ? `<strong>${escapeHtml(footLeft)}</strong>` : ''}
          ${footRight ? `<small>${escapeHtml(footRight)}</small>` : ''}
        </span>
        <button class="pm-run-btn" data-run>Run Now</button>
      </div>
    </article>
  `;
}

const MOBILE_SCHEDULE_REPEAT_OPTIONS = [
  ['manual', 'Never (manual only)'],
  ['0 * * * *', 'Every hour'],
  ['0 */3 * * *', 'Every 3 hours'],
  ['0 */6 * * *', 'Every 6 hours'],
  ['0 */8 * * *', 'Every 8 hours'],
  ['0 */12 * * *', 'Every 12 hours'],
  ['daily', 'Daily (at a specific time)'],
  ['weekday', 'Weekdays (at a specific time)'],
  ['every48', 'Every 48 hours (at a specific time)'],
  ['custom', 'Custom cron expression'],
];

function _mobileScheduleLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function _mobileScheduleRepeatState(s) {
  const cron = String(s?.cron || '').trim();
  const state = { repeat: cron || '0 * * * *', time: '09:00', pattern: cron };
  if (!cron) return state;
  const fixed = new Set(MOBILE_SCHEDULE_REPEAT_OPTIONS.map(([value]) => value));
  if (fixed.has(cron)) return state;
  const every48 = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\/2\s+\*\s+\*$/);
  if (every48) {
    state.repeat = 'every48';
    state.time = `${String(every48[2]).padStart(2, '0')}:${String(every48[1]).padStart(2, '0')}`;
    return state;
  }
  const timed = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(1-5|\*)$/);
  if (timed) {
    state.repeat = timed[3] === '1-5' ? 'weekday' : 'daily';
    state.time = `${String(timed[2]).padStart(2, '0')}:${String(timed[1]).padStart(2, '0')}`;
    return state;
  }
  state.repeat = 'custom';
  return state;
}

function _mobileSchedulePatternFromEditor(editor, item) {
  const field = name => String(editor.querySelector(`[data-field="${name}"]`)?.value || '').trim();
  const repeat = field('repeat');
  const time = field('time') || '09:00';
  const [hour, minute] = time.split(':').map(value => Number(value));
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 9;
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0;
  const daily = `${safeMinute} ${safeHour} * * *`;
  if (repeat === 'daily') return daily;
  if (repeat === 'weekday') return `${safeMinute} ${safeHour} * * 1-5`;
  if (repeat === 'every48') return `${safeMinute} ${safeHour} */2 * *`;
  if (repeat === 'custom') return field('pattern');
  if (repeat === 'manual') return String(item?.cron || '').trim() || daily;
  return repeat || daily;
}

function _mobileScheduleEditorHtml(s) {
  const raw = s.raw || {};
  const skillIds = Array.isArray(s.skillIds) ? s.skillIds.join(', ') : '';
  const ownerValue = String(s.assignedTo || raw.subagent_id || raw.subagentId || raw.team_id || '').trim();
  const repeatState = _mobileScheduleRepeatState(s);
  const optionHtml = ([value, label]) => `<option value="${escapeHtml(value)}"${value === repeatState.repeat ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return `
    <section class="pm-schedule-editor" data-schedule-editor="${escapeHtml(s.id)}">
      <label class="pm-schedule-title-field">Title<input type="text" data-field="name" value="${escapeHtml(s.name || '')}"></label>
      <label class="pm-schedule-prompt-field">Prompt<textarea data-field="prompt" rows="22" placeholder="What should happen when this schedule runs?">${escapeHtml(s.prompt || s.description || '')}</textarea></label>
      <label class="pm-schedule-skills-field">Attached skill<input type="text" data-field="skills" value="${escapeHtml(skillIds)}" placeholder="skill-id, skill-id"></label>
      <label class="pm-schedule-agent-field">Assigned agent<input type="text" data-field="subagent" value="${escapeHtml(ownerValue)}" placeholder="Main agent"></label>
      <label class="pm-schedule-repeat-field">Repeat
        <select data-field="repeat">${MOBILE_SCHEDULE_REPEAT_OPTIONS.map(optionHtml).join('')}</select>
        <span data-repeat-time-wrap><input type="time" data-field="time" value="${escapeHtml(repeatState.time)}"></span>
        <span data-repeat-custom-wrap><input type="text" data-field="pattern" value="${escapeHtml(repeatState.pattern)}" placeholder="0 9 * * *"></span>
      </label>
      <div class="pm-schedule-editor-actions">
        <button type="button" class="pm-run-btn" data-schedule-close>Cancel</button>
        <button type="button" class="pm-run-btn primary" data-schedule-save>Save Changes</button>
      </div>
    </section>
  `;
}

function _splitMobileScheduleList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function _formatMobileScheduleContextRefs(refs) {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => {
      const title = String(ref?.title || '').trim();
      const content = String(ref?.content || '').trim();
      return title && content ? `${title}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function _parseMobileScheduleContextRefs(value, item) {
  const existing = new Map((Array.isArray(item?.contextRefs) ? item.contextRefs : [])
    .map((ref) => [String(ref?.title || '').trim().toLowerCase(), ref]));
  return String(value || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^([^:\n]{1,160}):\s*([\s\S]+)$/);
      const title = (match ? match[1] : block.split(/\n/)[0]).trim();
      const content = (match ? match[2] : block.split(/\n/).slice(1).join('\n')).trim();
      if (!title || !content) return null;
      const prior = existing.get(title.toLowerCase()) || {};
      return {
        id: prior.id || `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        content,
        createdAt: prior.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    })
    .filter(Boolean);
}

function _collectMobileSchedulePayload(editor, item) {
  const field = name => String(editor.querySelector(`[data-field="${name}"]`)?.value || '').trim();
  const raw = item.raw || {};
  const name = field('name');
  const pattern = _mobileSchedulePatternFromEditor(editor, item);
  const prompt = field('prompt');
  const subagentId = field('subagent');
  const skillIds = _splitMobileScheduleList(field('skills'));
  if (!name) throw new Error('Name required');
  if (!pattern) throw new Error('Cron expression required');
  if (!prompt) throw new Error('Prompt/action required');
  return {
    name,
    pattern,
    prompt,
    timezone: _mobileScheduleLocalTimezone(),
    delivery_channel: 'web',
    confirm: true,
    ...(String(raw.team_id || '').trim() && !subagentId ? { team_id: String(raw.team_id).trim() } : {}),
    ...(!String(raw.team_id || '').trim() || subagentId ? { subagent_id: subagentId } : {}),
    skillIds,
  };
}

function _toggleMobileScheduleEditor({ body, card, item, page, navigate }) {
  if (!body || !card || !item) return;
  const open = card.nextElementSibling?.matches?.('.pm-schedule-editor');
  body.querySelectorAll('.pm-schedule-editor').forEach(el => el.remove());
  body.querySelectorAll('.pm-schedule-card.open').forEach(el => el.classList.remove('open'));
  if (open) return;
  if (item.kind !== 'cron') {
    pmToast('Built-in schedules can be toggled or run from this card.', 'info');
    return;
  }
  card.classList.add('open');
  card.insertAdjacentHTML('afterend', _mobileScheduleEditorHtml(item));
  const editor = card.nextElementSibling;
  const repeat = editor.querySelector('[data-field="repeat"]');
  const timeWrap = editor.querySelector('[data-repeat-time-wrap]');
  const customWrap = editor.querySelector('[data-repeat-custom-wrap]');
  const syncRepeatFields = () => {
    const value = repeat?.value || '';
    if (timeWrap) timeWrap.style.display = ['daily', 'weekday', 'every48'].includes(value) ? '' : 'none';
    if (customWrap) customWrap.style.display = value === 'custom' ? '' : 'none';
  };
  repeat?.addEventListener('change', syncRepeatFields);
  syncRepeatFields();
  editor.querySelector('[data-schedule-close]')?.addEventListener('click', () => {
    editor.remove();
    card.classList.remove('open');
  });
  editor.querySelector('[data-schedule-save]')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const payload = _collectMobileSchedulePayload(editor, item);
      const result = await updateMobileSchedule(item, payload);
      if (!result || result.success === false) throw new Error(result?.error || 'Save failed');
      pmToast('Schedule saved', 'success');
      await renderSchedulePage(page, { navigate });
    } catch (err) {
      pmToast(err.message || 'Save failed', 'error');
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

function _wireMobileScheduleEditor(editor, { item, navigate, onCancel } = {}) {
  if (!editor || !item) return;
  const repeat = editor.querySelector('[data-field="repeat"]');
  const timeWrap = editor.querySelector('[data-repeat-time-wrap]');
  const customWrap = editor.querySelector('[data-repeat-custom-wrap]');
  const syncRepeatFields = () => {
    const value = repeat?.value || '';
    if (timeWrap) timeWrap.style.display = ['daily', 'weekday', 'every48'].includes(value) ? '' : 'none';
    if (customWrap) customWrap.style.display = value === 'custom' ? '' : 'none';
  };
  repeat?.addEventListener('change', syncRepeatFields);
  syncRepeatFields();
  editor.querySelector('[data-schedule-close]')?.addEventListener('click', () => {
    if (typeof onCancel === 'function') onCancel();
    else navigate?.('#mobile/schedule');
  });
  editor.querySelector('[data-schedule-save]')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const payload = _collectMobileSchedulePayload(editor, item);
      const result = await updateMobileSchedule(item, payload);
      if (!result || result.success === false) throw new Error(result?.error || 'Save failed');
      pmToast('Schedule saved', 'success');
      navigate?.('#mobile/schedule');
    } catch (err) {
      pmToast(err.message || 'Save failed', 'error');
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

export async function renderScheduleEditorPage(page, { scheduleId, navigate } = {}) {
  try { page.__pmScheduleCleanup?.(); } catch {}
  _closeMobileScheduleActionPopover();
  const header = renderMobileHeader({ title: 'Edit Schedule', online: true, leftIcon: 'back' });
  page.innerHTML = `
    ${header}
    <div class="pm-body pm-schedule-editor-page" id="pm-schedule-editor-body">
      <div class="pm-card" style="text-align:center;color:var(--pm-muted);">Loading schedule…</div>
    </div>
  `;
  wireHeaderActions(page, { onBack: () => navigate?.('#mobile/schedule') });

  const body = page.querySelector('#pm-schedule-editor-body');
  let items = [];
  try {
    items = await loadMobileSchedules({ force: true });
  } catch (err) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>Couldn’t load schedule</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    return;
  }
  const item = items.find((candidate) => String(candidate?.id || '') === String(scheduleId || ''));
  if (!item) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>Schedule not found</h2><p>This schedule isn’t available right now.</p></div>`;
    return;
  }
  if (item.kind !== 'cron') {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>This schedule cannot be edited</h2><p>Built-in schedules can be toggled or run from the schedule card.</p></div>`;
    return;
  }
  body.innerHTML = _mobileScheduleEditorHtml(item);
  _wireMobileScheduleEditor(body.querySelector('[data-schedule-editor]'), {
    item,
    navigate,
    onCancel: () => navigate?.('#mobile/schedule'),
  });
}

function _closeMobileScheduleActionPopover() {
  const popover = document.getElementById('pm-schedule-action-popover');
  try { popover?._pmScheduleCleanup?.(); } catch {}
  document.getElementById('pm-schedule-action-popover-overlay')?.remove();
  popover?.remove();
  document.body?.classList.remove('pm-mobile-overlay-open');
  document.documentElement?.classList.remove('pm-schedule-context-open');
}

function _openMobileScheduleActionPopover({ item, card, body, page, navigate }) {
  if (!item || !card) return;
  _closeMobileScheduleActionPopover();

  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.id = 'pm-schedule-action-popover-overlay';
  overlay.className = 'pm-schedule-action-popover-overlay';
  overlay.setAttribute('aria-label', 'Close schedule actions');

  const popover = document.createElement('div');
  popover.id = 'pm-schedule-action-popover';
  popover.className = 'pm-schedule-action-popover';
  popover.setAttribute('role', 'menu');
  popover.setAttribute('aria-label', `${item.name || 'Schedule'} actions`);
  const isPaused = item.enabled === false || item.status === 'paused' || item.status === 'disabled';
  const actions = [
    item.kind === 'cron' ? { action: 'edit', label: 'Edit', icon: ICONS.compose } : null,
    { action: 'toggle', label: isPaused ? 'Resume' : 'Pause', icon: isPaused ? ICONS.play : ICONS.pause },
    item.kind === 'cron' ? { action: 'delete', label: 'Delete', icon: ICONS.trash, danger: true } : null,
  ].filter(Boolean);
  popover.innerHTML = actions.map((action) => `
    <button type="button" class="pm-schedule-action-row${action.danger ? ' danger' : ''}" data-schedule-action="${action.action}" role="menuitem">
      <span class="pm-schedule-action-icon">${action.icon}</span><span>${action.label}</span>
    </button>
  `).join('');

  overlay.addEventListener('click', () => _closeMobileScheduleActionPopover());
  document.body.append(overlay, popover);
  document.body.classList.add('pm-mobile-overlay-open');
  document.documentElement.classList.add('pm-schedule-context-open');

  const rect = card.getBoundingClientRect();
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const width = Math.min(236, Math.max(0, viewportWidth - 32));
  const height = 12 + actions.length * 48;
  const left = Math.max(16, Math.min(viewportWidth - width - 16, rect.left + (rect.width - width) / 2));
  const top = Math.max(14, Math.min(viewportHeight - height - 14, rect.top + (rect.height - height) / 2));
  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  const closeOnEscape = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      _closeMobileScheduleActionPopover();
    }
  };
  const closeOnScroll = () => _closeMobileScheduleActionPopover();
  window.addEventListener('keydown', closeOnEscape, true);
  window.addEventListener('scroll', closeOnScroll, true);
  popover._pmScheduleCleanup = () => {
    window.removeEventListener('keydown', closeOnEscape, true);
    window.removeEventListener('scroll', closeOnScroll, true);
  };

  popover.querySelectorAll('[data-schedule-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = button.getAttribute('data-schedule-action');
      pmHaptic?.(10);
      if (action === 'edit') {
        _closeMobileScheduleActionPopover();
        navigate?.(`#mobile/schedule/edit/${encodeURIComponent(item.id)}`);
        return;
      }
      if (action === 'toggle') {
        button.disabled = true;
        _closeMobileScheduleActionPopover();
        try {
          const next = isPaused;
          const result = await toggleSchedule(item, next);
          if (!result || result.success === false) throw new Error(result?.error || 'Update failed');
          pmToast(`${item.name}: ${next ? 'resumed' : 'paused'}`, 'success');
          await renderSchedulePage(page, { revalidate: false, navigate });
        } catch (err) {
          pmToast(err.message || 'Update failed', 'error');
        }
        return;
      }
      if (action === 'delete') {
        _closeMobileScheduleActionPopover();
        if (!window.confirm(`Delete “${item.name || 'this schedule'}”?`)) return;
        try {
          const result = await deleteMobileSchedule(item);
          if (!result || result.success === false) throw new Error(result?.error || 'Delete failed');
          pmToast('Schedule deleted', 'success');
          await renderSchedulePage(page, { revalidate: false, navigate });
        } catch (err) {
          pmToast(err.message || 'Delete failed', 'error');
        }
      }
    });
  });
}

function scheduleSkeletonHtml() {
  const block = `
    <article class="pm-schedule-card" style="opacity:.6">
      <div class="pm-schedule-head">
        <span class="pm-emoji" style="background:rgba(0,0,0,.06);width:24px;height:24px;border-radius:6px;"></span>
        <h3 style="background:rgba(0,0,0,.06);color:transparent;border-radius:6px;height:18px;">loading…</h3>
        <button class="pm-toggle" aria-hidden="true"></button>
      </div>
      <p class="pm-schedule-desc" style="background:rgba(0,0,0,.04);color:transparent;border-radius:6px;height:32px;">.</p>
      <div class="pm-kv-grid"><div class="pm-kv">${ICONS.clock} Next: <b>…</b></div><div class="pm-kv">${ICONS.clock} Last: <b>…</b></div></div>
    </article>`;
  return block.repeat(3);
}

export async function renderSchedulePage(page, { revalidate = true, navigate } = {}) {
  try { page.__pmScheduleCleanup?.(); } catch {}
  _closeMobileScheduleActionPopover();
  const initialExtras = `
    <span class="pm-spacer"></span>
    <span class="pm-count-pill" id="pm-sched-count">…</span>
    <button class="pm-cta" aria-label="New schedule">${ICONS.plus} New Schedule</button>
  `;
  const header = renderMobileHeader({ title: 'Schedule', online: true, extras: initialExtras });
  page.innerHTML = `
    ${header}
    <div class="pm-body" id="pm-sched-body">${scheduleSkeletonHtml()}</div>
  `;
  wireHeaderActions(page, {});

  const body = page.querySelector('#pm-sched-body');
  const count = page.querySelector('#pm-sched-count');
  let byId = new Map();

  let longPressTimer = null;
  let longPressCard = null;
  let longPressItem = null;
  let longPressStartX = 0;
  let longPressStartY = 0;
  let longPressFired = false;
  const clearLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    document.documentElement.classList.remove('pm-schedule-long-press-pending');
  };
  const itemForCard = (card) => byId?.get(card?.getAttribute('data-id')) || null;
  const openScheduleChat = (item) => {
    const sessionId = String(item?.sessionId || '').trim();
    if (!sessionId) {
      pmToast('No chat session available for this schedule.', 'info');
      return;
    }
    navigate?.(`#mobile/chat/${encodeURIComponent(sessionId)}`);
  };
  const onSchedulePointerDown = (event) => {
    const card = event.target?.closest?.('.pm-schedule-card');
    if (!card || !body.contains(card) || event.target?.closest?.('button, input, select, textarea')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearLongPress();
    longPressCard = card;
    longPressItem = itemForCard(card);
    if (!longPressItem) {
      longPressCard = null;
      return;
    }
    longPressStartX = Number(event.clientX || 0);
    longPressStartY = Number(event.clientY || 0);
    longPressFired = false;
    document.documentElement.classList.add('pm-schedule-long-press-pending');
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!longPressCard || !longPressItem) return;
      longPressFired = true;
      pmHaptic?.(18);
      try { navigator.vibrate?.(12); } catch {}
      try { window.getSelection?.()?.removeAllRanges(); } catch {}
      document.documentElement.classList.remove('pm-schedule-long-press-pending');
      longPressCard.classList.add('pm-schedule-long-pressed');
      setTimeout(() => longPressCard?.classList.remove('pm-schedule-long-pressed'), 260);
      _openMobileScheduleActionPopover({ item: longPressItem, card: longPressCard, body, page, navigate });
    }, 480);
  };
  const onSchedulePointerMove = (event) => {
    if (!longPressTimer) return;
    if (Math.abs(Number(event.clientX || 0) - longPressStartX) > 10 || Math.abs(Number(event.clientY || 0) - longPressStartY) > 10) {
      clearLongPress();
      longPressCard = null;
      longPressItem = null;
    }
  };
  const onSchedulePointerUp = () => {
    clearLongPress();
  };
  const onScheduleContextMenu = (event) => {
    if (event.target?.closest?.('.pm-schedule-card')) event.preventDefault();
  };
  const onScheduleClick = (event) => {
    const card = event.target?.closest?.('.pm-schedule-card');
    if (!card || !body.contains(card)) return;
    if (event.target?.closest?.('button, input, select, textarea')) return;
    if (longPressFired && longPressCard === card) {
      event.preventDefault();
      event.stopImmediatePropagation();
      longPressFired = false;
      longPressCard = null;
      longPressItem = null;
      return;
    }
    openScheduleChat(itemForCard(card));
  };
  const cleanup = () => {
    clearLongPress();
    longPressCard = null;
    longPressItem = null;
    _closeMobileScheduleActionPopover();
    body.removeEventListener('pointerdown', onSchedulePointerDown);
    body.removeEventListener('pointermove', onSchedulePointerMove);
    body.removeEventListener('pointerup', onSchedulePointerUp);
    body.removeEventListener('pointercancel', onSchedulePointerUp);
    body.removeEventListener('contextmenu', onScheduleContextMenu, true);
    body.removeEventListener('click', onScheduleClick, true);
    if (page.__pmScheduleCleanup === cleanup) page.__pmScheduleCleanup = null;
    if (window.__pmMobileCleanup === cleanup) window.__pmMobileCleanup = null;
  };
  page.__pmScheduleCleanup = cleanup;
  window.__pmMobileCleanup = cleanup;
  body.addEventListener('pointerdown', onSchedulePointerDown);
  body.addEventListener('pointermove', onSchedulePointerMove);
  body.addEventListener('pointerup', onSchedulePointerUp);
  body.addEventListener('pointercancel', onSchedulePointerUp);
  body.addEventListener('contextmenu', onScheduleContextMenu, true);
  body.addEventListener('click', onScheduleClick, true);

  const cachedSchedules = getCachedMobilePageData('schedules', 21_600_000);
  let items = [];
  try {
    items = await loadMobileSchedules();
  } catch (err) {
    console.error('[mobile] schedules load failed', err);
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>Couldn’t load schedules</h2><p>${escapeHtml(err.message || 'Network error')}</p></div>`;
    count.textContent = '0 schedules';
    return;
  }

  if (revalidate && Array.isArray(cachedSchedules)) {
    loadMobileSchedules({ force: true }).then((fresh) => {
      if (!page?.isConnected || JSON.stringify(fresh) === JSON.stringify(items)) return;
      renderSchedulePage(page, { revalidate: false, navigate });
    }).catch(() => {});
  }

  if (!items.length) {
    body.innerHTML = `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>No schedules yet</h2><p>Tap “+ New Schedule” to create your first one.</p></div>`;
    count.textContent = '0 schedules';
    return;
  }

  count.textContent = `${items.length} schedule${items.length === 1 ? '' : 's'}`;
  body.innerHTML = items.map(scheduleCardHtml).join('');

  // Wire toggles + run buttons. Map by id back to the item.
  byId = new Map(items.map(it => [it.id, it]));
  body.querySelectorAll('.pm-schedule-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const item = byId.get(id);
    if (!item) return;

    const toggle = card.querySelector('[data-toggle]');
    if (toggle) {
      toggle.addEventListener('click', async (event) => {
        event.stopPropagation();
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.disabled = true;
        try {
          const r = await toggleSchedule(item, next);
          if (!r || r.success === false) throw new Error(r?.error || 'Update failed');
          item.enabled = next;
          toggle.setAttribute('aria-label', `${next ? 'Pause' : 'Resume'} schedule`);
          pmToast(`${item.name}: ${next ? 'enabled' : 'paused'}`, 'success');
        } catch (err) {
          toggle.classList.toggle('on', !next);
          pmToast(err.message || 'Update failed', 'error');
        } finally {
          toggle.disabled = false;
        }
      });
    }

    const runBtn = card.querySelector('[data-run]');
    if (runBtn) {
      runBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const prev = runBtn.textContent;
        runBtn.textContent = 'Running…';
        runBtn.disabled = true;
        try {
          const r = await runScheduleNow(item);
          if (!r || r.success === false) throw new Error(r?.error || 'Run failed');
          pmToast(`${item.name} triggered`, 'success');
        } catch (err) {
          pmToast(err.message || 'Run failed', 'error');
        } finally {
          runBtn.textContent = prev;
          runBtn.disabled = false;
        }
      });
    }

    card.addEventListener('keydown', (event) => {
      if (event.target?.closest?.('button, input, select, textarea')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openScheduleChat(item);
      }
    });
  });
}
