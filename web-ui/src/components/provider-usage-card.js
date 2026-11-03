import { escHtml } from '../utils.js';

function compactNumber(n) {
  const value = Number(n) || 0;
  if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(value >= 1e10 ? 0 : 1) + 'B';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1) + 'M';
  if (Math.abs(value) >= 1e4) return (value / 1e3).toFixed(0) + 'K';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toLocaleString();
}
function gaugeClass(pct) {
  const p = Number(pct) || 0;
  return p >= 90 ? 'crit' : p >= 75 ? 'warn' : 'ok';
}
function fmtRelative(diffMs) {
  if (diffMs <= 0) return 'soon';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return mins % 60 ? `in ${hrs}h ${mins % 60}m` : `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}
function fmtReset(iso, label) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - Date.now();
  if (diff <= 0) return 'resets now';
  const d = new Date(t), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rel = fmtRelative(diff);
  if (/week|day|opus/i.test(String(label || '')) || diff >= 24 * 3600 * 1000) {
    return `resets ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time} (${rel})`;
  }
  return `resets at ${time} (${rel})`;
}
function renderUsageGauge(label, pct, resetIso) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)), reset = fmtReset(resetIso, label);
  return `<div class="usage-gauge"><div class="usage-gauge-head"><span class="usage-gauge-label">${escHtml(label)}</span><span class="usage-gauge-pct">${p}%</span></div><div class="usage-gauge-track"><div class="usage-gauge-fill ${gaugeClass(p)}" style="width:${p}%"></div></div>${reset ? `<div class="usage-gauge-reset">${escHtml(reset)}</div>` : ''}</div>`;
}
// One rendering owner for Settings and both Hubs. Account entries are never collapsed by provider.
export function renderProviderUsageCard(p) {
  const windows = Array.isArray(p.windows) ? p.windows : [], tokens = p.tokens || {};
  let body = '';
  if (windows.length) {
    body = windows.map(w => renderUsageGauge(w.label, w.used_percent, w.reset_at)
      + (w.detail ? `<div class="usage-gauge-reset">${escHtml(w.detail)}</div>` : '')).join('');
  } else if (p.usage_scope === 'model') {
    body = '<div class="usage-provider-note">Codex Spark limit data is currently unavailable.</div>';
  } else if (p.budget && p.budget.limit_tokens > 0) {
    body = renderUsageGauge('Monthly budget', p.budget.used_percent, null)
      + `<div class="usage-gauge-reset">${compactNumber(p.budget.used_tokens)} / ${compactNumber(p.budget.limit_tokens)} tokens</div>`;
  } else {
    body = `<div class="usage-provider-note">${p.error ? 'Live limits unavailable' : 'No limit data — tracking tokens only'}</div>`;
  }
  const badge = p.source === 'live' ? '<span class="usage-provider-badge live">live</span>' : '<span class="usage-provider-badge">tracked</span>';
  return `<div class="usage-provider-card" data-provider="${escHtml(p.provider)}"${p.account_id ? ` data-account="${escHtml(p.account_id)}"` : ''}><div class="usage-provider-head"><span class="usage-provider-name">${escHtml(p.account_label ? `${p.label || p.provider} · ${p.account_label}` : (p.label || p.provider))}</span>${badge}</div>${body}${p.error ? `<div class="usage-provider-err">${escHtml(p.error)}</div>` : ''}<div class="usage-provider-foot">${p.plan_label ? `${escHtml(p.plan_label)} · ` : ''}${compactNumber(tokens.total || 0)} tokens · ${compactNumber(tokens.calls || 0)} calls</div></div>`;
}
