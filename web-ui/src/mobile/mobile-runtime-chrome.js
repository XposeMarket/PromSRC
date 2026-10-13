/**
 * Composer-anchored runtime chrome for the mobile chat page: the plan pill,
 * the background-agent dock and the jump-to-latest button.
 *
 * They used CSS `position: absolute` with a bottom computed from CSS
 * variables, so they rode the transcript while scrolling and drifted when the
 * composer grew. Here they are viewport-fixed and pinned to the measured
 * composer top on every layout pass, like the slash/skill popovers.
 */
import { providerLogoKey, renderProviderLogo } from '../components/provider-logo.js';

const FINISHED = /^(completed|failed|timed_out|cancell?ed)$/;

/** Background statuses worth restoring into the dock on return. */
export function restorableBackgroundStatuses(statuses, now = Date.now()) {
  return (Array.isArray(statuses) ? statuses : []).filter((s) => {
    const state = String(s?.state || s?.status || '').toLowerCase();
    if (!FINISHED.test(state)) return true;
    return now - Number(s?.completedAt || s?.finishedAt || s?.updatedAt || 0) < 15 * 60_000;
  });
}

/** Distance from the viewport bottom to just above the composer, or null. */
export function runtimeChromeBottom({ rect, page, goalStrip } = {}) {
  const vv = window.visualViewport;
  const vh = Number(vv?.height || window.innerHeight || 0);
  const top = Number(rect?.top) - (Number(vv?.offsetTop || 0) || 0);
  if (!(vh > 0) || !Number.isFinite(top) || !rect?.height) return null;
  const css = (name) => Number.parseFloat(page?.style?.getPropertyValue?.(name) || '') || 0;
  const paired = page?.classList?.contains('pm-runtime-goal-agent-pills-paired') === true;
  const goal = paired || !goalStrip || goalStrip.hidden ? 0 : Math.ceil(goalStrip.getBoundingClientRect?.().height || 0);
  return Math.max(0, Math.round(vh - top + 8 + css('--pm-queued-live-height') + css('--pm-tool-progress-live-height') + goal));
}

/** (logo) Name for the background-agent side chat header; the subtitle keeps model · reasoning. */
export function agentTitleHtml(record = {}) {
  const name = String(record.agentName || 'Background work').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return providerLogoKey(record.providerId, record.model) ? `${renderProviderLogo(record.providerId, record.model)}${name}` : name;
}

/**
 * Fixed `bottom` is anchored to the layout viewport on some iOS builds and to
 * the visual viewport on others; with the keyboard up those differ by the
 * keyboard height, which hid the docks behind it. Measure the rendered edge and
 * shift `bottom` by the error so the element sits `gap` px above `targetTop`.
 */
export function alignBottomAbove(el, targetTop, gap = 8) {
  if (!el || el.hidden || !Number.isFinite(targetTop)) return;
  // The docks animate `bottom`; measuring mid-transition read an interpolated
  // rect and corrected against the inline target, overshooting by part of the
  // keyboard height. Pinned docks never animate `bottom`, and the correction
  // is applied to the value the rect was actually drawn from.
  el.style.setProperty('transition-property', 'opacity, transform');
  const r = el.getBoundingClientRect?.();
  if (!r?.height) return;
  const drift = Math.round(r.bottom - (targetTop - gap));
  if (Math.abs(drift) < 2) return;
  const drawn = Number.parseFloat(globalThis.getComputedStyle?.(el)?.bottom ?? '');
  const cur = Number.isFinite(drawn) ? drawn : Number.parseFloat(el.style.getPropertyValue('bottom'));
  if (Number.isFinite(cur)) el.style.setProperty('bottom', `${Math.round(cur + drift)}px`);
}

/** Drop the pin overrides when the composer is hidden so CSS layout resumes. */
export function unpinChrome(el) {
  if (!el) return;
  for (const k of ['position', 'bottom', 'top', 'transition-property']) el.style.removeProperty(k);
}

/**
 * While the keyboard is up the composer is placed with an explicit fixed
 * `top` (see _pmKbSetComposerViewportStyles). Docks pinned with `bottom` or
 * from getBoundingClientRect live in a different coordinate space on iOS
 * (layout vs visual viewport), which put them 400px too high or under the
 * composer after a scroll. Returns that `top` so docks can share its space.
 */
