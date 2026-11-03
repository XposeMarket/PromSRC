import { escHtml as esc } from '../utils.js';

const palette = ['#e88362', '#65b9e8', '#b59aef', '#5cbd94', '#e6ba58', '#ed8caf', '#8eb96b', '#b5a18e', '#6cc8c1', '#df9660', '#959eec', '#d4be84'];
const assigned = new Map();
const key = m => `${m.provider}/${m.model}`;
const exact = n => new Intl.NumberFormat().format(n || 0);
const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
export function modelLineColor(m) {
  const id = key(m);
  if (!assigned.has(id)) assigned.set(id, palette[assigned.size % palette.length]);
  return assigned.get(id);
}
export function createChartState() { return { hidden: new Set(), selected: null }; }

// Uses the existing hourly/daily buckets; lines are deliberately not smoothed into invented peaks.
export function renderUsageLines(target, models, buckets, range, state) {
  const visible = models.filter(m => !state.hidden.has(key(m)));
  const width = Math.max(240, target.clientWidth || 700), height = 250, left = 44, right = width - 12, top = 16, bottom = 211;
  const value = (m, i) => Math.max(0, Number(buckets[i]?.values?.[key(m)]) || 0);
  const max = Math.max(1, ...visible.flatMap(m => buckets.map((_, i) => value(m, i))));
  const x = i => left + (buckets.length > 1 ? i / (buckets.length - 1) : .5) * (right - left);
  const y = v => bottom - v / max * (bottom - top);
  const when = i => new Date(buckets[i].timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', ...(range === '24h' ? { hour: 'numeric' } : {}) });
  const legend = models.map((m, i) => `<div class="hu-model-control" style="--model-color:${modelLineColor(m)}"><button type="button" data-toggle="${i}" aria-pressed="${!state.hidden.has(key(m))}" aria-label="Show ${esc(m.provider)} / ${esc(m.model)}"><i></i><span>${esc(m.model)}<small>${esc(m.provider)}</small></span></button><button type="button" data-only="${i}" aria-label="Show only ${esc(m.model)}">Only</button></div>`).join('');
  let svg = `<svg viewBox="0 0 ${width} ${height}" tabindex="0" role="group" aria-label="Model token usage line chart. Tap a line for details. Arrow keys choose time and model; Escape closes details.">`;
  for (let i = 0; i <= 4; i++) {
    const v = max * (1 - i / 4), yy = y(v);
    svg += `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" class="hu-grid"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  visible.forEach((m, j) => {
    const path = buckets.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(value(m, i)).toFixed(2)}`).join(' ');
    svg += `<path class="hu-model-line" d="${path}" stroke="${modelLineColor(m)}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" data-line="${j}"/>`;
    if (buckets.length === 1) svg += `<circle cx="${x(0)}" cy="${y(value(m, 0))}" r="4" fill="${modelLineColor(m)}"/>`;
  });
  const ticks = Math.min(buckets.length, width < 500 ? 3 : 7);
  for (let i = 0; i < ticks; i++) {
    const idx = ticks < 2 ? 0 : Math.round(i * (buckets.length - 1) / (ticks - 1));
    svg += `<text x="${x(idx)}" y="239" text-anchor="${i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle'}">${esc(when(idx))}</text>`;
  }
  svg += '<g class="hu-selection" hidden><line class="hu-crosshair"/><circle r="5"/></g></svg>';
  const empty = !models.length || !buckets.length ? 'No recorded calls yet. Usage will appear here as models run.' : !visible.length ? 'All models hidden. Select a model below or show all.' : '';
  target.innerHTML = `<div class="hu-line-stage">${empty ? `<div class="hu-empty hu-chart-empty">${empty}</div>` : svg}<aside class="hu-point-popover" hidden aria-label="Usage details"><button type="button" data-close aria-label="Close usage details">×</button><div data-details role="status" aria-live="polite"></div></aside></div><div class="hu-chart-help">Tap a line to inspect · toggle models below${models.length ? ' <button type="button" data-show-all>Show all</button>' : ''}</div><div class="hu-model-legend">${legend}</div>`;
  const plot = target.querySelector('svg'), popover = target.querySelector('.hu-point-popover');
  const hide = () => { state.selected = null; popover.hidden = true; target.querySelector('.hu-selection')?.setAttribute('hidden', ''); };
  function show(m, i) {
    state.selected = { key: key(m), timestamp: buckets[i].timestamp };
    const pointValue = value(m, i);
    popover.hidden = false;
    target.querySelector('[data-details]').innerHTML = `<div class="hu-point-model" style="--model-color:${modelLineColor(m)}"><i></i><strong>${esc(m.model)}</strong></div><div class="hu-point-meta">${esc(m.provider)} · ${esc(when(i))}</div><div class="hu-point-value">${exact(pointValue)} <small>tokens in this ${range === '24h' ? 'hour' : 'day'}</small></div><div class="hu-point-period">Model totals · selected ${esc(range)}</div><dl>${[['Tokens', exact(m.totalTokens)], ['Requests', exact(m.requests)], ['Input / output', `${compact(m.inputTokens)} / ${compact(m.outputTokens)}`], ['Cache read / write', `${compact(m.cacheReadTokens)} / ${compact(m.cacheWriteTokens)}`], ['API estimate (not billed)', m.pricedRequests ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(m.costMicros / 1e6) : 'Unpriced'], ['Avg. call', m.averageDurationMs == null ? '—' : `${(m.averageDurationMs / 1000).toFixed(1)}s`]].map(([a,b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`;
    const marker = plot.querySelector('.hu-selection');
    marker.removeAttribute('hidden');
    const line = marker.querySelector('line'), dot = marker.querySelector('circle');
    Object.entries({ x1: x(i), x2: x(i), y1: top, y2: bottom }).forEach(([k,v]) => line.setAttribute(k,v));
    Object.entries({ cx: x(i), cy: y(pointValue), fill: modelLineColor(m) }).forEach(([k,v]) => dot.setAttribute(k,v));
  }
  target.querySelector('[data-close]').onclick = () => { hide(); plot?.focus({ preventScroll: true }); };
  const repaint = () => renderUsageLines(target, models, buckets, range, state);
  target.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const id = key(models[Number(b.dataset.toggle)]);
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    repaint(); target.querySelector(`[data-toggle="${b.dataset.toggle}"]`)?.focus({ preventScroll: true });
  });
  target.querySelectorAll('[data-only]').forEach(b => b.onclick = () => {
    const id = key(models[Number(b.dataset.only)]);
    state.hidden = new Set(models.filter(m => key(m) !== id).map(key));
    repaint(); target.querySelector(`[data-only="${b.dataset.only}"]`)?.focus({ preventScroll: true });
  });
  target.querySelector('[data-show-all]')?.addEventListener('click', () => { state.hidden.clear(); repaint(); target.querySelector('[data-show-all]')?.focus({ preventScroll: true }); });
  if (!plot || !visible.length || !buckets.length) return;
  plot.onclick = event => {
    const rect = plot.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * width, py = (event.clientY - rect.top) / rect.height * height;
    const i = Math.max(0, Math.min(buckets.length - 1, Math.round((px - left) / (right - left) * (buckets.length - 1))));
    const nearest = visible.reduce((a, m) => Math.abs(y(value(m, i)) - py) < Math.abs(y(value(a, i)) - py) ? m : a);
    show(nearest, i);
  };
  plot.onkeydown = event => {
    if (event.key === 'Escape') { hide(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    let i = Math.max(0, buckets.findIndex(b => b.timestamp === state.selected?.timestamp));
    let j = Math.max(0, visible.findIndex(m => key(m) === state.selected?.key));
    if (event.key === 'ArrowLeft') i = Math.max(0, i - 1);
    if (event.key === 'ArrowRight') i = Math.min(buckets.length - 1, i + 1);
    if (event.key === 'ArrowUp') j = (j + 1) % visible.length;
    if (event.key === 'ArrowDown') j = (j + visible.length - 1) % visible.length;
    show(visible[j], i);
  };
  if (state.selected) {
    const m = visible.find(m => key(m) === state.selected.key), i = buckets.findIndex(b => b.timestamp === state.selected.timestamp);
    if (m && i >= 0) show(m, i); else hide();
  }
}
