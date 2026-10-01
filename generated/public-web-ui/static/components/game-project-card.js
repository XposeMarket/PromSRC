/**
 * Live game-project card for chat (desktop + phone).
 *
 *   ```game-project
 *   {"projectId":"gp_abc123"}
 *   ```
 * renderMd (utils.js) turns it into <div class="prom-gp-card" data-gp-project>
 * and this module hydrates it from /api/game-projects: stage stepper, design
 * summary, asset grid (approve/reject/reroll), cost approval, audio, and an
 * embedded playable preview once the build exists.
 */

const STYLE_ID = 'prom-gp-card-style';
const CARD_SEL = '.prom-gp-card[data-gp-project]:not([data-gp-mounted])';
const STAGES = ['design', 'art', 'audio', 'code', 'playable', 'published'];

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  pad: I('<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>'),
  check: I('<path d="M5 12l5 5L20 7"/>'),
  x: I('<path d="M18 6L6 18M6 6l12 12"/>'),
  reroll: I('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  spark: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  play: I('<path d="M7 4v16l13-8z"/>'),
  stop: I('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  ext: I('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5"/>'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  music: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  wand: I('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>'),
  code: I('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
  rocket: I('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>'),
  phone: I('<rect x="7" y="2" width="10" height="20" rx="2"/>'),
};

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function usd(n) { return `$${(Number(n) || 0).toFixed(2)}`; }

function mediaUrl(id, rel, version) {
  const p = String(rel || '').trim();
  if (!p) return '';
  const resolver = typeof window !== 'undefined' ? window.__promResolveWorkspaceMediaUrl : null;
  if (typeof resolver === 'function') {
    try { const u = resolver(p); if (u) return String(u); } catch { /* fall through */ }
  }
  return `/api/canvas/inline?path=${encodeURIComponent(p)}${version ? `&v=${version}` : ''}`;
}

function playUrl(id) {
  const base = typeof window !== 'undefined' && typeof window.__promGatewayBase === 'string' ? window.__promGatewayBase.replace(/\/$/, '') : '';
  return `${base}/api/game-projects/${encodeURIComponent(id)}/play/`;
}

async function gpFetch(path, body, timeoutMs = 30000) {
  const opts = { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs };
  const url = `/api/game-projects${path}`;
  const f = window.__promVideoProjectFetch || window.api;
  let res;
  if (typeof f === 'function') res = await f(url, opts);
  else {
    const r = await fetch(url, opts);
    res = await r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }));
  }
  if (res && res.success === false) throw new Error(res.error || 'Request failed');
  return res;
}

function iconBtn(action, icon, label, attrs = '', cls = '') {
  return `<button type="button" class="gpc-icon${cls ? ` ${cls}` : ''}" data-gpa="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${attrs}>${icon}</button>`;
}