export function keyboardComposerTop(form) {
  for (let el = form, i = 0; el && i < 3; el = el.parentElement, i += 1) {
    if (el.style?.getPropertyValue?.('position') !== 'fixed') continue;
    const top = Number.parseFloat(el.style.getPropertyValue('top'));
    if (Number.isFinite(top) && /px$/.test(el.style.getPropertyValue('top'))) return top;
  }
  return null;
}

/** Stack `els` upward from `composerTop` in the composer's own fixed `top` space. */
export function stackAboveComposerTop(els, composerTop, gap = 8, extra = 0) {
  let edge = composerTop - gap - extra;
  for (const el of els) {
    if (!el || el.hidden) continue;
    const h = Math.ceil(el.getBoundingClientRect?.().height || 0);
    if (!h) continue;
    el.style.setProperty('transition-property', 'opacity, transform');
    el.style.setProperty('position', 'fixed');
    el.style.setProperty('bottom', 'auto');
    el.style.setProperty('top', `${Math.round(edge - h)}px`);
    edge -= h + gap;
  }
  return edge;
}

/**
 * Which compact pills share one row (#pm-mobile-runtime-pills):
 * - 'goal'  goal + collapsed agent pill; the row is the first layer on the
 *           composer and queued/tool-progress stack ABOVE it.
 * - 'plan'  plan + collapsed agent pill; the row sits at the plan/agent level,
 *           ABOVE queued/tool-progress, like either pill alone.
 * One row = one bottom edge, so paired pills can never sit at different heights.
 */
export function runtimePillRow(page) {
  if (page?.classList?.contains('pm-runtime-goal-agent-pills-paired') === true) return 'goal';
  if (page?.classList?.contains('pm-runtime-pills-paired') === true) return 'plan';
  return '';
}

/**
 * Element the runtime chrome stacks on: the composer, or the input-mode
 * launcher that replaces it while the composer is hidden. Pinning against the
 * launcher keeps hidden-composer layout on the same measured path instead of a
 * CSS fallback that ignored queued prompts and split paired pills apart.
 */
export function runtimeChromeAnchor({ rect, form, page } = {}) {
  if (!form) return null;
  if (!form.classList.contains('pm-composer-mode-hidden')) return rect || form.getBoundingClientRect?.() || null;
  const launcher = page?.querySelector?.('#pm-chat-mode-launcher');
  const r = launcher && !launcher.hidden ? launcher.getBoundingClientRect?.() : null;
  return r?.height ? r : null;
}

const visibleTop = (el) => {
  if (!el || el.hidden) return Infinity;
  const r = el.getBoundingClientRect?.();
  return r?.height ? r.top : Infinity;
};

/**
 * Measured top edge of the layers that sit directly on the composer: queued
 * prompts, tool progress, and the goal strip (or the goal+agent row). Plan and
 * agent pills stack above this. It used to be derived from summed live-height
 * vars, which missed each layer's own CSS gap, so the plan/agent pills and the
 * jump arrow landed 5-7px inside the queued card.
 */
export function runtimeStackBase({ anchorRect, page, goalStrip } = {}) {
  const anchorTop = Number(anchorRect?.top);
  if (!Number.isFinite(anchorTop)) return null;
  const rowMode = runtimePillRow(page);
  const q = (sel) => page?.querySelector?.(sel);
  return Math.min(
    anchorTop,
    visibleTop(q('#pm-mobile-queued-prompts')),
    visibleTop(q('#pm-tool-progress-dock')),
    rowMode === 'goal' ? visibleTop(q('#pm-mobile-runtime-pills')) : visibleTop(goalStrip),
  );
}

/** Park the jump arrow 10px above the highest visible runtime surface. */
export function placeJumpAbove({ page, base, planDock, agentDock, jumpButton } = {}) {
  if (!jumpButton || !Number.isFinite(base)) return;
  const ceiling = Math.min(
    base,
    visibleTop(planDock),
    visibleTop(agentDock),
    visibleTop(page?.querySelector?.('#pm-mobile-runtime-pills')),
    visibleTop(page?.querySelector?.('.pm-chat-connection-status')),
  );
  if (!Number.isFinite(ceiling)) return;
  if (jumpButton.hidden) {
    // Hidden buttons have no rect to measure. Park it from the layout viewport
    // so it already clears the stack when scrolling reveals it; the reveal
    // path re-measures once it is visible.
    const vh = Number(window.innerHeight || window.visualViewport?.height || 0);
    if (vh > 0) {
      jumpButton.style.setProperty('position', 'fixed');
      jumpButton.style.setProperty('bottom', `${Math.max(0, Math.round(vh - ceiling + 10))}px`);
    }
    return;
  }
  alignBottomAbove(jumpButton, ceiling, 10);
}

