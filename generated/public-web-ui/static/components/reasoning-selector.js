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

function wheelRotation(progress, optionCount = 1) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const count = Math.max(1, Number(optionCount) || 1);
  const travel = count > 1 ? ((count - 1) / count) * 360 : 0;
  return Math.round(-safeProgress * travel * 1000) / 1000;
}

function wheelTickMarkup(optionCount) {
  const count = Math.max(1, Number(optionCount) || 1);
  const centerX = 120;
  const centerY = 100;
  const innerRadius = 66;
  const outerRadius = 78;
  return Array.from({ length: count }, (_, index) => {
    const angle = (-Math.PI / 2) + ((index / count) * Math.PI * 2);
    const x1 = (centerX + (Math.cos(angle) * innerRadius)).toFixed(2);
    const y1 = (centerY + (Math.sin(angle) * innerRadius)).toFixed(2);
    const x2 = (centerX + (Math.cos(angle) * outerRadius)).toFixed(2);
    const y2 = (centerY + (Math.sin(angle) * outerRadius)).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join('');
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
  const selectedWheelRotation = wheelRotation(selectedProgress, options?.length || 1);
  const modelName = model ? formatModelDisplayName(model, provider) : 'Default model';
  const effortName = options ? formatReasoningSelectorLabel(options[selectedIndex], provider) : 'Default';
  const rootId = safeId(selectorId);
  const safeControlId = safeId(controlId, `${rootId}-control`);
  const safeLiveLabelId = safeId(liveLabelId, `${rootId}-live-label`);
  const safeAdvancedId = safeId(advancedId, `${rootId}-advanced`);
  const slider = options ? `
     <div class="pm-reasoning-control" id="${esc(safeControlId)}" style="--pm-reasoning-index:${selectedIndex};--pm-reasoning-progress:${selectedProgress};--pm-reasoning-fill-width:${selectedFillWidth}%;--pm-reasoning-fill-height:${selectedFillWidth}%;--pm-reasoning-color-strength:${Math.round(selectedProgress * 100)}%;--pm-reasoning-arc-gradient:url(#${esc(safeControlId)}-arc-gradient);--pm-reasoning-wheel-rotation:${selectedWheelRotation}deg;--pm-reasoning-steps:${Math.max(1, options.length - 1)}" role="slider" tabindex="0" aria-label="Reasoning level. Swipe down for higher reasoning and up for lower reasoning." aria-valuemin="0" aria-valuemax="${options.length - 1}" aria-valuenow="${selectedIndex}" aria-valuetext="${esc(effortName)}">
       <div class="pm-reasoning-track">
         <div class="pm-reasoning-fill"></div>
         <svg class="pm-reasoning-wheel-svg" viewBox="0 0 240 126" preserveAspectRatio="xMidYMid meet" focusable="false">
           <defs>
             <linearGradient id="${esc(safeControlId)}-arc-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
               <stop offset="0%" stop-color="#ffffff" />
               <stop offset="52%" stop-color="#d7d3ff" />
               <stop offset="100%" stop-color="#7b58ff" />
             </linearGradient>
             <clipPath id="${esc(safeControlId)}-upper-wheel-clip">
               <rect x="0" y="0" width="240" height="101" />
             </clipPath>
           </defs>
           <path class="pm-reasoning-wheel-base-arch" d="M 28 100 C 28 34 212 34 212 100" />
           <g class="pm-reasoning-wheel-rotor" clip-path="url(#${esc(safeControlId)}-upper-wheel-clip)">
             <circle class="pm-reasoning-wheel-ring" cx="120" cy="100" r="78" pathLength="100" />
             <circle class="pm-reasoning-wheel-glow" cx="120" cy="100" r="78" pathLength="100" />
             <g class="pm-reasoning-wheel-ticks">${wheelTickMarkup(options.length)}</g>
           </g>
           <path class="pm-reasoning-wheel-arch" d="M 28 100 C 28 34 212 34 212 100" />
           <rect class="pm-reasoning-wheel-indicator" x="112" y="18" width="16" height="34" rx="8" />
         </svg>
         ${options.map((value, index) => `<button type="button" class="pm-reasoning-segment ${index === selectedIndex ? 'is-active ' : ''}${index <= selectedIndex ? 'is-filled' : ''}" data-index="${index}" data-value="${esc(value)}" aria-label="${esc(formatReasoningSelectorLabel(value, provider))}"><span>${esc(formatReasoningSelectorLabel(value, provider))}</span></button>`).join('')}
       </div>
     </div>` : `<div class="pm-msheet-empty pm-reasoning-unavailable">No adjustable reasoning levels for ${esc(modelName)}.</div>`;

  return `<div class="pm-reasoning-selector ${esc(className)}" id="${esc(rootId)}" data-reasoning-selector role="group" aria-label="Reasoning controls">
    <div class="pm-reasoning-summary" aria-live="polite">
      <strong>${esc(modelName)}</strong><span aria-hidden="true">&middot;</span><span id="${esc(safeLiveLabelId)}">${esc(effortName)}</span>
    </div>
    ${includeAdvanced ? `<button type="button" class="pm-reasoning-advanced" id="${esc(safeAdvancedId)}" aria-label="${esc(advancedAriaLabel)}"><span>${esc(advancedLabel)}</span><span aria-hidden="true">&rsaquo;</span></button>` : ''}
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
  let lastProgress = maxIndex ? lastIndex / maxIndex : 0;

  const update = (index, immediate = true) => {
    const next = Math.max(0, Math.min(maxIndex, Number(index) || 0));
    const value = segments[next]?.getAttribute('data-value') || '';
    const label = segments[next]?.getAttribute('aria-label') || '';
    const progress = maxIndex ? next / maxIndex : 0;
    const rotation = wheelRotation(progress, segments.length);
    control.style.setProperty('--pm-reasoning-index', String(next));
    control.style.setProperty('--pm-reasoning-progress', String(progress));
    const fillWidth = segments.length ? ((1 / segments.length) + progress * (maxIndex / segments.length)) * 100 : 0;
    control.style.setProperty('--pm-reasoning-fill-width', `${fillWidth}%`);
    control.style.setProperty('--pm-reasoning-wheel-rotation', `${rotation}deg`);
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
    lastProgress = progress;
  };

  const progressFromEvent = (event) => {
    const rect = control.getBoundingClientRect();
    return rect.width ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  };
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
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(control.getAttribute('aria-valuenow') || lastIndex);
    update(event.key === 'Home' ? 0 : event.key === 'End' ? maxIndex : current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1), true);
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
