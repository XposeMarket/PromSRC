import { errorState, escapeHtml, loading } from '../../ui/page-kit.js';
import { ICONS } from '../../ui/icons.js';
import { mobileV2Haptic } from '../../ui/haptics.js';

const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

const REPEAT_OPTIONS = [
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

function scheduleStatus(item = {}) {
  const status = String(item.status || '').toLowerCase();
  if (status === 'running') return { label: 'RUNNING', className: 'running' };
  if (item.enabled === false || status === 'paused' || status === 'disabled') return { label: 'PAUSED', className: 'paused' };
  return { label: 'ACTIVE', className: 'active' };
}

function formatScheduleTime(value) {
  if (!value || value === '—') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function repeatState(item = {}) {
  const cron = String(item.pattern || item.schedule || item.cron || '').trim();
  const state = { repeat: cron || '0 * * * *', time: '09:00', pattern: cron };
  if (!cron) return state;
  const optionValues = new Set(REPEAT_OPTIONS.map(([value]) => value));
  if (optionValues.has(cron)) return state;
  const interval = cron.match(/^0\s+\*\/(3|6|8|12)\s+\*\s+\*\s+\*$/);
  if (interval) {
    state.repeat = `0 */${interval[1]} * * *`;
    return state;
  }
  const hourly = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(1-5|\*)$/);
  if (hourly) {
    state.repeat = hourly[3] === '1-5' ? 'weekday' : 'daily';
    state.time = `${String(hourly[2]).padStart(2, '0')}:${String(hourly[1]).padStart(2, '0')}`;
    return state;
  }
  const every48 = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\/2\s+\*\s+\*$/);
  if (every48) {
    state.repeat = 'every48';
    state.time = `${String(every48[2]).padStart(2, '0')}:${String(every48[1]).padStart(2, '0')}`;
    return state;
  }
  state.repeat = 'custom';
  return state;
}

function splitList(value) {
  return String(value || '').split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
}

function scheduleHeader({ title = 'Schedule', subtitle = '', count = '', editor = false } = {}) {
  const actions = editor
    ? ''
    : `<span class="pm-count-pill" data-schedule-count>${escapeHtml(count)}</span>
      <button type="button" class="pm-cta" data-new-schedule>${ICONS.plus} New Schedule</button>`;
  return `<div class="pm-v2-page-heading pm-schedule-page-heading">
    <div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
    <div class="pm-v2-heading-actions">${actions}</div>
  </div>`;
}

