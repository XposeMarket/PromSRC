/**
 * v2 sections for the video-project card: uploads, storyboard grid, inline
 * shot editing, audio (voice/voiceover/captions/music), QA chips, autopilot,
 * multi-aspect exports and hook A/B variants. Everything new goes through
 * POST /api/video-projects/:id/action and every new field is optional so the
 * card still works against older backends.
 *
 * Helpers (esc, iconBtn, mediaUrl, ...) are injected via `h` to avoid a
 * circular import with the main card module.
 */

const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON2 = {
  box: S('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  userPlus: S('<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0114-5"/><path d="M19 14v6M16 17h6"/>'),
  grid: S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  gauge: S('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1117 0"/>'),
  up: S('<path d="M18 15l-6-6-6 6"/>'),
  down: S('<path d="M6 9l6 6 6-6"/>'),
  minus: S('<path d="M5 12h14"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),
  share: S('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  split: S('<path d="M6 3v6a6 6 0 006 6h0a6 6 0 016 6"/><path d="M18 3v6a6 6 0 01-6 6"/>'),
  rocket: S('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3a12 12 0 0112-9 12 12 0 01-9 12z"/>'),
  download: S('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  check: S('<path d="M5 12l5 5L20 7"/>'),
  x: S('<path d="M18 6L6 18M6 6l12 12"/>'),
};

export const VOICES = {
  openai: ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  xai: ['ara', 'rex', 'sal', 'eve', 'leo'],
};
const CAPTION_STYLES = ['bold', 'pop', 'minimal', 'karaoke'];
const ASPECTS = ['9:16', '1:1', '16:9'];

// ── thumbnails (bug fix: never show the anchor while a take exists) ────
export function shotThumb(s, t, p, h) {
  const cls = 'vpc-thumb';
  if (t?.poster) return `<img class="${cls}" src="${h.esc(h.mediaUrl(t.poster))}" alt="" loading="lazy" decoding="async">`;
  if (t?.path && h.isVideo(t.path)) return `<video class="${cls}" src="${h.esc(h.mediaUrl(t.path))}#t=0.1" muted playsinline preload="metadata"></video>`;
  if (t?.path) return h.thumb(t.path, cls);
  if (s?.storyboard) return h.thumb(s.storyboard, cls);
  const cid = (s?.characterIds || [])[0];
  const c = (p?.characters || []).find((x) => x.id === cid) || (p?.characters || [])[0];
  return h.thumb((c?.anchors || [])[0], cls);
}

export function productBadge(c) {
  return c?.kind === 'product' ? '<span class="vpc-pill is-product">Product</span>' : '';
}

// ── models (cached once per page) ──────────────────────────────────────
let modelsPromise = null;
export function loadModels(h) {
  if (!modelsPromise) {
    modelsPromise = h.vpFetch('/action', { action: 'models' })
      .then((r) => (r?.models || []).filter((m) => !m.kind || m.kind === 'video'))
      .catch(() => { modelsPromise = null; return []; });
  }
  return modelsPromise;
}

// ── inline shot editor ─────────────────────────────────────────────────
export function shotEditor(s, i, total, st, h) {
  const sid = h.esc(s.id);
  const models = st.models || [];
  const cur = s.modelId || '';
  const opts = [`<option value="">Default model</option>`,
    ...models.map((m) => `<option value="${h.esc(m.id)}"${m.id === cur ? ' selected' : ''}>${h.esc(m.label || m.id)}${m.price != null ? ` · ${h.esc(typeof m.price === 'number' ? h.usd(m.price) : m.price)}` : ''}</option>`)];
  if (cur && !models.some((m) => m.id === cur)) opts.push(`<option value="${h.esc(cur)}" selected>${h.esc(cur)}</option>`);
  return `<div class="vpc-edit">
    <label class="vpc-field"><span>Prompt</span>
      <textarea rows="3" data-vpf="prompt" data-s="${sid}">${h.esc(s.prompt || '')}</textarea></label>
    <label class="vpc-field"><span>Voiceover line</span>
      <textarea rows="2" data-vpf="line" data-s="${sid}" placeholder="Spoken line for this shot">${h.esc(s.line || '')}</textarea></label>
    <div class="vpc-row vpc-wrap">
      <div class="vpc-stepper" role="group" aria-label="Duration">
        ${h.iconBtn('dur', ICON2.minus, 'Shorter', `data-s="${sid}" data-d="-1" ${Number(s.durationSec) <= 1 ? 'disabled' : ''}`)}
        <span>${Number(s.durationSec) || 0}s</span>
        ${h.iconBtn('dur', ICON2.plus, 'Longer', `data-s="${sid}" data-d="1"`)}
      </div>
      <select class="vpc-select" data-vpf="modelId" data-s="${sid}" aria-label="Model">${opts.join('')}</select>
      <span class="vpc-grow"></span>
      ${h.iconBtn('move', ICON2.up, 'Move up', `data-s="${sid}" data-i="${i - 1}" ${i === 0 ? 'disabled' : ''}`)}
      ${h.iconBtn('move', ICON2.down, 'Move down', `data-s="${sid}" data-i="${i + 1}" ${i >= total - 1 ? 'disabled' : ''}`)}
      ${(s.takes || []).length >= 2 ? h.iconBtn('variants', ICON2.split, 'Render hook variants (one export per take)', `data-s="${sid}"`) : ''}
    </div>
    ${s.voiceover?.path ? `<audio class="vpc-audio" src="${h.esc(h.mediaUrl(s.voiceover.path))}" controls preload="none"></audio>` : ''}
  </div>`;
}

// ── QA chip ─────────────────────────────────────────────────────────────
export function qaChip(tk, h) {
  const q = tk?.qa;
  if (!q || q.score == null) return '';
  const n = Number(q.score);
  const lvl = n >= 7 ? 'good' : n >= 5 ? 'warn' : 'bad';
  const tip = [`QA ${n}/10${q.verdict ? ` · ${q.verdict}` : ''}${q.model ? ` · ${q.model}` : ''}`, ...(q.issues || [])].join('\n');
  return `<span class="vpc-qa is-${lvl}" title="${h.esc(tip)}" aria-label="${h.esc(tip)}">${n}</span>`;
}

// ── storyboard grid ─────────────────────────────────────────────────────
export function storyboardSection(p, h) {
  const shots = p.shots || [];
  if (!shots.some((s) => s.storyboard || (s.storyboardCandidates || []).length)) return '';
  const pendingAny = shots.some((s) => !s.storyboard && (s.storyboardCandidates || []).length);
  const tiles = shots.map((s, i) => {
    const sid = h.esc(s.id);
    const cand = (s.storyboardCandidates || []).find((c) => c !== s.storyboard);
    const rel = s.storyboard || cand;
    if (!rel) return `<div class="vpc-sb is-empty"><span class="vpc-sb-n">${i + 1}</span></div>`;
    const acts = !s.storyboard && cand ? `<div class="vpc-tile-actions">
        ${h.iconBtn('sb-approve', ICON2.check, 'Approve storyboard', `data-s="${sid}" data-path="${h.esc(cand)}"`, 'is-go')}
        ${h.iconBtn('sb-reject', ICON2.x, 'Reject storyboard', `data-s="${sid}" data-path="${h.esc(cand)}"`)}
      </div>` : `<span class="vpc-badge">${ICON2.check}</span>`;
    return `<div class="vpc-sb${s.storyboard ? ' is-approved' : ''}">
      <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${h.esc(rel)}" aria-label="View storyboard ${i + 1}">${h.thumb(rel, 'vpc-tile-img')}</button>
      <span class="vpc-sb-n">${i + 1}</span>${acts}</div>`;
  }).join('');
  return `<section class="vpc-sec"><h4>Storyboard</h4><div class="vpc-sbgrid">${tiles}</div>
    ${pendingAny ? `<button type="button" class="vpc-btn is-primary is-wide" data-vpa="sb-approve-all">${ICON2.check}<span>Approve all</span></button>` : ''}
  </section>`;
}

// ── audio ───────────────────────────────────────────────────────────────
export function audioSection(p, st, h) {
  if (!(p.shots || []).length) return '';
  const v = p.voice || {};
  const prov = v.provider || 'openai';
  const voiceOpts = Object.entries(VOICES).map(([pv, list]) => `<optgroup label="${pv === 'xai' ? 'xAI' : 'OpenAI'}">${
    list.map((n) => `<option value="${pv}:${n}"${pv === prov && n === v.voice ? ' selected' : ''}>${n}</option>`).join('')}</optgroup>`).join('');
  const cap = p.captions || {};
  const mus = p.music || null;
  const musKey = mus ? (/chill/i.test(mus.label || mus.path || '') ? 'chill' : /pulse/i.test(mus.label || mus.path || '') ? 'pulse' : 'custom') : 'none';
  const hasLines = (p.shots || []).some((s) => s.line);
  const vol = Math.round((mus?.volume ?? 0.3) * 100);
  const native = (p.audioMode || 'voiceover') === 'native';
  const modeRow = `<div class="vpc-row vpc-wrap" role="radiogroup" aria-label="Who speaks the lines">
      <span class="vpc-muted">Speech</span>
      ${[['native', 'On camera', 'The creator speaks each line in the clip; captions transcribe the clip audio'], ['voiceover', 'Narrator', 'TTS voiceover over dialogue-free clips; captions follow the voiceover']]
        .map(([k, l, tip]) => `<button type="button" class="vpc-chip${(native ? 'native' : 'voiceover') === k ? ' is-on' : ''}" data-vpa="audio-mode" data-v="${k}" role="radio" aria-checked="${(native ? 'native' : 'voiceover') === k}" title="${tip}">${l}</button>`).join('')}
    </div>`;
  return `<section class="vpc-sec vpc-audio-sec"><h4>Audio</h4>
    ${modeRow}
    ${native
      ? `<div class="vpc-row vpc-wrap"><button type="button" class="vpc-btn" data-vpa="transcribe" title="Re-read what each clip says for captions">${ICON2.mic}<span>Transcribe clips</span></button></div>`
      : `<div class="vpc-row vpc-wrap">
      ${ICON2.mic}
      <select class="vpc-select" data-vpf="voice" aria-label="Voice">${v.voice ? '' : '<option value="" selected>Pick a voice</option>'}${voiceOpts}</select>
      <button type="button" class="vpc-btn" data-vpa="voiceover" ${hasLines ? '' : 'disabled title="Add voiceover lines to shots first"'}>${ICON2.mic}<span>Voiceover</span></button>
    </div>`}
    <div class="vpc-row vpc-wrap">
      <label class="vpc-switch"><input type="checkbox" data-vpf="captions"${cap.enabled ? ' checked' : ''}><span>Captions</span></label>
      ${CAPTION_STYLES.map((s) => `<button type="button" class="vpc-chip${(cap.style || 'bold') === s && cap.enabled ? ' is-on' : ''}" data-vpa="cap-style" data-v="${s}" aria-pressed="${(cap.style || 'bold') === s && !!cap.enabled}">${s}</button>`).join('')}
      ${cap.cues?.length ? `<span class="vpc-muted">${cap.cues.length} cues</span>` : ''}
    </div>
    <div class="vpc-row vpc-wrap">
      <span class="vpc-muted">Music</span>
      ${[['pulse', 'Pulse'], ['chill', 'Chill'], ['none', 'None']].map(([k, l]) => `<button type="button" class="vpc-chip${musKey === k ? ' is-on' : ''}" data-vpa="music" data-v="${k}" aria-pressed="${musKey === k}">${l}</button>`).join('')}
      ${musKey === 'custom' ? `<span class="vpc-chip is-on">${h.esc(mus.label || 'Custom')}</span>` : ''}
      ${mus ? `<input class="vpc-range" type="range" min="0" max="100" value="${vol}" data-vpf="volume" aria-label="Music volume" title="Music volume ${vol}%">` : ''}
    </div>
  </section>`;
}

// ── autopilot + generic action approvals ───────────────────────────────
export function autopilotSection(p, st, h) {
  const parts = [];
  const lr = p.lastRun;
  if (lr?.steps?.length) {
    parts.push(`<ol class="vpc-steps">${lr.steps.map((s) => `<li class="is-${h.esc(s.state)}" title="${h.esc(s.note || s.state)}"><span class="vpc-dot"></span>${h.esc(s.step)}${s.note ? ` <small class="vpc-muted">${h.esc(String(s.note).slice(0, 80))}</small>` : ''}</li>`).join('')}</ol>`);
  }
  const ap = st.actPending || (lr?.needsApproval ? { action: 'run', args: {}, usd: lr.needsApproval.usd, breakdown: lr.needsApproval.breakdown } : null);
  if (ap) {
    const lines = (ap.breakdown || []).map((b) => `<li>${h.esc(b.item)} · ${h.usd(b.usd)}</li>`).join('');
    parts.push(`<div class="vpc-approve">
      <strong>${ap.action === 'storyboard' ? 'Storyboard' : ap.action === 'run' ? 'Autopilot' : h.esc(ap.action)} needs approval · ${h.usd(ap.usd)}</strong>
      ${lines ? `<ul>${lines}</ul>` : ''}
      <div class="vpc-row">
        <button type="button" class="vpc-btn is-primary" data-vpa="act-approve">${ICON2.check}<span>Approve ${h.usd(ap.usd)}</span></button>
        ${h.iconBtn('act-cancel', ICON2.x, 'Cancel')}
      </div></div>`);
  }
  if ((p.shots || []).length) {
    parts.push(`<button type="button" class="vpc-btn is-primary is-wide" data-vpa="run-all" ${st.busy ? 'disabled' : ''}>${ICON2.rocket}<span>Run all</span></button>`);
  }
  return parts.length ? `<section class="vpc-sec"><h4>Autopilot</h4>${parts.join('')}</section>` : '';
}

// ── exports ─────────────────────────────────────────────────────────────
export function exportsSection(p, st, h) {
  const ex = (p.exports || []).slice().reverse();
  const chips = ASPECTS.map((a) => `<button type="button" class="vpc-chip${st.aspects.has(a) ? ' is-on' : ''}" data-vpa="aspect" data-v="${a}" aria-pressed="${st.aspects.has(a)}">${a}</button>`).join('');
  const list = ex.slice(0, 6).map((e) => {
    const url = h.mediaUrl(e.path);
    const label = [e.aspect, e.variant ? `variant ${e.variant}` : '', `${Number(e.durationSec || 0).toFixed(1)}s`].filter(Boolean).join(' · ');
    return `<div class="vpc-export">
      <video src="${h.esc(url)}" controls playsinline preload="metadata"></video>
      <div class="vpc-row"><span class="vpc-muted">${h.esc(label)}</span><span class="vpc-grow"></span>
        <a class="vpc-icon" href="${h.esc(url)}" download="${h.esc(String(e.path).split('/').pop())}" title="Download" aria-label="Download">${ICON2.download}</a>
        ${h.iconBtn('share', ICON2.share, 'Share', `data-path="${h.esc(e.path)}"`)}
      </div></div>`;
  }).join('');
  return `<section class="vpc-sec"><h4>Exports</h4>
    <div class="vpc-row vpc-wrap"><span class="vpc-muted">Aspects</span>${chips}</div>
    ${list ? `<div class="vpc-exports">${list}</div>` : ''}</section>`;
}

// ── file upload ─────────────────────────────────────────────────────────
export function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ filename: f.name, dataBase64: String(r.result || '').replace(/^data:[^,]*,/, '') });
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

export async function shareExport(rel, h) {
  let url = h.mediaUrl(rel);
  try { url = new URL(url, location.href).href; } catch { /* keep */ }
  if (navigator.share) {
    try { await navigator.share({ title: 'Video', url }); return 'Shared'; } catch { return ''; }
  }
  try { await navigator.clipboard.writeText(url); return 'Link copied'; } catch { return 'Copy failed'; }
}

/**
 * Handle v2 click actions. Returns true if handled.
 * ctx: { st, d, act(action,args,label), ops(list,label), paint, h }
 */
export async function handleV2Click(a, ctx) {
  const { st, d, act, ops, paint, h } = ctx;
  const p = st.project || {};
  const shot = (sid) => (p.shots || []).find((s) => s.id === sid);
  switch (a) {
    case 'upload-product': case 'upload-character': {
      const file = await pickImage();
      if (!file) return true;
      await act('import_asset', { ...file, role: a === 'upload-product' ? 'product' : 'character', name: file.filename.replace(/\.[^.]+$/, '') }, 'Uploading');
      return true;
    }
    case 'storyboard': await act('storyboard', {}, 'Storyboarding'); return true;
    case 'sb-approve': await ops([{ op: 'shot.approveStoryboard', id: d.s, path: d.path }], 'Approving storyboard'); return true;
    case 'sb-reject': await ops([{ op: 'shot.rejectStoryboard', id: d.s, path: d.path }], 'Rejecting'); return true;
    case 'sb-approve-all': {
      const list = (p.shots || []).filter((s) => !s.storyboard && (s.storyboardCandidates || []).length)
        .map((s) => ({ op: 'shot.approveStoryboard', id: s.id, path: s.storyboardCandidates[0] }));
      if (list.length) await ops(list, 'Approving storyboard');
      return true;
    }
    case 'dur': {
      const s = shot(d.s);
      if (!s) return true;
      const n = Math.max(1, Math.min(30, (Number(s.durationSec) || 5) + Number(d.d)));
      await ops([{ op: 'shot.update', id: d.s, durationSec: n }], 'Saving');
      return true;
    }
    case 'move': await ops([{ op: 'shot.move', id: d.s, index: Number(d.i) }], 'Reordering'); return true;
    case 'variants': await act('render_variants', { shotId: d.s }, 'Rendering hook variants', 15 * 60 * 1000); return true;
    case 'qa': await act('qa', {}, 'Scoring takes', 5 * 60 * 1000); return true;
    case 'voiceover': await act('voiceover', {}, 'Recording voiceover', 5 * 60 * 1000); return true;
    case 'audio-mode': await ops([{ op: 'project.update', audioMode: d.v }], d.v === 'native' ? 'Using on-camera dialogue' : 'Using a narrator'); return true;
    case 'transcribe': {
      const r = await act('transcribe', { force: true }, 'Transcribing clips', 5 * 60 * 1000);
      if (r && p.captions?.enabled) await act('captions', { style: p.captions.style }, 'Rebuilding captions');
      return true;
    }
    case 'cap-style': {
      const style = d.v;
      const r = await act('captions', { style }, 'Building captions');
      if (r) await ops([{ op: 'captions.set', enabled: true, style }], 'Saving captions');
      return true;
    }
    case 'music': {
      if (d.v === 'none') await ops([{ op: 'music.clear' }], 'Removing music');
      else await act('music', { builtin: d.v }, 'Adding music');
      return true;
    }
    case 'run-all': await act('run', {}, 'Running autopilot', 30 * 60 * 1000); return true;
    case 'act-approve': {
      const ap = st.actPending || (p.lastRun?.needsApproval ? { action: 'run', args: {} } : null);
      st.actPending = null;
      if (ap) await act(ap.action, { ...(ap.args || {}), approved: true }, 'Submitting', 30 * 60 * 1000);
      return true;
    }
    case 'act-cancel': st.actPending = null; if (p.lastRun) p.lastRun.needsApproval = undefined; paint(); return true;
    case 'aspect': { if (st.aspects.has(d.v)) st.aspects.delete(d.v); else st.aspects.add(d.v); paint(); return true; }
    case 'share': { const msg = await shareExport(d.path, h); if (msg) { st.error = ''; st.busy = ''; st.toast = msg; paint(); } return true; }
    default: return false;
  }
}

/** Handle change events from [data-vpf] fields. */
export async function handleV2Change(f, ctx) {
  const { d, ops, value, checked, st } = ctx;
  switch (f) {
    case 'prompt': case 'line': case 'modelId': {
      const s = (st.project?.shots || []).find((x) => x.id === d.s);
      if (s && String(s[f] || '') === value) return;
      await ops([{ op: 'shot.update', id: d.s, [f]: value }], 'Saving');
      return;
    }
    case 'voice': {
      const [provider, voice] = String(value).split(':');
      if (voice) await ops([{ op: 'voice.set', provider, voice }], 'Setting voice');
      return;
    }
    case 'captions': {
      const style = st.project?.captions?.style || 'bold';
      if (checked && !(st.project?.captions?.cues || []).length) await ctx.act('captions', { style }, 'Building captions');
      await ops([{ op: 'captions.set', enabled: !!checked, style }], 'Saving captions');
      return;
    }
    case 'volume': {
      const m = st.project?.music;
      if (m?.path) await ops([{ op: 'music.set', path: m.path, volume: Number(value) / 100, duck: m.duck !== false }], 'Saving');
      return;
    }
    default:
  }
}

export const V2_CSS = `
.prom-vp-card .vpc-icon{min-width:36px;min-height:36px}
.prom-vp-card a.vpc-icon{display:inline-flex;align-items:center;justify-content:center;color:inherit}
.prom-vp-card .vpc-btn{min-height:36px}
.prom-vp-card .vpc-wrap{flex-wrap:wrap}
.prom-vp-card .vpc-pill{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--vpc-line);color:var(--vpc-muted)}
.prom-vp-card .vpc-pill.is-product{color:var(--vpc-accent);border-color:var(--vpc-accent)}
.prom-vp-card .vpc-edit{display:flex;flex-direction:column;gap:8px;margin:6px 0 8px}
.prom-vp-card .vpc-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--vpc-muted)}
.prom-vp-card .vpc-field textarea,.prom-vp-card .vpc-select{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--vpc-text);background:var(--vpc-soft);border:1px solid var(--vpc-line);border-radius:9px;padding:7px 9px;resize:vertical}
.prom-vp-card .vpc-select{width:auto;max-width:100%;min-height:36px;flex:1 1 140px}
.prom-vp-card .vpc-stepper{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--vpc-line);border-radius:10px;padding:0 2px}
.prom-vp-card .vpc-stepper span{min-width:28px;text-align:center;font-size:13px}
.prom-vp-card .vpc-stepper .vpc-icon{border:0;background:transparent}
.prom-vp-card .vpc-audio{width:100%;height:36px}
.prom-vp-card .vpc-qa{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;cursor:help}
.prom-vp-card .vpc-qa.is-good{background:var(--prom-success,#2f9e44)}
.prom-vp-card .vpc-qa.is-warn{background:var(--prom-warning,#d9822b)}
.prom-vp-card .vpc-qa.is-bad{background:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-sbgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.prom-vp-card .vpc-sb{position:relative;aspect-ratio:9/16;max-height:200px;border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden;background:var(--vpc-soft)}
.prom-vp-card .vpc-sb.is-approved{border-color:var(--vpc-accent)}
.prom-vp-card .vpc-sb .vpc-tile-media{display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:pointer}
.prom-vp-card .vpc-sb .vpc-tile-img{width:100%;height:100%;object-fit:cover;display:block}
.prom-vp-card .vpc-sb-n{position:absolute;top:4px;left:4px;font-size:11px;font-weight:700;padding:0 6px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff}
.prom-vp-card .vpc-sb .vpc-tile-actions{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:4px;padding:4px;background:rgba(0,0,0,.45)}
.prom-vp-card .vpc-sb .vpc-badge{position:absolute;top:4px;right:4px}
.prom-vp-card .vpc-chip{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--vpc-line);background:transparent;color:var(--vpc-text);font:inherit;font-size:12px;text-transform:capitalize;cursor:pointer}
.prom-vp-card .vpc-chip.is-on{border-color:var(--vpc-accent);color:var(--vpc-accent);font-weight:600}
.prom-vp-card .vpc-switch{display:inline-flex;align-items:center;gap:6px;min-height:36px;font-size:13px;cursor:pointer}
.prom-vp-card .vpc-switch input{width:18px;height:18px;accent-color:var(--vpc-accent)}
.prom-vp-card .vpc-range{flex:1 1 120px;min-height:36px;accent-color:var(--vpc-accent)}
.prom-vp-card .vpc-audio-sec .vpc-row+.vpc-row{margin-top:6px}
.prom-vp-card .vpc-steps{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:3px;font-size:12px}
.prom-vp-card .vpc-steps li{display:flex;gap:6px;align-items:center}
.prom-vp-card .vpc-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--vpc-muted)}
.prom-vp-card .vpc-steps .is-done .vpc-dot{background:var(--prom-success,#2f9e44)}
.prom-vp-card .vpc-steps .is-failed .vpc-dot{background:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-steps .is-needs_approval .vpc-dot{background:var(--prom-warning,#d9822b)}
.prom-vp-card .vpc-steps .is-skipped{color:var(--vpc-muted)}
.prom-vp-card .vpc-exports{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
.prom-vp-card .vpc-export{border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden}
.prom-vp-card .vpc-export video{display:block;width:100%;max-height:260px;background:#000}
.prom-vp-card .vpc-export .vpc-row{padding:2px 6px}
.prom-vp-card .vpc-toast{padding:6px 12px;font-size:12px;color:var(--vpc-accent);border-bottom:1px solid var(--vpc-line)}
@media (max-width:420px){.prom-vp-card .vpc-tools{flex-wrap:wrap;justify-content:flex-end;max-width:50%}}
`;
