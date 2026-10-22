// Shared (desktop + mobile) live countdown for tool calls that block on a
// wait with a known duration (background_ops/workspace_run action:"wait").
// Pure helpers are DOM-free; the ticker only touches the DOM when present.

export const MAX_TOOL_WAIT_MS = 30 * 60 * 1000;
export const QUIET_CONNECTION_PILL_SECONDS = 60;

const WAIT_TOOL_NAMES = /^(?:background_wait|bg_wait|process_wait|wait_for_background|background_ops_wait)$/;

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// Duration of a declared wait, or 0 when the call has no known wait length.
// User-driven waits (await_prometheus_question_response) never count.
export function toolWaitDurationMs(toolName, rawArgs) {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name || name === 'await_prometheus_question_response') return 0;
  const args = parseArgs(rawArgs);
  const action = String(args.action || '').trim().toLowerCase();
  if (!WAIT_TOOL_NAMES.test(name) && action !== 'wait') return 0;
  const raw = args.wait_ms ?? args.waitMs ?? args.timeout_ms ?? args.timeoutMs;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms), MAX_TOOL_WAIT_MS);
}

export function toolWaitDeadline(toolName, args, startedAtMs) {
  const duration = toolWaitDurationMs(toolName, args);
  if (!duration) return 0;
  const started = Number(startedAtMs);
  return (Number.isFinite(started) && started > 0 ? started : Date.now()) + duration;
}

export function formatCountdown(remainingMs) {
  const total = Math.max(0, Math.ceil((Number(remainingMs) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function waitCountdownText(deadline, now = Date.now()) {
  return `Waiting · ${formatCountdown(deadline - now)} left`;
}

// Deadline for the newest tool call in a trace group, if it is still open
// (no result yet) and is a known-duration wait. Otherwise 0.
export function openToolWaitDeadline(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const activity = list[index]?.activity;
    if (!activity || !/^(?:operation|result)$/.test(String(activity.kind || ''))) continue;
    if (activity.kind !== 'operation' || !['running', 'preparing'].includes(String(activity.status || 'running'))) return 0;
    return toolWaitDeadline(activity.action || activity.technicalName, activity.args, activity.startedAt);
  }
  return 0;
}

export function waitCountdownHtml(entries, now = Date.now()) {
  const deadline = openToolWaitDeadline(entries);
  if (!deadline) return '';
  ensureWaitCountdownTicker();
  return `<span class="pm-tool-wait-countdown" data-deadline="${deadline}" style="color:var(--prom-muted, currentColor);opacity:.8;font-variant-numeric:tabular-nums;margin-left:6px;white-space:nowrap">${waitCountdownText(deadline, now)}</span>`;
}

// Old gateways sent "Still connected ... (13s)" pills well before 60s of
// quiet. Reject any activity message that reports < 60 quiet seconds.
export function shouldShowActivityPill(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const match = text.match(/\((\d+)s\b/) || text.match(/\bfor (\d+)s\b/);
  if (match && Number(match[1]) < QUIET_CONNECTION_PILL_SECONDS) return false;
  if (!match && /waiting for the next update/i.test(text)) return false;
  return true;
}

export function hasActiveWaitCountdown(root = typeof document !== 'undefined' ? document : null) {
  return Boolean(root?.querySelector?.('.pm-tool-wait-countdown[data-deadline]'));
}

let ticker = null;

export function tickWaitCountdowns(root = typeof document !== 'undefined' ? document : null, now = Date.now()) {
  const nodes = root?.querySelectorAll ? root.querySelectorAll('.pm-tool-wait-countdown[data-deadline]') : [];
  nodes.forEach((node) => {
    const deadline = Number(node.getAttribute('data-deadline'));
    if (!deadline) return;
    const text = waitCountdownText(deadline, now);
    if (node.textContent !== text) node.textContent = text;
  });
  return nodes.length;
}

export function ensureWaitCountdownTicker() {
  if (ticker || typeof document === 'undefined' || typeof setInterval !== 'function') return;
  ticker = setInterval(() => {
    if (!tickWaitCountdowns()) {
      clearInterval(ticker);
      ticker = null;
    }
  }, 1000);
}