function scheduleCard(item) {
  const state = scheduleStatus(item);
  const sessionId = String(item.sessionId || '').trim();
  const description = String(item.description || item.prompt || item.summary || item.raw?.description || '').trim();
  const next = formatScheduleTime(item.next || item.nextRun || item.nextExecutionAt);
  const last = formatScheduleTime(item.last || item.lastRun || item.lastRunAt);
  const assigned = String(item.assignedTo || item.subagent_id || item.subagentId || '').trim();
  const footLeft = assigned ? `Assigned to ${assigned}` : String(item.footLeft || '');
  const footRight = String(item.footRight || '');
  return `<article class="pm-schedule-card${sessionId ? ' pm-schedule-card-linked' : ''}" data-schedule-card="${escapeHtml(item.id)}" data-session-id="${escapeHtml(sessionId)}" role="button" tabindex="0" aria-label="${escapeHtml(item.name || 'Schedule')}${sessionId ? ': open scheduled task chat' : ': no chat session available'}">
    <div class="pm-schedule-card-kicker">
      <span class="pm-schedule-state ${state.className}">${state.label}</span>
      ${item.kind === 'brain' ? '<span class="pm-schedule-kind">BUILT-IN</span>' : ''}
      ${sessionId ? `<span class="pm-schedule-linked-label">${ICONS.chat} CHAT</span>` : '<span class="pm-schedule-no-chat-label">NO CHAT SESSION AVAILABLE</span>'}
    </div>
    <div class="pm-schedule-head">
      <span class="pm-emoji" aria-hidden="true">${escapeHtml(item.emoji || (item.kind === 'brain' ? '✦' : '⏰'))}</span>
      <h3>${escapeHtml(item.name || 'Untitled schedule')}</h3>
      <button type="button" class="pm-toggle${item.enabled ? ' on' : ''}" data-schedule-toggle="${escapeHtml(item.id)}" role="switch" aria-checked="${item.enabled ? 'true' : 'false'}" aria-label="${item.enabled ? 'Pause' : 'Resume'} schedule"></button>
    </div>
    <p class="pm-schedule-desc">${escapeHtml(description)}</p>
    ${next || last ? `<div class="pm-schedule-meta">
      ${next && next !== '—' ? `<div class="pm-schedule-meta-item">${ICONS.clock}<span><small>Next</small><b>${escapeHtml(next)}</b></span></div>` : ''}
      ${last && last !== '—' ? `<div class="pm-schedule-meta-item">${ICONS.clock}<span><small>Last</small><b>${escapeHtml(last)}</b></span></div>` : ''}
    </div>` : ''}
    <div class="pm-schedule-foot">
      <span class="pm-schedule-foot-copy">
        ${footLeft ? `<strong>${escapeHtml(footLeft)}</strong>` : ''}
        ${footRight ? `<small>${escapeHtml(footRight)}</small>` : ''}
      </span>
      <button type="button" class="pm-run-btn" data-schedule-run="${escapeHtml(item.id)}">Run Now</button>
    </div>
  </article>`;
}

function editorHtml(item) {
  const raw = item?.raw || {};
  const currentPattern = String(item?.pattern || item?.schedule || item?.cron || '0 * * * *');
  const initial = repeatState({ ...item, pattern: currentPattern });
  const owner = String(item?.assignedTo || item?.subagent_id || item?.subagentId || item?.team_id || raw.subagent_id || raw.subagentId || raw.team_id || '').trim();
  const skillIds = Array.isArray(item?.skillIds) ? item.skillIds.join(', ') : Array.isArray(raw.skillIds) ? raw.skillIds.join(', ') : '';
  return `<section class="pm-schedule-editor" data-schedule-form>
    <label class="pm-schedule-title-field">Title<input type="text" name="name" value="${escapeHtml(item?.name || '')}" required></label>
    <label class="pm-schedule-prompt-field">Prompt<textarea name="prompt" rows="22" placeholder="What should happen when this schedule runs?" required>${escapeHtml(item?.prompt || item?.description || raw.prompt || '')}</textarea></label>
    <label class="pm-schedule-skills-field">Attached skill<input type="text" name="skills" value="${escapeHtml(skillIds)}" placeholder="skill-id, skill-id"></label>
    <label class="pm-schedule-agent-field">Assigned agent<input type="text" name="assignedTo" value="${escapeHtml(owner)}" placeholder="Main agent"></label>
    <label class="pm-schedule-repeat-field">Repeat
      <select name="repeat">${REPEAT_OPTIONS.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === initial.repeat ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      <span data-repeat-time-wrap><input type="time" name="time" value="${escapeHtml(initial.time)}" aria-label="Run time"></span>
      <span data-repeat-custom-wrap><input type="text" name="pattern" value="${escapeHtml(initial.pattern)}" placeholder="0 9 * * 1-5" aria-label="Cron expression"></span>
    </label>
    <div class="pm-schedule-editor-actions">
      <button type="button" class="pm-run-btn" data-schedule-back>Cancel</button>
      <button type="submit" class="pm-run-btn primary" data-schedule-save>${item?.id ? 'Save Changes' : 'Create Schedule'}</button>
    </div>
  </section>`;
}

