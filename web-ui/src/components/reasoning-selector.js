// Shared reasoning selector markup and pointer/keyboard behavior.
// The mobile model sheet adds its native haptic gesture surface around the
// same markup; desktop subagent chat uses the interaction helper directly.

import {
  reasoningSelectorOptions,
  formatReasoningSelectorLabel,
} from '../reasoning-capabilities.js';
import { formatModelDisplayName } from '../model-display.js';

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function safeId(value, fallback = 'reasoning') {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return id || fallback;
}

export function renderReasoningSelector({
  provider = '',
  model = '',
  effort = '',
  selectorId = 'reasoning-selector',
  controlId = 'pm-reasoning-control',
  liveLabelId = 'pm-reasoning-live-label',
  advancedId = 'pm-reasoning-advanced',
  includeAdvanced = false,
  advancedLabel = 'Advanced',
  advancedAriaLabel = 'Open Advanced model, provider, speed, and reasoning controls',
  className = '',
} = {}) {
  const options = reasoningSelectorOptions(provider, model);
  const current = String(effort || '').trim().toLowerCase();
  const selectedIndex = Math.max(0, options ? Math.max(0, options.indexOf(current)) : 0);
  const selectedProgress = options && options.length > 1 ? selectedIndex / (options.length - 1) : 0;
  const selectedFillWidth = options && options.length
    ? ((1 / options.length) + selectedProgress * ((options.length - 1) / options.length)) * 100
    : 0;
  const modelName = model ? formatModelDisplayName(model, provider) : 'Default model';
  const effortName = options ? formatReasoningSelectorLabel(options[selectedIndex], provider) : 'Default';
  const rootId = safeId(selectorId);
  const safeControlId = safeId(controlId, `${rootId}-control`);
  const safeLiveLabelId = safeId(liveLabelId, `${rootId}-live-label`);
  const safeAdvancedId = safeId(advancedId, `${rootId}-advanced`);
  const slider = options ? `
    <div class="pm-reasoning-control" id="${esc(safeControlId)}" style="--pm-reasoning-index:${selectedIndex};--pm-reasoning-progress:${selectedProgress};--pm-reasoning-fill-width:${selectedFillWidth}%;--pm-reasoning-steps:${Math.max(1, options.length - 1)}" role="slider" tabindex="0" aria-label="Reasoning level" aria-valuemin="0" aria-valuemax="${options.length - 1}" aria-valuenow="${selectedIndex}" aria-valuetext="${esc(effortName)}">
      <div class="pm-reasoning-track" aria-hidden="true">
        <div class="pm-reasoning-fill"></div>
        ${options.map((value, index) => `<button type="button" class="pm-reasoning-segment ${index === selectedIndex ? 'is-active ' : ''}${index <= selectedIndex ? 'is-filled' : ''}" data-index="${index}" data-value="${esc(value)}" aria-label="${esc(formatReasoningSelectorLabel(value, provider))}"><span>${esc(formatReasoningSelectorLabel(value, provider))}</span></button>`).join('')}
      </div>
    </div>` : `<div class="pm-msheet-empty pm-reasoning-unavailable">No adjustable reasoning levels for ${esc(modelName)}.</div>`;

  return `<div class="pm-reasoning-selector ${esc(className)}" id="${esc(rootId)}" data-reasoning-selector role="group" aria-label="Reasoning controls">
    <div class="pm-reasoning-summary" aria-live="polite">
      <strong>${esc(modelName)}</strong><span aria-hidden="true">·</span><span id="${esc(safeLiveLabelId)}">${esc(effortName)}</span>
    </div>
    ${includeAdvanced ? `<button type="button" class="pm-reasoning-advanced" id="${esc(safeAdvancedId)}" aria-label="${esc(advancedAriaLabel)}"><span>${esc(advancedLabel)}</span><span aria-hidden="true">›</span></button>` : ''}
    ${slider}
  </div>`;
}

export function wireReasoningSelector(root, { onChange } = {}) {
  const selector = root?.matches?.('[data-reasoning-selector]')
    ? root
    : root?.querySelector?.('[data-reasoning-selector]');
  const control = selector?.querySelector?.('.pm-reasoning-control');
  if (!selector || !control) return () => {};
  const segments = Array.from(control.querySelectorAll('.pm-reasoning-segment'));
  const maxIndex = Math.max(0, segments.length - 1);
  let lastIndex = Number(control.getAttribute('aria-valuenow') || 0);
  let dragging = false;

  const update = (index, immediate = true) => {
    const next = Math.max(0, Math.min(maxIndex, Number(index) || 0));
    const value = segments[next]?.getAttribute('data-value') || '';
    const label = segments[next]?.getAttribute('aria-label') || '';
    control.style.setProperty('--pm-reasoning-index', String(next));
    control.style.setProperty('--pm-reasoning-progress', String(maxIndex ? next / maxIndex : 0));
    const fillWidth = segments.length ? ((1 / segments.length) + (maxIndex ? next / maxIndex : 0) * ((maxIndex) / segments.length)) * 100 : 0;
    control.style.setProperty('--pm-reasoning-fill-width', `${fillWidth}%`);
    control.setAttribute('aria-valuenow', String(next));
    control.setAttribute('aria-valuetext', label);
    segments.forEach((segment, segmentIndex) => {
      segment.classList.toggle('is-active', segmentIndex === next);
      segment.classList.toggle('is-filled', segmentIndex <= next);
    });
    const liveLabel = selector.querySelector('[id$="-live-label"]');
    if (liveLabel) liveLabel.textContent = label;
    if (immediate) onChange?.(value, { index: next, label, immediate });
    lastIndex = next;
  };

  const progressFromEvent = (event) => {
    const rect = control.getBoundingClientRect();
    return rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  };
  const commitFromEvent = (event, immediate = true) => update(Math.round(progressFromEvent(event) * maxIndex), immediate);
  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    control.classList.add('is-dragging');
    control.setPointerCapture?.(event.pointerId);
    commitFromEvent(event, false);
  };
  const onPointerMove = (event) => { if (dragging) commitFromEvent(event, false); };
  const onPointerEnd = (event) => {
    if (!dragging) return;
    dragging = false;
    control.classList.remove('is-dragging');
    commitFromEvent(event, true);
  };
  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(control.getAttribute('aria-valuenow') || lastIndex);
    update(event.key === 'Home' ? 0 : event.key === 'End' ? maxIndex : current + (event.key === 'ArrowRight' ? 1 : -1), true);
  };
  const onSegmentClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    update(event.currentTarget.getAttribute('data-index'), true);
  };
  control.addEventListener('pointerdown', onPointerDown);
  control.addEventListener('pointermove', onPointerMove);
  control.addEventListener('pointerup', onPointerEnd);
  control.addEventListener('pointercancel', onPointerEnd);
  control.addEventListener('keydown', onKeyDown);
  segments.forEach((segment) => segment.addEventListener('click', onSegmentClick));
  return () => {
    control.removeEventListener('pointerdown', onPointerDown);
    control.removeEventListener('pointermove', onPointerMove);
    control.removeEventListener('pointerup', onPointerEnd);
    control.removeEventListener('pointercancel', onPointerEnd);
    control.removeEventListener('keydown', onKeyDown);
    segments.forEach((segment) => segment.removeEventListener('click', onSegmentClick));
  };
}
