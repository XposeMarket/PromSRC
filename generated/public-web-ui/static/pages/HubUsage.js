import { api } from '../api.js';
import { escHtml as esc } from '../utils.js';
import { hubProviderLogo } from '../components/hub-provider-logo.js';

const colors = { anthropic: '#D97757', openai: 'var(--text)', openai_codex: 'var(--text)', xai: '#88929c', gemini: '#4285F4', google: '#4285F4', ollama: '#4b9b78', llama_cpp: '#4b9b78', lm_studio: '#4b9b78', perplexity: '#20808d' };
const num = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const exact = n => new Intl.NumberFormat().format(n || 0);
const money = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format((n || 0) / 1e6);
let range = '7d', provider = '', sort = 'totalTokens', descending = true, request = 0, data, timer;
const color = p => colors[p] || '#b28b37';
const chip = p => `<span class="hu-provider" style="--provider-color:${color(p)}">${hubProviderLogo(p)}<span>${esc(p)}</span></span>`;

export function activateHubUsage() {
  const root = document.getElementById('hub-usage');
  if (!root) return;
  if (!root.dataset.ready) {
    root.dataset.ready = 'true';
    root.innerHTML = `<div class="hu-heading"><div><div class="hu-eyebrow">YOUR USAGE, IN FOCUS</div><h2>Every model. One clear picture.</h2><p>Recorded Prometheus calls · not your provider subscription bill</p></div><div class="hu-controls"><div class="hu-ranges" role="group" aria-label="Usage period">${['24h','7d','30d'].map(r => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${r}</button>`).join('')}</div><label class="hu-filter"><span class="hu-sr">Provider</span><select id="hu-provider" aria-label="Provider"><option value="">All providers</option></select></label><button type="button" id="hu-refresh" aria-label="Refresh usage">↻</button></div></div><div id="hu-status" role="status" aria-live="polite"></div><div id="hu-content"></div>`;
    root.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { range = b.dataset.range; root.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); });
    root.querySelector('#hu-provider').onchange = e => { provider = e.target.value; load(); };
    root.querySelector('#hu-refresh').onclick = () => load();
  }
  load();
  clearInterval(timer);
  timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    const hub = document.getElementById('hub-view');
    if (!document.hidden && (!hub || hub.style.display !== 'none')) load(true);
  }, 30000);
}
async function load(quiet = false) {
  const id = ++request, status = document.getElementById('hu-status');
  if (!quiet) status.textContent = 'Loading recorded usage…';
  try {
    const result = await api(`/api/hub/usage-analytics?range=${range}&provider=${encodeURIComponent(provider)}`);
    if (id !== request || !document.getElementById('hu-content')) return;
    if (result.success === false) throw new Error(result.error || 'Usage unavailable');
    data = result;
    const select = document.getElementById('hu-provider');
    select.innerHTML = `<option value="">All providers</option>${(data.providers || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}`;
    select.value = provider;
    status.textContent = '';
    render();
  } catch (e) { if (id === request && status.isConnected) status.textContent = `Unable to refresh usage. ${e.message}. Use refresh to retry.${data ? ' Showing previous results.' : ''}`; }
}
function render() {
  const t = data.totals || {}, models = data.models || [];
  const kpis = [ ['Total tokens', num(t.totalTokens), 'Recorded totals · provider token semantics'], ['API-equivalent estimate', t.pricedRequests ? money(t.costMicros) : '—', `${exact(t.pricedRequests)} of ${exact(t.requests)} calls priced · not billed spend`], ['Cache hit rate', t.cacheHitPercent == null ? '—' : `${t.cacheHitPercent.toFixed(1)}%`, 'Cache reads ÷ (input + cache reads)'], ['Model requests', exact(t.requests), 'Recorded model calls, not chat turns'] ];
  document.getElementById('hu-content').innerHTML = `<div class="hu-kpis">${kpis.map(([label,value,note]) => `<article class="hu-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</div>
    <section class="hu-panel"><div class="hu-panel-head"><div><h3>Token flow</h3><p>Stacked by provider / model · ${range === '24h' ? 'hourly' : 'daily'} buckets</p></div><span class="hu-live">↻ Refreshes every 30s</span></div><div id="hu-chart"></div><div class="hu-legend">${models.map(m => `<span>${chip(m.provider)} <span>${esc(m.model)}</span></span>`).join('')}</div></section>
    <section class="hu-panel"><div class="hu-panel-head"><div><h3>Model breakdown</h3><p>Sort any column to follow the tokens, cache, or cost.</p></div><span>${models.length} models</span></div><div class="hu-table-scroll"><table class="hu-table"><thead><tr>${[['model','Provider / model'],['inputTokens','Input'],['outputTokens','Output'],['cacheReadTokens','Cache read'],['cacheWriteTokens','Cache write'],['totalTokens','Share'],['requests','Requests'],['costMicros','API est.'],['averageDurationMs','Avg. call']].map(([key,label]) => `<th scope="col" aria-sort="${sort === key ? descending ? 'descending' : 'ascending' : 'none'}"><button type="button" data-sort="${key}">${label}${sort === key ? descending ? ' ↓' : ' ↑' : ''}</button></th>`).join('')}</tr></thead><tbody id="hu-models"></tbody></table></div></section>
    <div class="hu-bottom"><section class="hu-panel"><h3>Usage by agent</h3><p>Recorded attribution · unattributed calls remain visible</p>${breakdown(data.agents || [], t.totalTokens)}</section><section class="hu-panel"><h3>Execution context</h3><p>Log metadata, not a guess about your device</p>${breakdown(data.surfaces || [], t.totalTokens)}</section></div>
    ${(data.activity || []).length ? `<section class="hu-panel"><div class="hu-panel-head"><h3>Live background agents</h3><span class="hu-live">● Current run state</span></div><div class="hu-activity">${data.activity.map(a => `<div><span class="hu-state" data-state="${esc(a.state)}"></span>${chip(a.provider || 'unknown')}<strong>${esc(a.name || a.id)}</strong><span>${esc(a.state)}</span></div>`).join('')}</div></section>` : ''}
    <p class="hu-footnote">Only calls recorded by this Prometheus installation are included; external Claude Code / Codex CLI history is not imported. Token counts may include provider estimates. Cost uses recorded model pricing where available; unpriced calls are excluded, not treated as free. Call duration includes the full request, not time to first token.</p>`;
  document.querySelectorAll('#hub-usage [data-sort]').forEach(b => b.onclick = () => { if (sort === b.dataset.sort) descending = !descending; else {sort = b.dataset.sort; descending = true;} render(); });
  const sorted = [...models].sort((a,b) => (typeof a[sort] === 'string' ? a[sort].localeCompare(b[sort]) : (a[sort] || 0) - (b[sort] || 0)) * (descending ? -1 : 1));
  document.getElementById('hu-models').innerHTML = sorted.length ? sorted.map(m => `<tr><td>${chip(m.provider)}<strong>${esc(m.model)}</strong></td>${['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(k => `<td title="${exact(m[k])}">${num(m[k])}</td>`).join('')}<td><span class="hu-share" style="--provider-color:${color(m.provider)};--share:${t.totalTokens ? m.totalTokens / t.totalTokens * 100 : 0}%"></span>${t.totalTokens ? (m.totalTokens / t.totalTokens * 100).toFixed(1) : '0'}%</td><td>${exact(m.requests)}</td><td>${m.pricedRequests ? money(m.costMicros) : '—'}</td><td>${m.averageDurationMs == null ? '—' : `${(m.averageDurationMs / 1000).toFixed(1)}s`}</td></tr>`).join('') : '<tr><td colspan="9">No model calls recorded for this range and provider.</td></tr>';
  chart(models);
}
function breakdown(items, total) {
  if (!items.length) return '<div class="hu-empty">No recorded attribution in this range.</div>';
  return `<div class="hu-breakdown">${items.map(a => `<div><div><strong>${esc(a.name || a.id || 'Unattributed')}</strong><span>${num(a.totalTokens)} <small>tokens · ${exact(a.requests)} calls</small></span></div><div class="hu-meter"><span style="width:${total ? Math.min(100,a.totalTokens / total * 100) : 0}%"></span></div></div>`).join('')}</div>`;
}
function chart(models) {
  const target = document.getElementById('hu-chart'), buckets = data.series || [];
  if (!models.length) { target.innerHTML = '<div class="hu-empty hu-chart-empty">No recorded calls yet. Usage will appear here as models run.</div>'; return; }
  const max = Math.max(1,...buckets.map(b => Object.values(b.values).reduce((s,n) => s + n,0)));
  const width = 1000, height = 240, plot = 190, left = 64, inner = width - left - 12, step = inner / Math.max(1,buckets.length);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stacked token usage by provider and model">`;
  for (let i = 0; i <= 4; i++) { const y = 10 + plot * i / 4; svg += `<line x1="${left}" y1="${y}" x2="990" y2="${y}" class="hu-grid"/><text x="${left - 10}" y="${y + 4}" text-anchor="end">${num(max * (1 - i / 4))}</text>`; }
  buckets.forEach((b,i) => {
    let y = plot + 10;
    const when = new Date(b.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',...(range === '24h' ? {hour:'numeric'} : {})});
    models.forEach((m,j) => { const value = b.values[`${m.provider}/${m.model}`] || 0; const h = value / max * plot; y -= h; if (value) svg += `<rect tabindex="0" x="${left + i * step + 2}" y="${y}" width="${Math.max(1,step - 4)}" height="${h}" fill="${color(m.provider)}" fill-opacity="${1 - (j % 4) * .15}" data-bucket="${i}"><title>${esc(when)} · ${esc(m.provider)} / ${esc(m.model)}: ${exact(value)} tokens</title></rect>`; });
    if (i % Math.max(1,Math.ceil(buckets.length / 7)) === 0) svg += `<text x="${left + i * step + step / 2}" y="225" text-anchor="middle">${esc(new Date(b.timestamp).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}${range === '24h' ? ` ${new Date(b.timestamp).getHours()}h` : ''}</text>`;
  });
  target.innerHTML = `${svg}</svg><div class="hu-tooltip" role="status" hidden></div>`;
  const tooltip = target.querySelector('.hu-tooltip');
  target.querySelectorAll('[data-bucket]').forEach(el => { const show = () => {const b = buckets[Number(el.dataset.bucket)]; tooltip.hidden = false; tooltip.innerHTML = `<strong>${esc(new Date(b.timestamp).toLocaleString())}</strong>${models.filter(m => b.values[`${m.provider}/${m.model}`]).map(m => `<div>${chip(m.provider)} ${esc(m.model)} <b>${exact(b.values[`${m.provider}/${m.model}`])}</b></div>`).join('')}`;}; el.onmouseenter = show; el.onfocus = show; el.onmouseleave = () => tooltip.hidden = true; el.onblur = () => tooltip.hidden = true; });
}