function cronFromForm(form, item) {
  const repeat = String(form.elements.repeat?.value || 'daily');
  const time = String(form.elements.time?.value || '09:00');
  const [rawHour, rawMinute] = time.split(':').map(Number);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  const daily = `${minute} ${hour} * * *`;
  if (repeat === 'daily') return daily;
  if (repeat === 'weekday') return `${minute} ${hour} * * 1-5`;
  if (repeat === 'every48') return `${minute} ${hour} */2 * *`;
  if (repeat === 'custom') return String(form.elements.pattern?.value || '').trim();
  if (repeat === 'manual') return String(item?.pattern || item?.schedule || item?.cron || '').trim() || daily;
  return repeat;
}

function pageSkeleton() {
  return `<div class="pm-v2-schedule-skeleton">${Array.from({ length: 3 }, () => `<article class="pm-schedule-card" aria-hidden="true"><div class="pm-schedule-head"><span class="pm-emoji">⏰</span><h3>Loading schedule…</h3></div><p class="pm-schedule-desc">Automations and routines will appear here.</p><div class="pm-schedule-meta"><span>Loading…</span><span>Loading…</span></div></article>`).join('')}</div>`;
}

function closeScheduleActionPopover() {
  const popover = document.getElementById('pm-schedule-action-popover');
  try { popover?._pmScheduleCleanup?.(); } catch {}
  document.getElementById('pm-schedule-action-popover-overlay')?.remove();
  popover?.remove();
  document.body?.classList.remove('pm-mobile-overlay-open');
  document.documentElement?.classList.remove('pm-schedule-context-open');
}

function openScheduleActionPopover({ item, card, features, shell, route, refresh }) {
  if (!item || !card) return;
  closeScheduleActionPopover();

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
  const isPaused = item.enabled === false || ['paused', 'disabled'].includes(String(item.status || '').toLowerCase());
  const actions = [
    item.kind === 'cron' ? { action: 'edit', label: 'Edit', icon: ICONS.compose } : null,
    { action: 'toggle', label: isPaused ? 'Resume' : 'Pause', icon: isPaused ? ICONS.play : PAUSE_ICON },
    item.kind === 'cron' ? { action: 'delete', label: 'Delete', icon: ICONS.trash, danger: true } : null,
  ].filter(Boolean);
  popover.innerHTML = actions.map((action) => `
    <button type="button" class="pm-schedule-action-row${action.danger ? ' danger' : ''}" data-schedule-action="${action.action}" role="menuitem">
      <span class="pm-schedule-action-icon">${action.icon}</span><span>${action.label}</span>
    </button>
  `).join('');

  overlay.addEventListener('click', closeScheduleActionPopover);
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
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeScheduleActionPopover();
  };
  const closeOnScroll = () => closeScheduleActionPopover();
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
      const action = button.dataset.scheduleAction;
      mobileV2Haptic(10);
      if (action === 'edit') {
        closeScheduleActionPopover();
        shell.navigate?.(`schedule/${encodeURIComponent(item.id)}`);
        return;
      }
      if (action === 'toggle') {
        button.disabled = true;
        closeScheduleActionPopover();
        try {
          const next = isPaused;
          const result = await features.toggleSchedule(item, next);
          if (!result || result.success === false) throw new Error(result?.error || 'Update failed');
          item.enabled = next;
          shell.showNotice(`${item.name}: ${next ? 'resumed' : 'paused'}`);
          if (route?.id) shell.navigate?.('schedule');
          else await refresh?.();
        } catch (error) {
          shell.showNotice(error?.message || 'Update failed.');
        }
        return;
      }
      if (action === 'delete') {
        closeScheduleActionPopover();
        if (!window.confirm(`Delete “${item.name || 'this schedule'}”?`)) return;
        try {
          const result = await features.deleteSchedule(item);
          if (!result || result.success === false) throw new Error(result?.error || 'Delete failed');
          shell.showNotice('Schedule deleted');
          if (route?.id) shell.navigate?.('schedule');
          else await refresh?.();
        } catch (error) {
          shell.showNotice(error?.message || 'Delete failed.');
        }
      }
    });
  });
}

