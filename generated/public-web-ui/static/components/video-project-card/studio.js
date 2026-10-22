// Studio sheet: the step-by-step flow for a video project. Opened by "Continue" on the compact
// chat card. Drives the existing card plumbing (ops / act / generate / load) passed in as ctx,
// so it adds no fetch layer and every paid call still goes through the server cost gate.
import { shotStep, currentShotIndex, nextAction, durationOptions, resolveMode } from './studio-model.js';
import { loadModels, loadPresets } from './v2.js';

const STEPS = [['frame', 'Frame'], ['setup', 'Setup'], ['prompt', 'Prompt'], ['take', 'Take']];
const ICON_CHECK = '✓';
// While a run is busy, only navigation/selection stays live. Every paid or mutating action is blocked.
const BUSY_OK = new Set(['close', 'back', 'shot', 'cand']);

let sheet = null;
let scrim = null;
let ctx = null;
let view = { index: 0, local: {}, routed: false, models: null, presets: null };
let keyHandler = null;
let prevOverflow = '';

function project() { return ctx?.getProject?.() || null; }
function busyNow() { return !!ctx?.getState?.().busy; }
function modelList() { const st = ctx?.getState?.() || {}; return (st.models?.length ? st.models : (view.models || [])); }
function shortLabel(m, id) { return String(m?.label || id || 'model').replace(/\s+via\s+fal$/i, '').replace(/\s*\(image→video\)$/i, ''); }
function snapLen(m, sec) {
  const opts = m ? durationOptions(m) : [];
  if (!opts.length) return Number(sec);
  return opts.reduce((b, o) => (Math.abs(o - sec) < Math.abs(b - sec) ? o : b), opts[0]);
}
function chipsHtml(p, s) {
  const m = modelList().find((x) => x.id === s.modelId);
  const dur = snapLen(m, Number(s.durationSec));
  const cam = s.presetId ? ((view.presets || []).find((x) => x.id === s.presetId)?.label || s.presetId) : '';
  const chip = (t) => `<span class="vps-chip is-static">${esc(t)}</span>`;
  return `${chip(shortLabel(m, s.modelId || 'model'))}${chip(`${dur}s`)}${cam ? chip(cam) : ''}${p.target?.aspect ? chip(p.target.aspect) : ''}`;
}
// Estimate cache per shot + model + duration. 'pending' while fetching; number or null when done.
function priceKey(s) { return `price:${s.id}:${s.modelId || ''}:${s.durationSec}`; }
function shotPrice(s) {
  if (typeof ctx?.h?.vpFetch !== 'function') return null;
  const k = priceKey(s);
  const v = view.local[k];
  if (v === undefined) {
    view.local[k] = 'pending';
    ctx.h.vpFetch(`/${encodeURIComponent(ctx.id)}/estimate`, { shotIds: [s.id] })
      .then((r) => { const t = Number(r?.total ?? r?.estimate?.total ?? r?.totalUsd); view.local[k] = Number.isFinite(t) && t >= 0 ? t : null; })
      .catch(() => { view.local[k] = null; })
      .finally(() => { if (sheet) render(); });
    return null;
  }
  return typeof v === 'number' ? v : null;
}
function priceSuffix(s) { const v = shotPrice(s); return v != null ? ` · ${usd(v)}` : ''; }
async function flushFocused() {
  const a = document.activeElement;
  if (!a || !sheet?.contains(a) || !a.matches?.('[data-vps-f]')) return;
  const shot = project()?.shots?.[view.index];
  const field = a.dataset.vpsF;
  if (!shot || (field !== 'prompt' && field !== 'line')) return;
  if (String(shot[field] ?? '') === a.value) return;
  await ctx.ops([{ op: 'shot.update', id: shot.id, [field]: a.value }], 'Saving');
}
// Save any in-flight prompt edit before a paid call so it generates from the new text.
async function flushBeforePaid() {
  await flushFocused();
}
function esc(s) { return ctx?.h?.esc ? ctx.h.esc(s) : String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function usd(v) { return ctx?.h?.usd ? ctx.h.usd(v) : `$${Number(v || 0).toFixed(2)}`; }
function mediaUrl(rel) { return ctx?.h?.mediaUrl ? ctx.h.mediaUrl(rel) : rel; }
function isVideo(rel) { return ctx?.h?.isVideo ? ctx.h.isVideo(rel) : /\.(mp4|webm|mov)$/i.test(String(rel || '')); }

function stepOf(p, i) {
  const s = p.shots[i];
  if (view.local[s.id] === 'prompt' && shotStep(s, i, p.shots, p.characters) !== 'done') return 'prompt';
  return shotStep(s, i, p.shots, p.characters);
}

function clampIndex(p) {
  if (!p.shots.length) { view.index = 0; return; }
  if (view.index < 0 || view.index >= p.shots.length) {
    const cur = currentShotIndex(p);
    view.index = cur >= 0 ? cur : p.shots.length - 1;
  }
}

function shotThumb(s, p) {
  const take = (s.takes || []).find((t) => t.id === s.selectedTakeId);
  const rel = take?.poster || take?.path || s.storyboard || (s.storyboardCandidates || [])[0];
  if (!rel) return '<span class="vps-thumb is-empty"></span>';
  return isVideo(rel) && !take?.poster
    ? `<video class="vps-thumb" src="${esc(mediaUrl(rel))}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img class="vps-thumb" src="${esc(mediaUrl(rel))}" alt="" loading="lazy">`;
}

function railHtml(current, done) {
  return `<nav class="vps-rail" aria-label="Shot steps">${STEPS.map(([id, label], k) => {
    const on = id === current;
    const past = done || STEPS.findIndex(([x]) => x === current) > k;
    return `<span class="vps-pill${on ? ' is-on' : ''}${past && !on ? ' is-done' : ''}">${past && !on ? ICON_CHECK + ' ' : ''}${label}</span>`;
  }).join('')}</nav>`;
}

function shotsHtml(p, idx) {
  return `<div class="vps-shots" role="list">${p.shots.map((s, i) => {
    const approved = !!s.approvedAt;
    const cur = i === idx;
    return `<button type="button" role="listitem" class="vps-shot${cur ? ' is-cur' : ''}" data-vps="shot" data-i="${i}" aria-label="Shot ${i + 1}">
      ${shotThumb(s, p)}
      ${approved ? '<span class="vps-badge is-ok">✓</span>' : cur ? '<span class="vps-badge is-cur">●</span>' : ''}
      <span class="vps-shot-n">${i + 1}</span></button>`;
  }).join('')}</div>`;
}

function approvePendingHtml() {
  const st = ctx.getState();
  // Two gates feed one inline row: generate() (st.pending) and act() (st.actPending).
  const pend = st.pending || st.actPending;
  if (!pend) return '';
  const raw = Number(st.pending ? (st.pending.estimate?.total ?? st.pending.estimate?.totalUsd) : (pend.usd ?? pend.totalUsd ?? pend.total));
  // Never show a made-up $0.00: if the server quote has no readable price, say so and point at the reason text.
  const known = Number.isFinite(raw) && raw > 0;
  const price = known ? usd(raw) : '';
  return `<div class="vps-approve" role="group" aria-label="Approve cost"><strong>${known ? `Approve ${price}?` : 'Approve this paid run?'}</strong>
    <p class="vps-muted">${esc(st.pending?.reason || pend.reason || 'This run is paid. Nothing is sent until you approve.')}</p>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="approve-pending" ${busyNow() ? 'disabled' : ''}>Approve &amp; run${known ? ` · ${price}` : ''}</button>
    <button type="button" class="vps-btn is-wide" data-vps="cancel-pending">Cancel</button></div></div>`;
}


function frameHtml(p, i, s) {
  const cands = s.storyboardCandidates || [];
  const active = Math.min(view.local[`cand:${s.id}`] || 0, Math.max(0, cands.length - 1));
  const prev = p.shots[i - 1];
  const prevTake = prev && (prev.takes || []).find((t) => t.id === prev.selectedTakeId);
  const chainOpt = i > 0 && prevTake?.kind === 'video'
    ? `<button type="button" class="vps-opt" data-vps="chain-frame" data-i="${i}" ${busyNow() ? 'disabled' : ''}><span class="vps-opt-main"><span>Continue from last frame</span><small class="vps-muted">Seamless. Picks up exactly where shot ${i} ends</small></span><span class="vps-badge is-accent">Prom pick</span></button>` : '';
  const tiles = cands.length
    ? `<div class="vps-car" data-vps-car="${esc(s.id)}">${cands.map((rel, k) => `
        <button type="button" class="vps-tile${k === active ? ' is-active' : ''}" data-vps="cand" data-k="${k}" data-path="${esc(rel)}" aria-label="Frame ${'ABCD'[k] || k + 1}">
          <img src="${esc(mediaUrl(rel))}" alt="" loading="lazy"><span class="vps-tag">${'ABCD'[k] || k + 1}</span></button>`).join('')}</div>
       <div class="vps-dots">${cands.map((_, k) => `<span class="vps-dot${k === active ? ' is-on' : ''}"></span>`).join('')}</div>`
    : '<p class="vps-muted">No frames yet. Generate four stills to pick from.</p>';
  const activePath = cands[active] || '';
  return `<h3 class="vps-h">Pick a start frame</h3>${chainOpt ? `<div class="vps-list">${chainOpt}</div><p class="vps-muted">or pick a new frame</p>` : ''}${tiles}
    <form class="vps-field" data-vps-form="edit-frame"><input class="vps-input" name="instruction" placeholder="Change something in ${'ABCD'[active] || 'A'}… (e.g. cash in hand)" aria-label="Edit frame"><button type="submit" class="vps-btn" aria-label="Apply edit" ${activePath ? '' : 'disabled'}>↵</button></form>
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="more-frames" data-i="${i}" ${busyNow() ? 'disabled' : ''}>↻ 4 more</button>
      <button type="button" class="vps-btn is-primary is-wide" data-vps="use-frame" data-path="${esc(activePath)}" ${activePath ? '' : 'disabled'}>Use ${'ABCD'[active] || 'A'} →</button>
      ${chainOpt}
    </div>`;
}

function setupHtml(p, i, s) {
  const st = ctx.getState();
  const models = modelList().filter((m) => m.kind === 'video');
  const current = models.find((m) => m.id === s.modelId) || models[0];
  const pick = view.routed && view.pick ? view.pick[s.id] : null;
  const rows = models.map((m) => `<button type="button" class="vps-opt${m.id === current?.id ? ' is-on' : ''}" data-vps="model" data-id="${esc(m.id)}">
      <span class="vps-opt-main"><span>${esc(shortLabel(m, m.id))}</span>
      <small class="vps-muted">${durationOptions(m).join('/')}s${m.pricing?.perSecondUsd ? ` · $${m.pricing.perSecondUsd}/s` : ''}</small></span>
      ${pick === m.id ? '<span class="vps-badge is-accent">Prom pick</span>' : ''}</button>`).join('');
  const opts = durationOptions(current || {});
  const cur = Number(s.durationSec);
  // No known limits yet (models still loading or no limits): show only the shot's current value.
  const lenVals = opts.length ? opts : [cur];
  const lengths = lenVals.map((d) => `<button type="button" class="vps-chip${d === cur ? ' is-on' : ''}" data-vps="length" data-d="${d}" ${busyNow() ? 'disabled' : ''}>${d}s</button>`).join('');
  const cams = (view.presets || []).filter((x) => x.group === 'camera').slice(0, 8);
  const camChips = cams.map((c) => `<button type="button" class="vps-chip${c.id === s.presetId ? ' is-on' : ''}" data-vps="camera" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  return `<h3 class="vps-h">Model <span class="vps-muted">· Prom pre-picked</span></h3>
    <div class="vps-list">${rows || '<p class="vps-muted">Loading models…</p>'}</div>
    <h3 class="vps-h">Length</h3><div class="vps-chips">${lengths}</div>
    ${camChips ? `<h3 class="vps-h">Camera</h3><div class="vps-chips">${camChips}</div>` : ''}
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="next-step" data-to="prompt">Next · Prompt →</button></div>`;
}

function promptHtml(p, i, s) {
  const take = (s.takes || []).length;
  return `<h3 class="vps-h">Prompt</h3>
    <textarea class="vps-text" data-vps-f="prompt" data-s="${esc(s.id)}" rows="4" aria-label="Shot prompt">${esc(s.prompt || '')}</textarea>
    <input class="vps-input" data-vps-f="line" data-s="${esc(s.id)}" value="${esc(s.line || '')}" placeholder="Spoken line (optional)" aria-label="Spoken line">
    <div class="vps-chips">${chipsHtml(p, s)}</div>
    ${approvePendingHtml()}
    ${(ctx.getState().pending || ctx.getState().actPending) ? '' : `<button type="button" class="vps-btn is-primary is-wide" data-vps="generate" data-s="${esc(s.id)}" ${busyNow() ? 'disabled' : ''}>Generate${take ? ' again' : ''}${priceSuffix(s)}</button>`}`;
}

function takeHtml(p, i, s) {
  const takes = s.takes || [];
  const sel = takes.find((t) => t.id === s.selectedTakeId) || takes[takes.length - 1];
  const gen = s.status === 'generating' || (ctx.running?.() || []).some((j) => j.target?.shotId === s.id);
  if (gen && !sel) return '<div class="vps-wait"><span class="vps-spin"></span> Generating… usually 1-3 min</div>';
  const qa = sel?.qa ? `QA ${Number(sel.qa.score).toFixed(1)} · ${String(sel.qa.verdict || '').toUpperCase()}` : '';
  const player = sel ? (isVideo(sel.path)
    ? `<video class="vps-player" src="${esc(mediaUrl(sel.path))}" poster="${esc(sel.poster ? mediaUrl(sel.poster) : '')}" controls playsinline preload="metadata"></video>`
    : `<img class="vps-player" src="${esc(mediaUrl(sel.path))}" alt="">`) : '<p class="vps-muted">No take yet.</p>';
  const chips = takes.map((t, k) => `<button type="button" class="vps-chip${t.id === sel?.id ? ' is-on' : ''}" data-vps="take" data-s="${esc(s.id)}" data-t="${esc(t.id)}">Take ${k + 1}</button>`).join('');
  const kept = !!s.approvedAt;
  return `<h3 class="vps-h">Take ${takes.indexOf(sel) + 1 || takes.length} ${qa ? `<span class="vps-muted">${esc(qa)}</span>` : ''}</h3>
    ${player}<div class="vps-chips">${chips}</div>
    <form class="vps-field" data-vps-form="redo-note"><input class="vps-input" name="note" placeholder="What should change? (e.g. slower hand)" aria-label="Change note"><button type="submit" class="vps-btn" aria-label="Redo with note">↵</button></form>
    ${gen ? '<div class="vps-wait"><span class="vps-spin"></span> Generating… usually 1-3 min</div>' : ''}
    <div class="vps-row vps-stack">
      <button type="button" class="vps-btn is-wide" data-vps="redo" data-s="${esc(s.id)}" ${gen || busyNow() ? 'disabled' : ''}>↻ Redo${priceSuffix(s)}</button>
      ${kept ? `<button type="button" class="vps-btn is-wide" data-vps="unkeep" data-s="${esc(s.id)}">Unkeep</button>`
        : `<button type="button" class="vps-btn is-primary is-wide" data-vps="keep" data-s="${esc(s.id)}" ${sel ? '' : 'disabled'}>Keep ✓</button>`}
    </div>
    ${approvePendingHtml()}`;
}

function afterKeepHtml(p, i) {
  const s = p.shots[i];
  const next = p.shots[i + 1];
  if (!next) {
    return `<div class="vps-after"><h3 class="vps-h">Shot ${i + 1} kept ✓</h3>
      <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="render">Render the final cut</button></div></div>`;
  }
  const hasStill = !!next.storyboard;
  return `<div class="vps-after"><h3 class="vps-h">Shot ${i + 1} kept ✓</h3>
    <p class="vps-muted">How should shot ${i + 2} start?</p>
    <div class="vps-list">
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="chain" data-i="${i + 1}"><span>Continue from last frame</span><span class="vps-badge is-accent">Prom pick</span></button>
      <button type="button" class="vps-opt" data-vps="after-start" data-mode="new" data-i="${i + 1}"><span>New start frame</span></button>
      ${hasStill ? `<button type="button" class="vps-opt" data-vps="after-start" data-mode="still" data-i="${i + 1}"><span>Use storyboard still</span></button>` : ''}
    </div>
    <div class="vps-row vps-stack"><button type="button" class="vps-btn is-primary is-wide" data-vps="goto" data-i="${i + 1}">Go to shot ${i + 2} →</button></div></div>`;
}

function bodyHtml(p) {
  const mode = resolveMode(p);
  if (mode === 'auto' && !(p.lastRun && p.lastRun.state === 'running')) return autoPlanHtml(p);
  if (!p.shots.length) return '<p class="vps-muted">No shots yet. Ask Prom to plan the shot list, then come back here.</p>';
  clampIndex(p);
  const i = view.index;
  const s = p.shots[i];
  const step = stepOf(p, i);
  const panel = step === 'frame' ? frameHtml(p, i, s)
    : step === 'setup' ? setupHtml(p, i, s)
    : step === 'prompt' ? promptHtml(p, i, s)
    : step === 'done' ? afterKeepHtml(p, i)
    : takeHtml(p, i, s);
  const stepKey = `${s.id}:${step}`;
  return `${railHtml(step === 'done' ? 'take' : step, step === 'done')}
    <div class="vps-step" data-vps-step="${esc(stepKey)}">${panel}</div>`;
}

function autoPlanHtml(p) {
  const plan = view.plan || {};
  const models = modelList();
  const rows = p.shots.map((s, i) => {
    const m = models.find((x) => x.id === (s.modelId || p.defaults?.videoModel));
    const cam = s.presetId ? ((view.presets || []).find((x) => x.id === s.presetId)?.label || '') : '';
    const price = s.approvedAt ? null : shotPrice(s);
    const right = s.approvedAt ? '<span class="vps-badge is-accent">Kept</span>'
      : price != null ? `<span class="vps-muted">${usd(price)}</span>` : '';
    return `<div class="vps-sl">${shotThumb(s, p)}
      <span class="vps-opt-main vps-grow"><strong>${i + 1}. ${esc(s.title || 'Shot')}</strong>
      <small class="vps-muted">${esc(shortLabel(m, s.modelId || p.defaults?.videoModel || 'model'))} · ${esc(snapLen(m, Number(s.durationSec)))}s${cam ? ` · ${esc(cam)}` : ''}</small></span>
      ${right}</div>`;
  }).join('');
  const total = Number(plan.total) || 0;
  const cap = p.budget?.capUsd;
  const pend = ctx.getState().actPending;
  // The server quote is the only price that can start a paid run: once it arrives, the approve row replaces the plan button.
  const action = pend && pend.action === 'run'
    ? approvePendingHtml()
    : `<button type="button" class="vps-btn is-primary is-wide" data-vps="run-approve" ${busyNow() ? 'disabled' : ''}>Get quote &amp; run</button>`;
  return `<h3 class="vps-h">Autopilot plan <span class="vps-muted">· needs your OK</span></h3>
    <div class="vps-list">${rows}</div>
    <p class="vps-muted">+ frames, QA rerolls (1 max), music</p>
    <p class="vps-total"><strong>${total > 0 ? `About ${usd(total)}` : 'Quoted before anything runs'}</strong>${cap != null ? `<span class="vps-muted"> / ${usd(cap)} cap</span>` : ''}</p>
    <p class="vps-muted">I only stop early if a shot fails QA twice or the run would go over the cap.</p>
    <div class="vps-row vps-stack">${action}
    <button type="button" class="vps-btn is-ghost is-wide" data-vps="mode" data-to="step" ${busyNow() ? 'disabled' : ''}>Switch to step-by-step</button></div>`;
}

function headerHtml(p) {
  const mode = resolveMode(p);
  const n = p.shots.length;
  const i = Math.min(view.index, Math.max(0, n - 1));
  const modeChip = mode === 'auto'
    ? '<button type="button" class="vps-chip" data-vps="mode" data-to="step">Step-by-step</button>'
    : '<button type="button" class="vps-chip" data-vps="mode" data-to="auto">⚡ Auto</button>';
  return `<header class="vps-top">
    <button type="button" class="vps-icon-btn" data-vps="back" aria-label="Previous shot" ${i > 0 ? '' : 'disabled'}>‹</button>
    <div class="vps-title"><strong>${esc(p.title || 'Video project')}</strong><small class="vps-muted">${n ? `Shot ${i + 1} of ${n}` : 'No shots'}</small></div>
    ${modeChip}
    <button type="button" class="vps-icon-btn" data-vps="close" aria-label="Close">✕</button>
  </header>`;
}

function render() {
  if (!sheet) return;
  const p = project();
  if (!p) return;
  const st = ctx.getState();
  const err = st.error ? `<p class="vps-err">${esc(st.error)}</p>` : '';
  const busy = st.busy ? `<div class="vps-busy"><span class="vps-spin"></span>${esc(st.busy)}…</div>` : '';
  const shots = p.shots.length ? shotsHtml(p, Math.min(view.index, p.shots.length - 1)) : '';
  sheet.innerHTML = `${headerHtml(p)}${shots}${busy}${err}<div class="vps-body">${bodyHtml(p)}</div>`;
  sheet.dataset.vpsFor = ctx.id;
}

async function loadExtras() {
  if (!view.models) { view.models = await loadModels(ctx.h).catch(() => []); render(); }
  if (!view.presets) { view.presets = await loadPresets(ctx.h).catch(() => []); render(); }
  if (!view.routed) {
    view.routed = true;
    const r = await ctx.route?.();
    const picks = r?.picks || r?.routes || [];
    view.pick = {};
    for (const pk of picks) if (pk.shotId && pk.modelId) view.pick[pk.shotId] = pk.modelId;
    render();
  }
  if (resolveMode(project()) === 'auto' && !view.plan) {
    const cost = await ctx.h.vpFetch(`/${encodeURIComponent(ctx.id)}/action`, { action: 'run_cost' }).catch(() => null);
    view.plan = { total: Number(cost?.totalUsd ?? cost?.total ?? 0), perShot: {} };
    render();
  }
}

function setShotIndex(i) { view.index = i; render(); }

async function onAction(t) {
  const d = t.dataset;
  const p = project();
  if (!p) return;
  const shot = p.shots[view.index];
  const sid = shot?.id;
  switch (d.vps) {
    case 'close': return closeStudio();
    case 'back': return setShotIndex(Math.max(0, view.index - 1));
    case 'shot': return setShotIndex(Number(d.i) || 0);
    case 'goto': return setShotIndex(Number(d.i) || 0);
    case 'mode': await ctx.ops([{ op: 'project.update', mode: d.to }], 'Switching'); return;
    case 'cand': view.local[`cand:${sid}`] = Number(d.k) || 0; return render();
    case 'use-frame':
      await ctx.ops([{ op: 'shot.approveStoryboard', id: sid, path: d.path }], 'Keeping frame');
      return;
    case 'chain-frame': {
      const ops = [{ op: 'shot.update', id: sid, chainFromPrevious: true }];
      if (shot.storyboard || shot.startImage) ops[0] = { ...ops[0], storyboard: '', startImage: '' };
      await ctx.ops(ops, 'Continuing from last frame');
      return;
    }
    case 'more-frames': return ctx.act('storyboard', { shotIds: [sid], count: 4 }, 'Generating frames');
    case 'model': {
      const m = modelList().find((x) => x.id === d.id);
      const opts = m ? durationOptions(m) : [];
      const ops = [{ op: 'shot.update', id: sid, modelId: d.id }];
      if (opts.length && !opts.includes(Number(shot.durationSec))) ops[0].durationSec = opts.reduce((best, o) => (Math.abs(o - shot.durationSec) < Math.abs(best - shot.durationSec) ? o : best), opts[0]);
      return ctx.ops(ops, 'Setting model');
    }
    case 'length': return ctx.ops([{ op: 'shot.update', id: sid, durationSec: Number(d.d) }], 'Setting length');
    case 'camera': return ctx.ops([{ op: 'shot.update', id: sid, presetId: d.id }], 'Setting camera');
    case 'next-step': view.local[sid] = d.to; return render();
    case 'generate':
    case 'redo':
      await flushBeforePaid();
      return ctx.generate('/generate', { shotIds: [sid], count: 1 }, 'Estimating');
    case 'take': return ctx.ops([{ op: 'take.select', shotId: sid, takeId: d.t }], 'Swapping take');
    case 'keep': return ctx.ops([{ op: 'shot.approve', id: sid }], 'Keeping');
    case 'unkeep': return ctx.ops([{ op: 'shot.unapprove', id: sid }], 'Unkeeping');
    case 'after-start': {
      const i = Number(d.i) || 0;
      const next = p.shots[i];
      if (!next) return;
      if (d.mode === 'chain') {
        const ops = [{ op: 'shot.update', id: next.id, chainFromPrevious: true }];
        if (next.storyboard || next.startImage) ops[0] = { ...ops[0], storyboard: '', startImage: '' };
        await ctx.ops(ops, 'Chaining');
      } else if (d.mode === 'new') {
        await ctx.ops([{ op: 'shot.update', id: next.id, chainFromPrevious: false }], 'Setting start');
      }
      return setShotIndex(i);
    }
    case 'render': return ctx.render();
    case 'approve-pending': return ctx.approve();
    case 'cancel-pending': return ctx.cancel();
    // Never send approved:true from here. The server gate answers with needsApproval, which fills
    // st.actPending; the shared approve row shows the real server price and is the only approve path.
    case 'run-approve': await flushBeforePaid(); return ctx.act('run', {}, 'Starting autopilot');
    default: return;
  }
}

const STUDIO_STYLE_ID = 'prom-vp-studio-style';
const STUDIO_CSS = `
.vps-scrim{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);opacity:0;transition:opacity .25s ease}
.vps-scrim.is-on{opacity:1}
.vps-sheet{position:fixed;z-index:9999;display:flex;flex-direction:column;gap:10px;overflow:hidden;color:var(--prom-text,currentColor);background:var(--prom-surface,#15161a);font-size:14px;line-height:1.4;box-sizing:border-box;padding:12px;transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.vps-sheet *{box-sizing:border-box}
.vps-sheet[data-vps-open]{transform:none}
@media (max-width:700px){
  .vps-sheet{inset:0;border-radius:0;transform:translateY(100%)}
  .vps-sheet[data-vps-open]{transform:none}
}
@media (min-width:701px){
  .vps-sheet{top:0;right:0;bottom:0;width:min(440px,46vw);border-radius:20px 0 0 20px;transform:translateX(100%);border-left:1px solid var(--prom-border,rgba(127,127,127,.25))}
}
.vps-top{display:flex;align-items:center;gap:8px;min-height:40px}
.vps-title{flex:1;min-width:0;display:flex;flex-direction:column;text-align:center}
.vps-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vps-icon-btn{min-width:40px;min-height:40px;border-radius:999px;border:0;background:var(--prom-surface-secondary,rgba(127,127,127,.12));color:inherit;font:inherit;font-size:18px;cursor:pointer;transition:background .25s ease}
.vps-icon-btn:disabled{opacity:.35;cursor:default}
.vps-muted{color:var(--prom-muted,#8a8a8a);font-size:12px}
.vps-shots{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 0 6px}
.vps-shot{position:relative;flex:none;width:72px;aspect-ratio:9/12;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));overflow:hidden;background:var(--prom-surface-secondary,rgba(127,127,127,.1));padding:0;scroll-snap-align:start;cursor:pointer;transition:border-color .25s ease}
.vps-shot.is-cur{border-color:var(--prom-accent,#ff7a1a);box-shadow:0 0 0 1px var(--prom-accent,#ff7a1a)}
.vps-thumb{display:block;width:100%;height:100%;object-fit:cover}
.vps-thumb.is-empty{background:var(--prom-surface-secondary,rgba(127,127,127,.1))}
.vps-shot-n{position:absolute;left:4px;bottom:4px;font-size:11px;padding:1px 6px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff}
.vps-shots .vps-badge{position:absolute;top:4px;right:4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:var(--prom-accent,#ff7a1a);color:#fff}
.vps-badge.is-ok{background:var(--prom-success,#2eaa5c)}
.vps-opt .vps-badge,.vps-badge.is-accent{flex:none;display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.02em;background:color-mix(in srgb,var(--prom-accent,#ff7a1a) 16%,transparent);color:var(--prom-accent,#ff7a1a)}
.vps-rail{display:flex;gap:6px;flex-wrap:wrap}
.vps-pill{min-height:28px;padding:4px 12px;border-radius:999px;font-size:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));color:var(--prom-muted,#8a8a8a);transition:all .25s ease}
.vps-pill.is-on{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff;font-weight:600}
.vps-pill.is-done{color:var(--prom-text,currentColor)}
.vps-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.vps-step{animation:vps-in .25s ease both;display:flex;flex-direction:column;gap:10px}
@keyframes vps-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.vps-h{margin:4px 0 0;font-size:15px;font-weight:600}
.vps-car{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px;scrollbar-width:none}
.vps-tile{position:relative;flex:0 0 min(62vw,220px);aspect-ratio:9/16;border-radius:16px;overflow:hidden;border:2px solid transparent;padding:0;background:var(--prom-surface-secondary,rgba(127,127,127,.1));scroll-snap-align:center;opacity:.5;transform:scale(.9);transition:transform .25s ease,opacity .25s ease,border-color .25s ease;cursor:pointer}
.vps-tile.is-active{opacity:1;transform:none;border-color:var(--prom-accent,#ff7a1a)}
.vps-tile img{width:100%;height:100%;object-fit:cover}
.vps-tag{position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px}
.vps-dots{display:flex;gap:6px;justify-content:center}
.vps-dot{width:6px;height:6px;border-radius:999px;background:var(--prom-border,rgba(127,127,127,.4))}
.vps-dot.is-on{background:var(--prom-accent,#ff7a1a)}
.vps-field{display:flex;gap:8px}
.vps-input,.vps-text{flex:1;min-height:40px;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface-secondary,rgba(127,127,127,.08));color:inherit;padding:8px 12px;font:inherit}
.vps-text{min-height:96px;resize:vertical}
.vps-btn{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface-secondary,rgba(127,127,127,.12));color:inherit;font:inherit;cursor:pointer;transition:background .25s ease,opacity .25s ease}
.vps-btn:disabled{opacity:.45;cursor:default}
.vps-btn.is-primary{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff;font-weight:600}
.vps-btn.is-wide{width:100%}
.vps-stack{flex-direction:column;align-items:stretch}
.vps-list{display:flex;flex-direction:column;gap:8px}
.vps-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:40px;padding:10px 12px;border-radius:16px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:var(--prom-surface,transparent);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .25s ease}
.vps-opt.is-on{border-color:var(--prom-accent,#ff7a1a)}
.vps-opt-main{display:flex;flex-direction:column}
.vps-chips{display:flex;gap:6px;flex-wrap:wrap}
.vps-chip{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--prom-border,rgba(127,127,127,.25));background:transparent;color:inherit;font:inherit;cursor:pointer;transition:all .25s ease}
.vps-chip.is-on{background:var(--prom-accent,#ff7a1a);border-color:transparent;color:#fff}
.vps-chip.is-static{min-height:0;height:30px;padding:0 12px;font-size:13px;cursor:default;color:var(--prom-muted,#8a8a8a);background:var(--prom-surface-secondary,rgba(127,127,127,.08));border-color:transparent}
.vps-sl{display:flex;gap:10px;align-items:center;padding:8px;border-radius:16px;border:1px solid var(--prom-border,rgba(127,127,127,.25))}
.vps-sl .vps-thumb{width:48px;height:64px;border-radius:10px;flex:none}
.vps-grow{flex:1;min-width:0}
.vps-opt-main small{margin-top:2px}
.vps-list{display:flex;flex-direction:column;gap:8px}
.vps-total{display:flex;align-items:baseline;gap:4px;margin:12px 0 4px}
.vps-btn.is-ghost{background:transparent;border-color:transparent;color:var(--prom-muted,#8a8a8a)}
.vps-approve{border:1px solid var(--prom-accent,#ff7a1a);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:8px}
.vps-player{display:block;width:100%;aspect-ratio:9/16;max-height:60vh;border-radius:16px;background:var(--prom-surface-secondary,rgba(127,127,127,.1));object-fit:contain}
.vps-wait,.vps-busy{display:flex;gap:8px;align-items:center;color:var(--prom-muted,#8a8a8a);font-size:12px}
.vps-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--prom-border,rgba(127,127,127,.3));border-top-color:var(--prom-accent,#ff7a1a);animation:vps-spin .8s linear infinite;flex:none}
@keyframes vps-spin{to{transform:rotate(360deg)}}
.vps-err{margin:0;color:var(--prom-danger,#e5484d);font-size:12px}
@media (prefers-reduced-motion:reduce){
  .vps-sheet,.vps-scrim,.vps-step,.vps-tile,.vps-shot,.vps-pill,.vps-chip,.vps-btn,.vps-opt,.vps-spin{transition:none!important;animation:none!important}
}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STUDIO_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STUDIO_STYLE_ID;
  style.textContent = STUDIO_CSS;
  document.head.appendChild(style);
}

function onKey(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); closeStudio(); }
}

function onSheetClick(ev) {
  const t = ev.target.closest?.('[data-vps]');
  if (!t || !sheet.contains(t) || t.disabled) return;
  if (busyNow() && !BUSY_OK.has(t.dataset.vps)) return;
  ev.preventDefault();
  void onAction(t);
}

function onSheetSubmit(ev) {
  const f = ev.target.closest?.('[data-vps-form]');
  if (!f) return;
  ev.preventDefault();
  if (busyNow()) return;
  const kind = f.dataset.vpsForm;
  const p = project();
  const shot = p?.shots?.[view.index];
  if (!shot) return;
  const input = f.querySelector('input');
  const text = String(input?.value || '').trim();
  if (!text) return;
  if (kind === 'edit-frame') {
    const cands = shot.storyboardCandidates || [];
    const active = Math.min(view.local[`cand:${shot.id}`] || 0, Math.max(0, cands.length - 1));
    void ctx.act('storyboard', { shotIds: [shot.id], count: 1, editFrom: cands[active], instruction: text }, 'Editing frame');
  } else if (kind === 'redo-note') {
    const next = `${shot.prompt || ''} ${text}`.trim();
    void ctx.ops([{ op: 'shot.update', id: shot.id, prompt: next }], 'Saving note')
      .then(() => ctx.generate('/generate', { shotIds: [shot.id], count: 1 }, 'Estimating'));
  }
}

function onSheetChange(ev) {
  const f = ev.target.closest?.('[data-vps-f]');
  if (!f || !sheet.contains(f)) return;
  const p = project();
  const shot = p?.shots?.[view.index];
  const field = f.dataset.vpsF;
  if (!shot || (field !== 'prompt' && field !== 'line')) return;
  void ctx.ops([{ op: 'shot.update', id: shot.id, [field]: f.value }], 'Saving');
}

/** Re-render the sheet when the card's project refreshes. Called by mountCard.paint(). */
export function refreshStudio() {
  if (!sheet || !ctx) return;
  if (!ctx.el?.isConnected) { closeStudio(); return; }
  if (sheet.contains(document.activeElement) && document.activeElement?.matches?.('input,textarea')) return;
  render();
}

export function isStudioOpenFor(id) {
  return !!sheet && ctx?.id === id;
}

/**
 * Open the studio sheet for a card. ctx = { id, el, h, getProject, getState, act, ops,
 * generate, route, render, approve, cancel, running, load }; the card owns all of it.
 */
export function openStudio(next, opts = {}) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  if (sheet) closeStudio();
  ctx = next;
  view = { index: 0, local: {}, routed: false, models: null, presets: null, pick: {}, plan: null };
  const p = project();
  if (opts.shotIndex != null) view.index = Number(opts.shotIndex) || 0;
  else if (p) { const cur = currentShotIndex(p); view.index = cur >= 0 ? cur : 0; }
  scrim = document.createElement('div');
  scrim.className = 'vps-scrim';
  sheet = document.createElement('div');
  sheet.className = 'vps-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Video studio');
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  scrim.addEventListener('click', closeStudio);
  // Keep focus in a prompt/line field when a sheet button is pressed: otherwise blur saves + repaints
  // and the button under the finger is replaced before 'click' lands (first tap dropped). The click
  // handler's flushBeforePaid() saves the field instead.
  sheet.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('button[data-vps]') && document.activeElement?.matches?.('[data-vps-f]') && sheet.contains(document.activeElement)) e.preventDefault();
  });
  sheet.addEventListener('click', onSheetClick);
  sheet.addEventListener('submit', onSheetSubmit);
  sheet.addEventListener('change', onSheetChange);
  keyHandler = onKey;
  document.addEventListener('keydown', keyHandler);
  render();
  requestAnimationFrame?.(() => { scrim?.classList.add('is-on'); sheet?.setAttribute('data-vps-open', ''); });
  void loadExtras();
}

export function closeStudio() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  const cb = ctx?.onClose;
  sheet?.remove(); scrim?.remove();
  sheet = null; scrim = null;
  if (typeof document !== 'undefined') document.body.style.overflow = prevOverflow;
  ctx = null;
  if (typeof cb === 'function') cb();
}

/** Close the sheet if its card left the DOM (called from the card's mutation hydrate pass). */
export function checkStudioCard() {
  if (sheet && ctx && ctx.el && !ctx.el.isConnected) closeStudio();
}