/**
 * Pin plan/agent pills + jump button above the composer (or the input-mode
 * launcher while the composer is hidden). Returns null when nothing could be
 * measured, otherwise an object: the caller must then NOT re-align the agent
 * dock vertically (it only keeps its horizontal width lock). Keyboard up:
 * `{ keyboardTop }`; keyboard down: `{ bottom, docked: true }`.
 */
export function pinRuntimeChrome({ rect, form, page, goalStrip, planDock, agentDock, jumpButton } = {}) {
  const visible = form && !form.classList.contains('pm-composer-mode-hidden');
  const kbTop = visible ? keyboardComposerTop(form) : null;
  const rowMode = runtimePillRow(page);
  const row = page?.querySelector?.('#pm-mobile-runtime-pills') || null;
  const css = (name) => Number.parseFloat(page?.style?.getPropertyValue?.(name) || '') || 0;
  const height = (el) => (el && !el.hidden ? Math.ceil(el.getBoundingClientRect?.().height || 0) : 0);
  // Paired pills are static children of the row; drop any stale fixed pins.
  if (rowMode) { unpinChrome(planDock); unpinChrome(agentDock); }
  if (kbTop != null) {
    // Keyboard up: share the composer's fixed-top space. Order bottom-up:
    // goal row, queued + tool progress, plan/agent pills, then the jump button.
    const queuedAndTool = css('--pm-queued-live-height') + css('--pm-tool-progress-live-height');
    if (rowMode === 'goal') {
      const rowEdge = row ? stackAboveComposerTop([row], kbTop, 8, 0) : kbTop - 8;
      stackAboveComposerTop([jumpButton], rowEdge + 8 - queuedAndTool, 10);
      return { keyboardTop: kbTop };
    }
    const pills = (rowMode === 'plan' ? [row] : [planDock, agentDock]).filter((el) => el && !el.hidden);
    const pillEdge = Math.min(...pills.map((el) => stackAboveComposerTop([el], kbTop, 8, queuedAndTool)), kbTop - 8 - queuedAndTool);
    stackAboveComposerTop([jumpButton], pillEdge + 8, 10);
    return { keyboardTop: kbTop };
  }
  for (const el of [planDock, agentDock, jumpButton, row]) el?.style.removeProperty('top');
  if (agentDock?.style.getPropertyValue('bottom') === 'auto') agentDock.style.removeProperty('bottom');
  // The goal row keeps its CSS slot directly on the composer.
  if (rowMode !== 'plan') unpinChrome(row);
  const anchorRect = runtimeChromeAnchor({ rect, form, page });
  const bottom = anchorRect ? runtimeChromeBottom({ rect: anchorRect, page, goalStrip }) : null;
  const targets = (rowMode === 'plan' ? [row] : rowMode === 'goal' ? [] : [planDock]).filter(Boolean);
  for (const el of [...targets, jumpButton]) {
    if (!el) continue;
    if (bottom == null) unpinChrome(el);
    else el.style.setProperty('position', 'fixed');
  }
  if (bottom == null) return null;
  const base = runtimeStackBase({ anchorRect, page, goalStrip });
  // The agent dock sits on the measured top of queued/tool/goal layers too
  // (summed live-height vars missed each layer's CSS gap and overlapped the
  // queued card). A collapsed pill riding a shared row is placed by the row.
  const agentFree = agentDock && !agentDock.hidden
    && !(rowMode && agentDock.classList?.contains('is-collapsed'));
  if (agentFree) targets.push(agentDock);
  for (const el of targets) {
    el.style.setProperty('bottom', `${bottom}px`);
    alignBottomAbove(el, base);
  }
  // Seed, then measure: the arrow clears whatever is actually on the plan/agent
  // level, collapsed OR expanded (an open agent card used to count as 0px).
  const pills = Math.max(height(planDock), height(agentDock), rowMode ? height(row) : 0);
  jumpButton?.style.setProperty('bottom', `${bottom + (pills ? pills + 10 : 10)}px`);
  placeJumpAbove({ page, base, planDock, agentDock, jumpButton });
  return { bottom, docked: true };
}