export async function mountSchedulePage({ shell, features, route }) {
  shell.setActiveTab('chat');
  shell.setTitle('Schedule');
  const page = shell.page;
  let disposed = false;
  let rows = [];

  function backToList() {
    if (route?.id) shell.navigate?.('schedule');
    else list();
  }

  async function list() {
    try { page.__pmScheduleListCleanup?.(); } catch {}
    page.__pmScheduleListCleanup = null;
    page.innerHTML = `${scheduleHeader({ count: '…' })}${pageSkeleton()}`;
    page.querySelector('[data-new-schedule]')?.addEventListener('click', () => editor(null));
    try {
      rows = await features.schedules();
      if (disposed) return;
      page.innerHTML = `${scheduleHeader({ count: `${rows.length} schedule${rows.length === 1 ? '' : 's'}` })}${rows.length
        ? `<div class="pm-schedule-list">${rows.map(scheduleCard).join('')}</div>`
        : `<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>No schedules yet</h2><p>Tap “+ New Schedule” to create your first one.</p></div>`}`;
      page.querySelector('[data-new-schedule]')?.addEventListener('click', () => editor(null));
      page.querySelectorAll('[data-schedule-toggle]').forEach((button) => button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const item = rows.find((row) => String(row.id) === button.dataset.scheduleToggle);
        if (!item) return;
        const next = !item.enabled;
        button.disabled = true;
        button.classList.toggle('on', next);
        button.setAttribute('aria-checked', next ? 'true' : 'false');
        button.setAttribute('aria-label', `${next ? 'Pause' : 'Resume'} schedule`);
        try {
          await features.toggleSchedule(item, next);
          item.enabled = next;
          shell.showNotice(`${item.name}: ${next ? 'enabled' : 'paused'}`);
          list();
        } catch (error) {
          button.classList.toggle('on', !next);
          button.setAttribute('aria-checked', !next ? 'true' : 'false');
          button.setAttribute('aria-label', `${!next ? 'Pause' : 'Resume'} schedule`);
          shell.showNotice(error?.message || 'Update failed.');
        } finally {
          button.disabled = false;
        }
      }));
      page.querySelectorAll('[data-schedule-run]').forEach((button) => button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const item = rows.find((row) => String(row.id) === button.dataset.scheduleRun);
        if (!item) return;
        const previous = button.textContent;
        button.disabled = true;
        button.textContent = 'Running…';
        try {
          await features.runSchedule(item);
          shell.showNotice(`${item.name} triggered`);
        } catch (error) {
          shell.showNotice(error?.message || 'Run failed.');
        } finally {
          button.disabled = false;
          button.textContent = previous;
        }
      }));
      let longPressTimer = null;
      let longPressCard = null;
      let longPressItem = null;
      let longPressStartX = 0;
      let longPressStartY = 0;
      let longPressFired = false;
      const body = page.querySelector('.pm-schedule-list');
      const clearLongPress = () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
        document.documentElement.classList.remove('pm-schedule-long-press-pending');
      };
      const itemForCard = (card) => rows.find((row) => String(row.id) === String(card?.dataset.scheduleCard || '')) || null;
      const onSchedulePointerDown = (event) => {
        const card = event.target?.closest?.('[data-schedule-card]');
        if (!card || !body?.contains(card) || event.target?.closest?.('button, input, select, textarea')) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        clearLongPress();
        longPressCard = card;
        longPressItem = itemForCard(card);
        longPressFired = false;
        if (!longPressItem) { longPressCard = null; return; }
        longPressStartX = Number(event.clientX || 0);
        longPressStartY = Number(event.clientY || 0);
        document.documentElement.classList.add('pm-schedule-long-press-pending');
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (!longPressCard || !longPressItem) return;
          longPressFired = true;
          mobileV2Haptic(18);
          try { window.getSelection?.()?.removeAllRanges(); } catch {}
          document.documentElement.classList.remove('pm-schedule-long-press-pending');
          const pressedCard = longPressCard;
          pressedCard.classList.add('pm-schedule-long-pressed');
          setTimeout(() => pressedCard.classList.remove('pm-schedule-long-pressed'), 260);
          openScheduleActionPopover({ item: longPressItem, card: pressedCard, features, shell, route, refresh: list });
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
      const onSchedulePointerUp = () => clearLongPress();
      const onScheduleContextMenu = (event) => {
        if (event.target?.closest?.('[data-schedule-card]')) event.preventDefault();
      };
      const onScheduleClick = (event) => {
        const card = event.target?.closest?.('[data-schedule-card]');
        if (!card || !body?.contains(card) || !longPressFired || longPressCard !== card) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        longPressFired = false;
        longPressCard = null;
        longPressItem = null;
      };
      body?.addEventListener('pointerdown', onSchedulePointerDown);
      body?.addEventListener('pointermove', onSchedulePointerMove);
      body?.addEventListener('pointerup', onSchedulePointerUp);
      body?.addEventListener('pointercancel', onSchedulePointerUp);
      body?.addEventListener('contextmenu', onScheduleContextMenu, true);
      body?.addEventListener('click', onScheduleClick, true);
      page.__pmScheduleListCleanup = () => {
        clearLongPress();
        longPressCard = null;
        longPressItem = null;
        closeScheduleActionPopover();
        body?.removeEventListener('pointerdown', onSchedulePointerDown);
        body?.removeEventListener('pointermove', onSchedulePointerMove);
        body?.removeEventListener('pointerup', onSchedulePointerUp);
        body?.removeEventListener('pointercancel', onSchedulePointerUp);
        body?.removeEventListener('contextmenu', onScheduleContextMenu, true);
        body?.removeEventListener('click', onScheduleClick, true);
      };
      page.querySelectorAll('[data-schedule-card]').forEach((card) => {
        const openChat = () => {
          const sessionId = String(card.dataset.sessionId || '').trim();
          if (sessionId) { shell.navigate?.(`chat/${encodeURIComponent(sessionId)}`); return; }
          // A schedule with no linked chat session previously dead-ended on a
          // notice, leaving the editor reachable only through a 480ms
          // long-press. Fall back to opening the editor so every card has a
          // working tap target.
          const scheduleId = String(card.dataset.scheduleCard || '').trim();
          const item = rows.find((row) => String(row.id) === scheduleId);
          if (item) editor(item);
          else shell.showNotice('No chat session available for this schedule.');
        };
        card.addEventListener('click', (event) => {
          if (event.target.closest('button, input, select, textarea')) return;
          openChat();
        });
        card.addEventListener('keydown', (event) => {
          if (event.target.closest('button, input, select, textarea')) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openChat(); }
        });
      });
    } catch (error) {
      if (disposed) return;
      page.innerHTML = `${scheduleHeader({ count: '0 schedules' })}${errorState(error)}`;
      page.querySelector('[data-new-schedule]')?.addEventListener('click', () => editor(null));
      page.querySelector('[data-v2-retry]')?.addEventListener('click', list);
    }
  }

  async function editor(item) {
    if (disposed) return;
    try { page.__pmScheduleListCleanup?.(); } catch {}
    page.__pmScheduleListCleanup = null;
    if (item?.kind === 'brain') {
      page.innerHTML = `${scheduleHeader({ title: item.name, subtitle: 'Built-in Brain routine', editor: true })}<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>This schedule cannot be edited</h2><p>Built-in schedules can be paused, resumed, or run from their card.</p></div>`;
      page.querySelector('[data-schedule-back]')?.addEventListener('click', backToList);
      return;
    }
    const isNew = !item;
    const current = item || { kind: 'cron', name: '', enabled: true, pattern: '0 * * * *' };
    page.innerHTML = `${scheduleHeader({ title: isNew ? 'New Schedule' : 'Edit Schedule', editor: true })}${editorHtml(current)}`;
    page.querySelector('[data-schedule-back]')?.addEventListener('click', backToList);
    const form = page.querySelector('[data-schedule-form]');
    const repeat = form?.elements.repeat;
    const timeWrap = form?.querySelector('[data-repeat-time-wrap]');
    const customWrap = form?.querySelector('[data-repeat-custom-wrap]');
    const syncRepeatFields = () => {
      const value = String(repeat?.value || '');
      if (timeWrap) timeWrap.style.display = ['daily', 'weekday', 'every48'].includes(value) ? '' : 'none';
      if (customWrap) customWrap.style.display = value === 'custom' ? '' : 'none';
    };
    repeat?.addEventListener('change', syncRepeatFields);
    syncRepeatFields();
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[data-schedule-save]');
      const payload = new FormData(form);
      const name = String(payload.get('name') || '').trim();
      const prompt = String(payload.get('prompt') || '').trim();
      const pattern = cronFromForm(form, current);
      const assignedTo = String(payload.get('assignedTo') || '').trim();
      if (!name || !prompt || !pattern) {
        shell.showNotice(!name ? 'Name required' : !prompt ? 'Prompt/action required' : 'Cron expression required');
        return;
      }
      const raw = current.raw || {};
      const teamId = String(current.team_id || raw.team_id || '').trim();
      const timezone = String(payload.get('timezone') || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const fields = {
        name,
        prompt,
        pattern,
        timezone,
        delivery_channel: 'web',
      enabled: current.enabled !== false && !['paused', 'disabled'].includes(String(current.status || '').toLowerCase()),
        skillIds: splitList(payload.get('skills')),
        confirm: true,
        ...(teamId && (!assignedTo || assignedTo === teamId) ? { team_id: teamId } : {}),
        ...(!teamId || assignedTo !== teamId ? { subagent_id: assignedTo } : {}),
      };
      if (button) { button.disabled = true; button.textContent = 'Saving…'; }
      try {
        if (isNew) await features.createSchedule(fields);
        else await features.updateSchedule(current, fields);
        shell.showNotice(isNew ? 'Schedule created' : 'Schedule saved');
        if (route?.id) shell.navigate?.('schedule');
        else list();
      } catch (error) {
        shell.showNotice(error?.message || 'Schedule save failed.');
        if (button) { button.disabled = false; button.textContent = isNew ? 'Create Schedule' : 'Save Changes'; }
      }
    });
  }

  if (route?.id) {
    page.innerHTML = `${scheduleHeader({ title: 'Schedule', subtitle: 'Loading schedule details', editor: true })}${loading('Loading schedule…')}`;
    page.querySelector('[data-schedule-back]')?.addEventListener('click', backToList);
    try {
      rows = await features.schedules();
      if (!disposed) {
        const item = rows.find((row) => String(row.id) === String(route.id));
        if (item) editor(item);
        else {
          page.innerHTML = `${scheduleHeader({ title: 'Schedule not found', subtitle: '', editor: true })}<div class="pm-empty"><div class="pm-empty-icon">${ICONS.calendar}</div><h2>This schedule isn’t available</h2><p>It may have been removed or belongs to another gateway.</p></div>`;
          page.querySelector('[data-schedule-back]')?.addEventListener('click', backToList);
        }
      }
    } catch (error) {
      if (!disposed) {
        page.innerHTML = `${scheduleHeader({ title: 'Schedule', subtitle: '', editor: true })}${errorState(error)}`;
        page.querySelector('[data-schedule-back]')?.addEventListener('click', backToList);
        page.querySelector('[data-v2-retry]')?.addEventListener('click', () => shell.navigate?.(`schedule/${encodeURIComponent(route.id)}`));
      }
    }
  } else {
    list();
  }
  return () => {
    disposed = true;
    try { page.__pmScheduleListCleanup?.(); } catch {}
    if (page.__pmScheduleListCleanup) page.__pmScheduleListCleanup = null;
    closeScheduleActionPopover();
  };
}