function mountCard(el) {
  el.dataset.gpMounted = '1';
  const id = String(el.dataset.gpProject || '');
  const st = { project: null, error: '', busy: '', pending: null, timer: 0, playing: null, portrait: false, showPlay: true };

  const isVisual = (a) => a.kind !== 'sfx' && a.kind !== 'music';
  const generating = () => (st.project?.assets || []).some((a) => a.status === 'generating');

  async function load() {
    try { const r = await gpFetch(`/${encodeURIComponent(id)}`); st.project = r.project; st.error = ''; }
    catch (e) { st.error = String(e?.message || e); }
    render();
    schedule();
  }
  function schedule() {
    clearTimeout(st.timer);
    if (!el.isConnected) return;
    if (generating() || st.busy) st.timer = setTimeout(load, 3000);
  }
  async function act(action, args = {}) {
    st.busy = action; st.error = ''; render();
    try {
      const r = await gpFetch(`/${encodeURIComponent(id)}/action`, { action, ...args });
      if (r.needsApproval || r.blocked) st.pending = { action, args, usd: r.usd, reason: r.reason, blocked: !!r.blocked, estimate: r.estimate };
      else st.pending = null;
      if (action === 'publish' && r.note) st.error = r.note;
    } catch (e) { st.error = String(e?.message || e); }
    st.busy = '';
    await load();
  }

  function stepper(p) {
    const cur = STAGES.indexOf(p.stage);
    return `<ol class="gpc-steps">${STAGES.map((s, i) => `<li class="${i < cur ? 'is-done' : i === cur ? 'is-cur' : ''}"><span class="gpc-dot"></span><span class="gpc-step-l">${s}</span></li>`).join('')}</ol>`;
  }

  function designSec(p) {
    const d = p.design || {};
    const rows = [['Setting', d.setting], ['Controls', d.controls], ['Core loop', d.coreLoop], ['Win/lose', d.winLose], ['Engine', d.engine]]
      .filter(([, v]) => v).map(([k, v]) => `<div class="gpc-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
    const answered = (p.questions || []).filter((q) => q.answer);
    const open = (p.questions || []).filter((q) => !q.answer).length;
    return `<div class="gpc-sec"><h4>${ICON.wand} Design</h4>${p.pitch ? `<p class="gpc-pitch">${esc(p.pitch)}</p>` : ''}${rows}
      ${answered.length ? `<div class="gpc-answers">${answered.map((q) => `<span class="gpc-chip" title="${esc(q.q)}">${esc(q.answer)}</span>`).join('')}</div>` : ''}
      ${open ? `<div class="gpc-muted">${open} design question${open > 1 ? 's' : ''} still open</div>` : ''}</div>`;
  }

  function assetSec(p) {
    const vis = (p.assets || []).filter(isVisual);
    if (!vis.length) return `<div class="gpc-sec"><h4>${ICON.spark} Art</h4><div class="gpc-row"><span class="gpc-muted gpc-grow">No asset plan yet.</span>${iconBtn('plan', ICON.wand, 'Plan assets for this genre', st.busy ? 'disabled' : '', 'is-go')}</div></div>`;
    const todo = vis.filter((a) => ['planned', 'rejected', 'failed'].includes(a.status)).length;
    const tiles = vis.map((a) => {
      const img = a.path ? `<img src="${esc(mediaUrl(id, a.path, p.version))}" alt="${esc(a.name)}" loading="lazy" class="${a.transparent ? 'is-alpha' : ''}">` : `<span class="gpc-ph">${a.status === 'generating' ? '<span class="gpc-spin"></span>' : ICON.spark}</span>`;
      const can = a.path && a.status !== 'generating';
      return `<div class="gpc-tile is-${esc(a.status)}" title="${esc(a.prompt)}">
        <div class="gpc-img">${img}</div>
        <div class="gpc-tile-foot"><span class="gpc-tname">${esc(a.name)}</span><span class="gpc-badge">${esc(a.status)}</span></div>
        <div class="gpc-tile-acts">
          ${iconBtn('approve', ICON.check, `Approve ${a.name}`, `data-asset="${esc(a.id)}" ${can && a.status !== 'approved' ? '' : 'disabled'}`, 'is-go')}
          ${iconBtn('reject', ICON.x, `Reject ${a.name}`, `data-asset="${esc(a.id)}" ${a.status === 'generating' || a.status === 'rejected' ? 'disabled' : ''}`)}
          ${iconBtn('reroll', ICON.reroll, `Reroll ${a.name} (paid)`, `data-asset="${esc(a.id)}" ${a.status === 'generating' ? 'disabled' : ''}`)}
        </div></div>`;
    }).join('');
    const spent = p.budget?.spentUsd || 0;
    const cap = p.budget?.capUsd;
    const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;
    const pend = st.pending;
    return `<div class="gpc-sec"><h4>${ICON.spark} Art <span class="gpc-muted">${vis.filter((a) => a.status === 'approved').length}/${vis.length} approved</span></h4>
      <div class="gpc-grid">${tiles}</div>
      <div class="gpc-cost">
        <div class="gpc-row"><span class="gpc-grow gpc-muted">Spent ${usd(spent)}${cap ? ` of ${usd(cap)} cap` : ''} · auto-approve ${usd(p.budget?.autoApproveUsd)}</span>
        ${todo ? iconBtn('generate', ICON.spark, `Generate ${todo} asset(s)`, st.busy || generating() ? 'disabled' : '', 'is-go') : ''}</div>
        ${cap ? `<div class="gpc-bar"><span style="width:${pct.toFixed(1)}%"></span></div>` : ''}
        ${pend ? `<div class="gpc-approve ${pend.blocked ? 'is-blocked' : ''}"><span class="gpc-grow">${esc(pend.reason || '')}</span>
          ${pend.blocked ? '' : `<button type="button" class="gpc-go" data-gpa="approve-cost">${ICON.check}<span>Approve &amp; generate ${usd(pend.usd)}</span></button>`}
          ${iconBtn('dismiss', ICON.x, 'Dismiss')}</div>` : ''}
      </div></div>`;
  }

  function audioSec(p) {
    const aud = (p.assets || []).filter((a) => !isVisual(a));
    const list = aud.map((a) => `<div class="gpc-aud">${iconBtn(st.playing === a.id ? 'stop' : 'listen', st.playing === a.id ? ICON.stop : ICON.play, `${st.playing === a.id ? 'Stop' : 'Play'} ${a.name}`, `data-asset="${esc(a.id)}" data-src="${esc(mediaUrl(id, a.path, p.version))}"`)}<span class="gpc-grow">${esc(a.name)}</span><span class="gpc-muted">${a.durationSec ? `${Number(a.durationSec).toFixed(1)}s` : ''}</span></div>`).join('');
    return `<div class="gpc-sec"><h4>${ICON.music} Audio</h4>${list || '<div class="gpc-muted">No audio yet (free, generated locally).</div>'}
      <div class="gpc-row gpc-mt">${iconBtn('sfx', ICON.spark, 'Generate sound effects (free)', st.busy ? 'disabled' : '')}${iconBtn('music', ICON.music, 'Generate music bed (free)', st.busy ? 'disabled' : '')}${iconBtn('scaffold', ICON.code, 'Write playable scaffold', st.busy ? 'disabled' : '')}</div></div>`;
  }

  function playSec(p) {
    if (STAGES.indexOf(p.stage) < STAGES.indexOf('playable')) return '';
    const url = p.publish?.url || playUrl(id);
    return `<div class="gpc-sec"><h4>${ICON.pad} Play</h4>
      <div class="gpc-row gpc-mb"><span class="gpc-grow gpc-muted gpc-url">${esc(url)}</span>
        ${iconBtn('orient', ICON.phone, st.portrait ? 'Landscape preview' : 'Portrait preview')}
        ${iconBtn('reload', ICON.refresh, 'Reload game')}
        ${iconBtn('open', ICON.ext, 'Open in new tab', `data-url="${esc(url)}"`)}
        ${iconBtn('copy', ICON.copy, 'Copy link', `data-url="${esc(url)}"`)}
        ${iconBtn('publish', ICON.rocket, p.publish?.url ? 'Republish' : 'Publish', st.busy ? 'disabled' : '', 'is-go')}</div>
      <div class="gpc-frame ${st.portrait ? 'is-portrait' : ''}"><iframe src="${esc(playUrl(id))}" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen; gamepad" loading="lazy" title="${esc(p.title)}"></iframe></div>
      ${p.publish?.note ? `<div class="gpc-muted gpc-mt">${esc(p.publish.note)}</div>` : ''}</div>`;
  }

  function render() {
    const p = st.project;
    if (!p) { el.innerHTML = `<div class="gpc"><div class="gpc-head"><span class="gpc-kicker">${ICON.pad} Game</span><span class="gpc-muted">${esc(st.error || 'Loading…')}</span></div></div>`; return; }
    const d = p.design || {};
    const frame = el.querySelector('.gpc-frame iframe');
    const keepFrame = frame && STAGES.indexOf(p.stage) >= STAGES.indexOf('playable') ? frame : null;
    el.innerHTML = `<div class="gpc">
      <div class="gpc-head"><div class="gpc-headtext">
        <span class="gpc-kicker">${ICON.pad} Game project${st.busy ? ` · ${esc(st.busy)}…` : ''}</span>
        <strong class="gpc-title">${esc(p.title)}</strong>
        <div class="gpc-row"><span class="gpc-chip">${esc(d.genre)}</span><span class="gpc-chip">${esc(d.style)}</span>${d.multiplayer ? '<span class="gpc-chip">multiplayer</span>' : ''}</div>
      </div>${iconBtn('refresh', ICON.refresh, 'Refresh')}</div>
      ${stepper(p)}
      ${st.error ? `<div class="gpc-err">${esc(st.error)}</div>` : ''}
      ${designSec(p)}${assetSec(p)}${audioSec(p)}${playSec(p)}
    </div>`;
    // Keep a running game alive across re-renders (poll ticks).
    if (keepFrame) { const slot = el.querySelector('.gpc-frame iframe'); if (slot) slot.replaceWith(keepFrame); }
  }

  let audioEl = null;
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-gpa]');
    if (!b || b.disabled) return;
    ev.preventDefault();
    const a = b.dataset.gpa;
    const asset = b.dataset.asset;
    if (a === 'refresh') return load();
    if (a === 'plan') return act('plan_assets');
    if (a === 'generate') return act('generate_assets');
    if (a === 'approve') return act('approve_asset', { assetId: asset });
    if (a === 'reject') return act('reject_asset', { assetId: asset });
    if (a === 'reroll') return act('reroll_asset', { assetId: asset });
    if (a === 'approve-cost' && st.pending) return act(st.pending.action, { ...st.pending.args, approved: true });
    if (a === 'dismiss') { st.pending = null; return render(); }
    if (a === 'sfx') return act('sfx', { force: true });
    if (a === 'music') return act('music', { force: true });
    if (a === 'scaffold') return act('scaffold');
    if (a === 'publish') return act('publish');
    if (a === 'orient') { st.portrait = !st.portrait; const f = el.querySelector('.gpc-frame'); if (f) f.classList.toggle('is-portrait', st.portrait); b.title = st.portrait ? 'Landscape preview' : 'Portrait preview'; return; }
    if (a === 'reload') { const f = el.querySelector('.gpc-frame iframe'); if (f) f.src = playUrl(id); return; }
    if (a === 'open') { window.open(new URL(b.dataset.url, location.href).href, '_blank', 'noopener'); return; }
    if (a === 'copy') { try { await navigator.clipboard.writeText(new URL(b.dataset.url, location.href).href); b.title = 'Copied'; } catch { /* ignore */ } return; }
    if (a === 'listen' || a === 'stop') {
      if (audioEl) { audioEl.pause(); audioEl = null; }
      if (a === 'stop') { st.playing = null; return render(); }
      audioEl = new Audio(b.dataset.src);
      st.playing = asset;
      audioEl.onended = () => { st.playing = null; render(); };
      audioEl.play().catch(() => { st.playing = null; render(); });
      return render();
    }
  });

  render();
  load();
}

let observer = null;
let scheduled = false;
function hydrateAll() {
  scheduled = false;
  document.querySelectorAll(CARD_SEL).forEach((el) => { try { mountCard(el); } catch (e) { console.warn('[game-project-card]', e); } });
}

export function installGameProjectCards() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CARD_CSS;
    document.head.appendChild(style);
  }
  hydrateAll();
  // Non-browser hosts (node test harnesses with a minimal document stub) have
  // no MutationObserver; hydrate once and skip live observation there.
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    raf(() => hydrateAll());
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

const CARD_CSS = `
.prom-gp-card{--gpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--gpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--gpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--gpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--gpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--gpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));--gpc-ok:var(--prom-success,#2fa86b);--gpc-bad:var(--prom-danger,#d9534f);display:block;margin:10px 0;max-width:100%;color:var(--gpc-text);font-size:14px;line-height:1.4}
.prom-gp-card .gpc{border:1px solid var(--gpc-line);border-radius:14px;background:var(--gpc-surface);overflow:hidden}
.prom-gp-card svg{width:16px;height:16px;flex:none}
.prom-gp-card .gpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-headtext{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.prom-gp-card .gpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--gpc-muted)}
.prom-gp-card .gpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-muted{color:var(--gpc-muted);font-size:12px}
.prom-gp-card .gpc-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.prom-gp-card .gpc-grow{flex:1;min-width:0}
.prom-gp-card .gpc-mt{margin-top:8px}.prom-gp-card .gpc-mb{margin-bottom:8px}
.prom-gp-card .gpc-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--gpc-soft);font-size:11px;text-transform:capitalize}
.prom-gp-card .gpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--gpc-text);cursor:pointer;padding:0}
.prom-gp-card .gpc-icon:hover{background:var(--gpc-soft)}
.prom-gp-card .gpc-icon:disabled{opacity:.35;cursor:default}
.prom-gp-card .gpc-icon.is-go{color:var(--gpc-accent)}
.prom-gp-card .gpc-go{display:inline-flex;gap:6px;align-items:center;border:0;border-radius:9px;padding:6px 10px;background:var(--gpc-accent);color:#fff;cursor:pointer;font-size:13px}
.prom-gp-card .gpc-steps{display:flex;list-style:none;margin:0;padding:10px 12px;gap:4px;border-bottom:1px solid var(--gpc-line);overflow-x:auto}
.prom-gp-card .gpc-steps li{flex:1;min-width:44px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--gpc-muted);position:relative}
.prom-gp-card .gpc-dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--gpc-line);background:transparent}
.prom-gp-card .gpc-steps li.is-done .gpc-dot{background:var(--gpc-ok);border-color:var(--gpc-ok)}
.prom-gp-card .gpc-steps li.is-cur{color:var(--gpc-text)}
.prom-gp-card .gpc-steps li.is-cur .gpc-dot{border-color:var(--gpc-accent);background:var(--gpc-accent)}
.prom-gp-card .gpc-sec{padding:10px 12px;border-bottom:1px solid var(--gpc-line)}
.prom-gp-card .gpc-sec:last-child{border-bottom:0}
.prom-gp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--gpc-muted);display:flex;gap:6px;align-items:center}
.prom-gp-card .gpc-pitch{margin:0 0 6px}
.prom-gp-card .gpc-kv{display:grid;grid-template-columns:80px 1fr;gap:8px;font-size:12px;padding:2px 0}
.prom-gp-card .gpc-kv span:first-child{color:var(--gpc-muted)}
.prom-gp-card .gpc-answers{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.prom-gp-card .gpc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.prom-gp-card .gpc-tile{border:1px solid var(--gpc-line);border-radius:10px;overflow:hidden;background:var(--gpc-soft);display:flex;flex-direction:column}
.prom-gp-card .gpc-tile.is-approved{border-color:var(--gpc-ok)}
.prom-gp-card .gpc-tile.is-rejected{opacity:.55}
.prom-gp-card .gpc-tile.is-failed{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-img{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(rgba(127,127,127,.18) 0% 25%,transparent 0% 50%) 50%/14px 14px}
.prom-gp-card .gpc-img img{width:100%;height:100%;object-fit:contain;image-rendering:auto}
.prom-gp-card .gpc-ph{color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-foot{display:flex;gap:4px;align-items:center;padding:4px 6px;font-size:11px}
.prom-gp-card .gpc-tname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-badge{font-size:10px;color:var(--gpc-muted)}
.prom-gp-card .gpc-tile-acts{display:flex;justify-content:space-around;border-top:1px solid var(--gpc-line)}
.prom-gp-card .gpc-tile-acts .gpc-icon{width:30px;height:28px}
.prom-gp-card .gpc-cost{margin-top:8px}
.prom-gp-card .gpc-bar{height:4px;border-radius:2px;background:var(--gpc-soft);overflow:hidden;margin-top:4px}
.prom-gp-card .gpc-bar span{display:block;height:100%;background:var(--gpc-accent)}
.prom-gp-card .gpc-approve{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:8px;border-radius:10px;border:1px solid var(--gpc-accent);font-size:12px}
.prom-gp-card .gpc-approve.is-blocked{border-color:var(--gpc-bad)}
.prom-gp-card .gpc-aud{display:flex;align-items:center;gap:6px;font-size:13px}
.prom-gp-card .gpc-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-gp-card .gpc-frame{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid var(--gpc-line);background:#000}
.prom-gp-card .gpc-frame.is-portrait{aspect-ratio:9/16;max-width:min(100%,360px);margin:0 auto}
.prom-gp-card .gpc-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.prom-gp-card .gpc-err{margin:8px 12px 0;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--gpc-bad) 14%,transparent);font-size:12px}
.prom-gp-card .gpc-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--gpc-line);border-top-color:var(--gpc-accent);animation:gpc-spin 1s linear infinite}
@keyframes gpc-spin{to{transform:rotate(360deg)}}
@media (max-width:420px){.prom-gp-card .gpc-grid{grid-template-columns:repeat(2,1fr)}.prom-gp-card .gpc-steps .gpc-step-l{font-size:9px}.prom-gp-card .gpc-kv{grid-template-columns:64px 1fr}}
`;
