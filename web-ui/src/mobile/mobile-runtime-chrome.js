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
  const r = el.getBoundingClientRect?.();
  if (!r?.height) return;
  const drift = Math.round(r.bottom - (targetTop - gap));
  if (Math.abs(drift) < 2) return;
  const cur = Number.parseFloat(el.style.getPropertyValue('bottom'));
  if (Number.isFinite(cur)) el.style.setProperty('bottom', `${Math.round(cur + drift)}px`);
}

/** Pin plan pill + jump button above the composer. Returns the bottom used. */
export function pinRuntimeChrome({ rect, form, page, goalStrip, planDock, agentDock, jumpButton } = {}) {
  const visible = form && !form.classList.contains('pm-composer-mode-hidden');
  const bottom = visible ? runtimeChromeBottom({ rect: rect || form.getBoundingClientRect?.(), page, goalStrip }) : null;
  for (const el of [planDock, jumpButton]) {
    if (!el) continue;
    if (bottom == null) { el.style.removeProperty('position'); el.style.removeProperty('bottom'); }
    else el.style.setProperty('position', 'fixed');
  }
  if (bottom == null) return null;
  planDock?.style.setProperty('bottom', `${bottom}px`);
  const composerTop = Number((rect || form.getBoundingClientRect?.())?.top);
  const stack = bottom - Math.max(0, Math.round(Number(window.visualViewport?.height || window.innerHeight || 0) - composerTop + 8));
  alignBottomAbove(planDock, composerTop - Math.max(0, stack));
  const height = (el) => (el && !el.hidden ? Math.ceil(el.getBoundingClientRect?.().height || 0) : 0);
  const pills = Math.max(height(planDock), agentDock?.classList.contains('is-collapsed') ? height(agentDock) : 0);
  jumpButton?.style.setProperty('bottom', `${bottom + (pills ? pills + 10 : 10)}px`);
  alignBottomAbove(jumpButton, composerTop - Math.max(0, stack) - (pills ? pills + 2 : 2));
  return bottom;
}
