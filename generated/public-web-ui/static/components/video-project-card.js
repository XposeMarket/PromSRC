/**
 * Live video-project card for chat messages (desktop + phone).
 *
 * Prom puts a fence in a reply:
 *   ```video-project
 *   {"projectId":"vp_abc123"}
 *   ```
 * renderMd (utils.js) turns it into <div class="prom-vp-card" data-vp-project>,
 * and this module hydrates every such placeholder with a card driven by the
 * server-owned /api/video-projects document. The same project the desktop
 * Studio tab and Prom's video_project tool edit, so the user can run the whole
 * Higgsfield-style flow without leaving chat:
 *   anchor candidates -> approve / reject / reroll
 *   shot list -> free estimate -> Approve & generate (server cost gate)
 *   jobs progress -> takes -> use / redo / 3 variations
 *   assemble + render -> final MP4 plays inline
 */

import {
  ICON2, V2_CSS, shotThumb, productBadge, loadModels, shotEditor, qaChip,
  storyboardSection, audioSection, autopilotSection, exportsSection,
  handleV2Click, handleV2Change, parityToolbar, kindBadge, loadPresets,
} from './video-project-card/v2.js';

const STYLE_ID = 'prom-vp-card-style';
const CARD_SEL = '.prom-vp-card[data-vp-project]:not([data-vp-mounted])';
const cache = new Map(); // projectId -> { project, history, at }
const subscribers = new Map(); // projectId -> { cards, timer, request }
const visibilityObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const card = entry.target.__vpCard;
      if (!card) continue;
      card.visible = entry.isIntersecting;
      if (card.visible && !card.loaded) { card.loaded = true; void refreshProject(card.id); }
      else if (card.visible && !card.wasVisible) { void refreshProject(card.id); }
      else scheduleProject(card.id);
      card.wasVisible = card.visible;
    }
  }, { rootMargin: '120px' }) : null;

function scheduleProject(id) {
  const group = subscribers.get(id);
  if (!group) return;
  clearTimeout(group.timer);
  for (const card of group.cards) {
    if (!card.el.isConnected) {
      group.cards.delete(card);
      visibilityObserver?.unobserve(card.el);
      delete card.el.__vpCard;
    }
  }
  if (!group.cards.size) { subscribers.delete(id); return; }
  const active = (cache.get(id)?.project?.jobs || []).some((j) => j.state === 'queued' || j.state === 'running');
  if (active && [...group.cards].some((card) => card.visible)) {
    group.timer = setTimeout(() => { void refreshProject(id); }, 3500);
  }
}

async function refreshProject(id) {
  const group = subscribers.get(id);
  if (!group) return;
  if (group.request) return group.request;
  group.request = vpFetch(`/${encodeURIComponent(id)}`)
    .then((res) => {
      if (res.project) cache.set(id, { project: res.project, history: res.history, at: Date.now() });
      for (const card of group.cards) void card.update(res);
    })
    .catch((error) => { for (const card of group.cards) void card.update(null, error); })
    .finally(() => { group.request = null; scheduleProject(id); });
  return group.request;
}

const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  film: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),
  check: I('<path d="M5 12l5 5L20 7"/>'),
  x: I('<path d="M18 6L6 18M6 6l12 12"/>'),
  reroll: I('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  spark: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  play: I('<path d="M7 4v16l13-8z"/>'),
  seq: I('<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>'),
  undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  chevron: I('<path d="M6 9l6 6 6-6"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
  download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  stop: I('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function usd(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
function isVideo(rel) { return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(rel || '')); }
function shortModel(id) { return String(id || '').replace(/^[a-z]+\//, '').replace(/^grok-imagine-/, 'grok-'); }

function mediaUrl(rel) {
  const p = String(rel || '').trim();
  if (!p) return '';
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  const resolver = typeof window !== 'undefined' ? window.__promResolveWorkspaceMediaUrl : null;
  if (typeof resolver === 'function') {
    try { const u = resolver(p); if (u) return String(u); } catch { /* fall through */ }
  }
  // Card hydration can precede the mobile API shim. Media elements cannot set
  // the X-Pairing-Token header, so always carry the mobile grant in the URL.
  if (typeof window !== 'undefined' && document.body?.classList?.contains('pm-mobile-active')) {
    const base = String(window.__pmMobileActiveGatewayOrigin || window.location?.origin || '').replace(/\/+$/, '');
    let token = String(window.__pmMobileActiveGatewayToken || '').trim();
    if (!token && base === String(window.location?.origin || '')) {
      try { token = String(localStorage.getItem('pm_device_token') || '').trim(); } catch { /* private mode */ }
    }
    const qs = new URLSearchParams({ path: p });
    if (token) qs.set('pt', token);
    return `${base}/api/canvas/inline?${qs}`;
  }
  return `/api/canvas/inline?path=${encodeURIComponent(p)}`;
}

async function vpFetch(path, body, timeoutMs = 20000) {
  const opts = {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  };
  const url = `/api/video-projects${path}`;
  // Mobile installs a paired-gateway fetch; desktop has window.api.
  const f = window.__promVideoProjectFetch || window.api;
  let res;
  if (typeof f === 'function') res = await f(url, opts);
  else {
    const r = await fetch(url, opts);
    res = await r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }));
  }
  if (res && res.success === false) throw new Error(res.error || 'Request failed');
  return res || {};
}

function selectedTake(shot) {
  const takes = shot?.takes || [];
  if (!takes.length) return null;
  return takes.find((t) => t.id === shot.selectedTakeId) || takes[takes.length - 1];
}

function thumb(rel, cls = 'vpc-thumb') {
  if (!rel) return `<span class="${cls} is-empty">${ICON.film}</span>`;
  const url = esc(mediaUrl(rel));
  return isVideo(rel)
    ? `<video class="${cls}" src="${url}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img class="${cls}" src="${url}" alt="" loading="eager" decoding="async">`;
}

function iconBtn(action, icon, label, attrs = '', extraCls = '') {
  return `<button type="button" class="vpc-icon${extraCls ? ` ${extraCls}` : ''}" data-vpa="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${attrs}>${icon}</button>`;
}

function mountCard(el) {
  el.dataset.vpMounted = '1';
  const id = String(el.dataset.vpProject || '');
  const cached = cache.get(id);
  const st = {
    project: cached?.project || null,
    history: cached?.history || { undo: 0, redo: 0 },
    busy: '', error: '', openShot: '', pending: null, estimate: null, estimateKey: '', rendering: false,
    actPending: null, models: [], aspects: new Set(), toast: '',
  };
  const h = { esc, usd, isVideo, mediaUrl, thumb, iconBtn, vpFetch };
  const alive = () => el.isConnected;
  const card = { el, id, visible: !visibilityObserver, wasVisible: !visibilityObserver, loaded: !visibilityObserver,
    update: async (res, error) => {
      if (!alive()) return;
      if (res) remember(res);
      st.error = error ? String(error?.message || error) : '';
      if (card.visible) { await maybeEstimate(); paint(); }
    } };
  const group = subscribers.get(id) || { cards: new Set(), timer: null, request: null };
  group.cards.add(card);
  subscribers.set(id, group);
  el.__vpCard = card;
  visibilityObserver?.observe(el);

  function remember(res) {
    if (res?.project) st.project = res.project;
    if (res?.history) st.history = res.history;
    if (st.project) cache.set(id, { project: st.project, history: st.history, at: Date.now() });
  }

  async function load() {
    if (!alive()) return;
    await refreshProject(id);
  }

  function running() {
    return (st.project?.jobs || []).filter((j) => j.state === 'queued' || j.state === 'running');
  }

  function schedule() {
    scheduleProject(id);
  }

  function shotsToGenerate() {
    const busyShots = new Set(running().map((j) => j.target?.shotId).filter(Boolean));
    return (st.project?.shots || []).filter((s) => !(s.takes || []).length && !busyShots.has(s.id));
  }

  async function maybeEstimate() {
    const todo = shotsToGenerate();
    const key = todo.map((s) => `${s.id}:${s.modelId || ''}:${s.durationSec}:${(s.characterIds || []).join(',')}`).join('|')
      + `#${(st.project?.characters || []).map((c) => (c.anchors || []).length).join(',')}`;
    if (!todo.length) { st.estimate = null; st.estimateKey = ''; return; }
    if (key === st.estimateKey && st.estimate) return;
    try {
      st.estimate = await vpFetch(`/${encodeURIComponent(id)}/estimate`, { shotIds: todo.map((s) => s.id) });
      st.estimateKey = key;
    } catch (e) { st.estimate = null; st.error = String(e?.message || e); }
  }

  async function run(label, fn) {
    st.busy = label; st.error = ''; paint();
    try { const r = await fn(); remember(r); return r; }
    catch (e) { st.error = String(e?.message || e); return null; }
    finally { st.busy = ''; paint(); }
  }

  async function ops(list, label) {
    await run(label, () => vpFetch(`/${encodeURIComponent(id)}/ops`, { ops: list }));
    await load();
  }

  // Generic v2 action route. Handles the needsApproval cost gate inline.
  async function act(action, args = {}, label = 'Working', timeoutMs = 120000) {
    const res = await run(label, () => vpFetch(`/${encodeURIComponent(id)}/action`, { action, ...args }, timeoutMs));
    if (!res) return null;
    const na = res.needsApproval;
    if (na) {
      const lr = res.lastRun?.needsApproval;
      // Paid actions that create a shot return its id at the gate; the approved
      // retry reuses it (no duplicate shot, no re-upload of the sketch).
      const retryArgs = res.shotId ? { ...args, pendingShotId: res.shotId } : args;
      if (retryArgs.pendingShotId && retryArgs.dataBase64) delete retryArgs.dataBase64;
      st.actPending = {
        action, args: retryArgs,
        usd: Number(lr?.usd ?? na?.usd ?? res.estimateUsd ?? res.totalUsd ?? res.estimate?.total ?? 0),
        breakdown: lr?.breakdown || na?.breakdown || res.breakdown || [],
      };
    } else st.actPending = null;
    st.estimateKey = '';
    await load();
    return res;
  }

  // Every generate goes through the server cost gate. Under the auto-approve
  // limit it just runs; above it we show an inline confirm with the estimate.
  async function generate(path, body, label) {
    const res = await run(label, () => vpFetch(`/${encodeURIComponent(id)}${path}`, body, 120000));
    if (!res) return;
    if (res.needsApproval) {
      st.pending = { path, body: { ...body, approved: true }, label, reason: res.reason, estimate: res.estimate };
      paint();
      return;
    }
    st.pending = null;
    st.estimateKey = '';
    await load();
  }

  async function render() {
    const p = st.project;
    if (!p) return;
    const hasVideoClips = (p.clips || []).some((c) => c.source && 'shotId' in c.source);
    st.rendering = true;
    if (st.aspects.size) {
      await act('render', { aspects: [...st.aspects] }, 'Rendering', 15 * 60 * 1000);
      st.rendering = false;
      await load();
      return;
    }
    if (!hasVideoClips) {
      const ok = await run('Assembling', () => vpFetch(`/${encodeURIComponent(id)}/ops`, { ops: [{ op: 'timeline.assemble' }] }));
      if (!ok) { st.rendering = false; paint(); return; }
    }
    await run('Rendering', () => vpFetch(`/${encodeURIComponent(id)}/render`, {}, 15 * 60 * 1000));
    st.rendering = false;
    await load();
  }

  function openMedia(rel, name) {
    const src = mediaUrl(rel);
    if (typeof window.__promOpenInlineMedia === 'function') {
      try { window.__promOpenInlineMedia({ src, path: rel, name: name || rel.split('/').pop(), kind: isVideo(rel) ? 'video' : 'image' }); return; }
      catch { /* fall through */ }
    }
    window.open(src, '_blank', 'noopener');
  }

  // ── painting ──────────────────────────────────────────────────────────
  function charSection(p) {
    const upload = `${iconBtn('upload-product', ICON2.box, 'Upload product photo')}${iconBtn('upload-character', ICON2.userPlus, 'Upload character photo')}${parityToolbar(h)}`;
    if (!(p.characters || []).length) return `<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${upload}</h4></section>`;
    const anchorJobs = running().filter((j) => j.target?.characterId);
    const rows = p.characters.map((c) => {
      const pendingJob = anchorJobs.some((j) => j.target.characterId === c.id);
      const approved = (c.anchors || [])[0];
      const cands = c.candidates || [];
      const status = approved ? 'Anchor approved' : cands.length ? 'Pick an anchor' : pendingJob ? 'Generating anchor' : 'No anchor yet';
      const tiles = [
        approved ? `<div class="vpc-tile is-approved"><button type="button" class="vpc-tile-media" data-vpa="view" data-path="${esc(approved)}" aria-label="View anchor">${thumb(approved, 'vpc-tile-img')}</button><span class="vpc-badge">${ICON.check}</span></div>` : '',
        ...cands.map((rel) => `<div class="vpc-tile">
          <button type="button" class="vpc-tile-media" data-vpa="view" data-path="${esc(rel)}" aria-label="View candidate">${thumb(rel, 'vpc-tile-img')}</button>
          <div class="vpc-tile-actions">
            ${iconBtn('approve-anchor', ICON.check, 'Approve as anchor', `data-c="${esc(c.id)}" data-path="${esc(rel)}"`, 'is-go')}
            ${iconBtn('reject-anchor', ICON.x, 'Reject', `data-c="${esc(c.id)}" data-path="${esc(rel)}"`)}
          </div>
        </div>`),
        pendingJob ? `<div class="vpc-tile is-loading"><span class="vpc-spin"></span></div>` : '',
      ].join('');
      return `<div class="vpc-char">
        <div class="vpc-row">
          <span class="vpc-char-name">${ICON.user}<strong>${esc(c.name)}</strong>${productBadge(c)}</span>
          <span class="vpc-muted">${esc(status)}</span>
          <span class="vpc-grow"></span>
          ${c.anchorPrompt ? iconBtn('reroll', ICON.reroll, 'Generate another anchor', `data-c="${esc(c.id)}"`) : ''}
        </div>
        ${tiles ? `<div class="vpc-strip">${tiles}</div>` : ''}
      </div>`;
    }).join('');
    return `<section class="vpc-sec"><h4 class="vpc-row">Cast<span class="vpc-grow"></span>${upload}</h4>${rows}</section>`;
  }

  function shotSection(p) {
    const shots = p.shots || [];
    if (!shots.length) return `<section class="vpc-sec"><p class="vpc-muted">No shots planned yet. Ask Prom to plan the shot list.</p></section>`;
    const busyShots = new Set(running().map((j) => j.target?.shotId).filter(Boolean));
    const rows = shots.map((s, i) => {
      const t = selectedTake(s);
      const gen = busyShots.has(s.id);
      const open = st.openShot === s.id;
      const n = (s.takes || []).length;
      const takes = open ? (s.takes || []).slice().reverse().map((tk) => `
        <div class="vpc-take${tk.id === t?.id ? ' is-selected' : ''}">
          ${isVideo(tk.path)
            ? `<video src="${esc(mediaUrl(tk.path))}#t=0.1" controls playsinline preload="metadata"></video>`
            : `<img src="${esc(mediaUrl(tk.path))}" alt="" loading="eager">`}
          <div class="vpc-row">
            ${qaChip(tk, h)}<span class="vpc-muted">${esc(shortModel(tk.modelId))} · ${usd(tk.costUsd)}</span>
            <span class="vpc-grow"></span>
            ${tk.id === t?.id
              ? `<span class="vpc-inuse">${ICON.check}In cut</span>`
              : iconBtn('use-take', ICON.check, 'Use this take', `data-s="${esc(s.id)}" data-t="${esc(tk.id)}"`, 'is-go')}
          </div>
        </div>`).join('') : '';
      return `<div class="vpc-shot${open ? ' is-open' : ''}">
        <button type="button" class="vpc-shot-head" data-vpa="toggle" data-s="${esc(s.id)}" aria-expanded="${open}">
          ${gen && !t ? '<span class="vpc-thumb is-empty"><span class="vpc-spin"></span></span>' : shotThumb(s, t, p, h)}
          <span class="vpc-shot-meta">
            <strong>${i + 1}. ${esc(s.title || 'Shot')}${kindBadge(s, t)}</strong>
            <small>${esc(String(s.prompt || '').slice(0, 110))}</small>
            <span class="vpc-status is-${gen ? 'generating' : esc(s.status)}">${gen ? 'generating' : esc(s.status)} · ${s.durationSec}s · ${n} take${n === 1 ? '' : 's'}</span>
          </span>
          <span class="vpc-chev">${ICON.chevron}</span>
        </button>
        ${open ? `<div class="vpc-shot-body">
          ${shotEditor(s, i, shots.length, st, h)}
          ${s.camera ? `<p class="vpc-muted">Camera: ${esc(s.camera)}</p>` : ''}
          <div class="vpc-row">
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${esc(s.id)}" data-n="1" ${gen ? 'disabled' : ''}>${ICON.reroll}<span>${n ? 'Redo' : 'Generate'}</span></button>
            <button type="button" class="vpc-btn" data-vpa="redo-shot" data-s="${esc(s.id)}" data-n="3" ${gen ? 'disabled' : ''}>${ICON.layers}<span>3 variations</span></button>
          </div>
          ${takes ? `<div class="vpc-takes">${takes}</div>` : ''}
        </div>` : ''}
      </div>`;
    }).join('');
    return `<section class="vpc-sec"><h4>Shots <span class="vpc-muted">${shots.length}</span></h4>${rows}</section>`;
  }

  function actionSection(p) {
    const parts = [];
    if (st.pending) {
      const lines = (st.pending.estimate?.shots || []).map((s) => `<li>${esc(s.title || 'Item')}: ${s.count}× ${esc(shortModel(s.modelId))} · ${usd(s.usd)}</li>`).join('');
      parts.push(`<div class="vpc-approve">
        <strong>Approve ${usd(st.pending.estimate?.total)}?</strong>
        <p class="vpc-muted">${esc(st.pending.reason || '')}</p>
        ${lines ? `<ul>${lines}</ul>` : ''}
        <div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="approve-pending">${ICON.check}<span>Approve & run</span></button>
          <button type="button" class="vpc-btn" data-vpa="cancel-pending">${ICON.x}<span>Cancel</span></button>
        </div>
      </div>`);
    }
    const todo = shotsToGenerate();
    const est = st.estimate;
    if (!st.pending && todo.length && est) {
      const problems = (est.shots || []).flatMap((s) => (s.problems || []).map((pr) => `${s.title}: ${pr}`));
      const needsAnchor = (p.characters || []).some((c) => !(c.anchors || []).length && (c.candidates || []).length);
      parts.push(`<div class="vpc-gen">
        <div class="vpc-row"><strong>${todo.length} shot${todo.length === 1 ? '' : 's'} to generate</strong><span class="vpc-grow"></span><strong>~${usd(est.total)}</strong></div>
        ${needsAnchor ? '<p class="vpc-warn">Approve a character anchor first so every shot keeps the same face.</p>' : ''}
        ${problems.length ? `<ul class="vpc-warn">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <button type="button" class="vpc-btn is-primary is-wide" data-vpa="gen-all" ${needsAnchor ? 'disabled' : ''}>${ICON.spark}<span>${est.total > (p.budget?.autoApproveUsd ?? 1) ? 'Approve & generate' : 'Generate'} · ${usd(est.total)}</span></button>
      </div>`);
    }
    const jobs = running();
    if (jobs.length) {
      parts.push(`<div class="vpc-jobs"><span class="vpc-spin"></span><span>Generating ${jobs.length} job${jobs.length === 1 ? '' : 's'}. Takes land here as they finish.</span></div>`);
    }
    const failed = (p.jobs || []).filter((j) => j.state === 'failed').slice(-2);
    if (failed.length && !jobs.length) {
      parts.push(`<ul class="vpc-warn">${failed.map((j) => `<li>${esc(shortModel(j.modelId))} failed: ${esc(String(j.error || 'unknown').slice(0, 160))}</li>`).join('')}</ul>`);
    }
    const shots = p.shots || [];
    const ready = shots.length && shots.every((s) => selectedTake(s));
    const latest = (p.exports || []).slice(-1)[0];
    if (ready || latest) {
      parts.push(`<div class="vpc-final">
        ${latest ? `<video src="${esc(mediaUrl(latest.path))}" controls playsinline preload="metadata"></video>
          <div class="vpc-row"><span class="vpc-muted">Final cut · ${Number(latest.durationSec || 0).toFixed(1)}s</span><span class="vpc-grow"></span>
          ${iconBtn('view', ICON.download, 'Open video', `data-path="${esc(latest.path)}"`)}</div>` : ''}
        ${ready ? `<div class="vpc-row">
          <button type="button" class="vpc-btn is-primary" data-vpa="render" ${st.rendering || jobs.length ? 'disabled' : ''}>${st.rendering ? '<span class="vpc-spin"></span>' : ICON.play}<span>${latest ? 'Re-render' : 'Render video'}</span></button>
          ${iconBtn('assemble', ICON.seq, 'Rebuild the cut from the selected takes')}
        </div>` : ''}
      </div>`);
    }
    return parts.length ? `<section class="vpc-sec vpc-actions">${parts.join('')}</section>` : '';
  }

  function paint() {
    if (!alive()) return;
    // Don't clobber an in-progress edit; the 'change' (blur) save repaints.
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ae.matches?.('textarea[data-vpf]') && !st.busy) return;
    const p = st.project;
    if (!p) {
      el.innerHTML = `<div class="vpc"><div class="vpc-head"><span class="vpc-kicker">${ICON.film}Video project</span></div>
        <p class="vpc-muted">${st.error ? esc(st.error) : 'Loading…'}</p></div>`;
      return;
    }
    const b = p.budget || {};
    const scroller = document.body?.classList?.contains('pm-mobile-document-scroll')
      ? (document.scrollingElement || document.documentElement)
      : el.closest('.pm-chat-body');
    const viewportTop = scroller?.getBoundingClientRect?.().top || 0;
    const beforeRect = el.getBoundingClientRect?.();
    const oldTop = scroller?.scrollTop;
    const html = `<div class="vpc">
      <div class="vpc-head">
        <div class="vpc-headtext">
          <span class="vpc-kicker">${ICON.film}Video project · ${esc(p.target?.aspect || '')}</span>
          <strong class="vpc-title">${esc(p.title || p.id)}</strong>
          <span class="vpc-muted">${usd(b.spentUsd)} spent${b.capUsd != null ? ` of ${usd(b.capUsd)}` : ''} · auto-approve under ${usd(b.autoApproveUsd ?? 1)}</span>
        </div>
        <div class="vpc-tools">
          ${iconBtn('undo', ICON.undo, 'Undo', st.history?.undo ? '' : 'disabled')}
          ${iconBtn('redo', ICON.redo, 'Redo', st.history?.redo ? '' : 'disabled')}
          ${iconBtn('storyboard', ICON2.grid, 'Generate storyboard')}
          ${iconBtn('qa', ICON2.gauge, 'QA: score selected takes')}
          ${iconBtn('refresh', ICON.refresh, 'Refresh')}
        </div>
      </div>
      ${st.busy ? `<div class="vpc-busy"><span class="vpc-spin"></span>${esc(st.busy)}…</div>` : ''}
      ${st.error ? `<p class="vpc-err">${esc(st.error)}</p>` : ''}
      ${st.toast ? `<div class="vpc-toast">${esc(st.toast)}</div>` : ''}
      ${charSection(p)}
      ${storyboardSection(p, h)}
      ${shotSection(p)}
      ${audioSection(p, st, h)}
      ${actionSection(p)}
      ${autopilotSection(p, st, h)}
      ${exportsSection(p, st, h)}
    </div>`;
    // Patch only sections whose markup changed. Keep unchanged media nodes alive
    // (especially playing video) and preserve horizontal strip scroll positions.
    const current = el.querySelector(':scope > .vpc');
    const template = document.createElement('template');
    template.innerHTML = html;
    const next = template.content.firstElementChild;
    if (!current) el.replaceChildren(next);
    else {
      const oldParts = [...current.children];
      const newParts = [...next.children];
      const key = (node) => `${node.tagName}:${node.className?.replace?.(/ is-[\w-]+/g, '') || ''}:${node.querySelector?.('h4')?.textContent || ''}`;
      for (let i = 0; i < newParts.length; i++) {
        const fresh = newParts[i];
        const old = oldParts.find((part) => key(part) === key(fresh) && !part.__vpMatched);
        if (!old) current.insertBefore(fresh, current.children[i] || null);
        else {
          old.__vpMatched = true;
          if (old.outerHTML !== fresh.outerHTML) {
            fresh.querySelectorAll?.('.vpc-strip').forEach((strip, n) => {
              strip.scrollLeft = old.querySelectorAll?.('.vpc-strip')[n]?.scrollLeft || 0;
            });
            old.replaceWith(fresh);
          } else if (current.children[i] !== old) current.insertBefore(old, current.children[i] || null);
        }
      }
      oldParts.forEach((node) => { if (!node.__vpMatched) node.remove(); delete node.__vpMatched; });
    }
    if (scroller && beforeRect && oldTop != null && beforeRect.bottom < viewportTop) {
      const delta = el.getBoundingClientRect().bottom - beforeRect.bottom;
      if (delta) scroller.scrollTop = oldTop + delta;
    }
  }

  // ── events ────────────────────────────────────────────────────────────
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-vpa]');
    if (!t || !el.contains(t) || t.disabled) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (st.busy && t.dataset.vpa !== 'toggle' && t.dataset.vpa !== 'view') return;
    const a = t.dataset.vpa;
    const d = t.dataset;
    switch (a) {
      case 'toggle':
        st.openShot = st.openShot === d.s ? '' : d.s; paint();
        if (st.openShot && !st.models.length) loadModels(h).then((m) => { st.models = m; if (m.length) paint(); });
        if (st.openShot && !(st.presets || []).length) loadPresets(h).then((ps) => { st.presets = ps; if (ps.length) paint(); });
        return;
      case 'view': if (d.path) openMedia(d.path); return;
      case 'refresh': st.estimateKey = ''; await load(); return;
      case 'undo': case 'redo':
        await run(a === 'undo' ? 'Undoing' : 'Redoing', () => vpFetch(`/${encodeURIComponent(id)}/${a}`, {}));
        st.estimateKey = ''; await load(); return;
      case 'approve-anchor': await ops([{ op: 'character.approveAnchor', id: d.c, path: d.path }], 'Approving anchor'); return;
      case 'reject-anchor': await ops([{ op: 'character.rejectAnchor', id: d.c, path: d.path }], 'Removing'); return;
      case 'reroll': await generate(`/characters/${encodeURIComponent(d.c)}/anchor`, { count: 1 }, 'Generating anchor'); return;
      case 'use-take': await ops([{ op: 'take.select', shotId: d.s, takeId: d.t }], 'Swapping take'); return;
      case 'redo-shot': await generate('/generate', { shotIds: [d.s], count: Number(d.n) || 1 }, 'Estimating'); return;
      case 'gen-all': {
        const ids = shotsToGenerate().map((s) => s.id);
        if (!ids.length) return;
        // The estimate was shown on the button; tapping it is the approval.
        await generate('/generate', { shotIds: ids, count: 1, approved: true }, 'Submitting');
        return;
      }
      case 'approve-pending': {
        const pend = st.pending;
        if (!pend) return;
        st.pending = null;
        await generate(pend.path, pend.body, 'Submitting');
        return;
      }
      case 'cancel-pending': st.pending = null; paint(); return;
      case 'assemble': await ops([{ op: 'timeline.assemble' }], 'Assembling'); return;
      case 'render': await render(); return;
      default:
        st.toast = '';
        await handleV2Click(a, { st, d, act, ops, paint, h });
    }
  });

  // Field edits (prompt/line save on blur via 'change'; selects/toggles/slider on change).
  el.addEventListener('change', async (ev) => {
    const f = ev.target.closest?.('[data-vpf]');
    if (!f || !el.contains(f) || st.busy) return;
    await handleV2Change(f.dataset.vpf, { st, d: f.dataset, ops, act, value: f.value, checked: f.checked });
  });
  el.addEventListener('click', (ev) => { if (ev.target.closest?.('[data-vpf]')) ev.stopPropagation(); });

  paint();
  const fresh = cached && Date.now() - cached.at < 3000;
  if (fresh) { void maybeEstimate().then(() => { paint(); schedule(); }); }
  else if (card.visible) void load();
}

let observer = null;
let scheduled = false;

function hydrateAll(root = document) {
  scheduled = false;
  root.querySelectorAll?.(CARD_SEL).forEach((el) => {
    try { mountCard(el); } catch (e) { console.warn('[video-project-card] mount failed', e); }
  });
}

export function installVideoProjectCards() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CARD_CSS + V2_CSS;
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

// Theme: host tokens with fallbacks (desktop uses --text/--line/--brand,
// mobile --pm-*, visual bridge --prom-*). No hardcoded canvas colors.
const CARD_CSS = `
.prom-vp-card{--vpc-text:var(--prom-text,var(--pm-text,var(--text,currentColor)));--vpc-muted:var(--prom-muted,var(--pm-muted,var(--muted,#8a8a8a)));--vpc-line:var(--prom-border,var(--pm-border,var(--line,rgba(127,127,127,.25))));--vpc-surface:var(--prom-surface,var(--pm-surface,var(--panel,rgba(127,127,127,.06))));--vpc-soft:var(--prom-surface-secondary,var(--pm-bg-soft,var(--panel-2,rgba(127,127,127,.1))));--vpc-accent:var(--prom-accent,var(--pm-orange,var(--brand,#ff7a1a)));display:block;margin:10px 0;max-width:100%;color:var(--vpc-text);font-size:14px;line-height:1.4}
.prom-vp-card .vpc{border:1px solid var(--vpc-line);border-radius:14px;background:var(--vpc-surface);overflow:hidden}
.prom-vp-card svg{width:16px;height:16px;flex:none}
.prom-vp-card .vpc-head{display:flex;gap:10px;align-items:flex-start;padding:12px 12px 10px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-headtext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.prom-vp-card .vpc-kicker{display:inline-flex;gap:6px;align-items:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--vpc-muted)}
.prom-vp-card .vpc-kicker svg{width:13px;height:13px}
.prom-vp-card .vpc-title{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-muted{color:var(--vpc-muted);font-size:12px}
.prom-vp-card .vpc-tools{display:flex;gap:2px}
.prom-vp-card .vpc-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:var(--vpc-text);cursor:pointer;padding:0}
.prom-vp-card .vpc-icon:hover{background:var(--vpc-soft)}
.prom-vp-card .vpc-icon:disabled{opacity:.35;cursor:default}
.prom-vp-card .vpc-icon.is-go{color:var(--vpc-accent)}
.prom-vp-card .vpc-sec{padding:10px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-sec:last-child{border-bottom:0}
.prom-vp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--vpc-muted);display:flex;gap:6px}
.prom-vp-card .vpc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prom-vp-card .vpc-grow{flex:1}
.prom-vp-card .vpc-char+.vpc-char{margin-top:10px}
.prom-vp-card .vpc-char-name{display:inline-flex;gap:6px;align-items:center}
.prom-vp-card .vpc-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:thin}
.prom-vp-card .vpc-tile{position:relative;flex:none;width:112px;border-radius:10px;overflow:hidden;border:1px solid var(--vpc-line);background:var(--vpc-soft)}
.prom-vp-card .vpc-tile.is-approved{border-color:var(--vpc-accent);box-shadow:0 0 0 1px var(--vpc-accent)}
.prom-vp-card .vpc-tile.is-loading{height:140px;display:flex;align-items:center;justify-content:center}
.prom-vp-card .vpc-tile-media{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}
.prom-vp-card .vpc-tile-img{display:block;width:100%;height:140px;object-fit:cover}
.prom-vp-card .vpc-tile-actions{display:flex;justify-content:space-around;border-top:1px solid var(--vpc-line)}
.prom-vp-card .vpc-badge{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--vpc-accent);color:#fff}
.prom-vp-card .vpc-badge svg{width:13px;height:13px}
.prom-vp-card .vpc-shot{border:1px solid var(--vpc-line);border-radius:11px;overflow:hidden}
.prom-vp-card .vpc-shot+.vpc-shot{margin-top:8px}
.prom-vp-card .vpc-shot-head{display:flex;gap:10px;align-items:center;width:100%;padding:8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.prom-vp-card .vpc-thumb{flex:none;width:72px;height:48px;border-radius:7px;object-fit:cover;background:var(--vpc-soft);display:flex;align-items:center;justify-content:center;color:var(--vpc-muted)}
.prom-vp-card .vpc-shot-meta{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.prom-vp-card .vpc-shot-meta small{color:var(--vpc-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prom-vp-card .vpc-status{font-size:11px;color:var(--vpc-muted)}
.prom-vp-card .vpc-status.is-ready{color:var(--prom-success,#2eaa5c)}
.prom-vp-card .vpc-status.is-failed{color:var(--prom-danger,#e5484d)}
.prom-vp-card .vpc-status.is-generating{color:var(--vpc-accent)}
.prom-vp-card .vpc-chev{color:var(--vpc-muted);transition:transform .15s}
.prom-vp-card .vpc-shot.is-open .vpc-chev{transform:rotate(180deg)}
.prom-vp-card .vpc-shot-body{padding:0 8px 10px}
.prom-vp-card .vpc-prompt{margin:0 0 8px;font-size:13px}
.prom-vp-card .vpc-takes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
.prom-vp-card .vpc-take{border:1px solid var(--vpc-line);border-radius:9px;overflow:hidden;padding-bottom:2px}
.prom-vp-card .vpc-take.is-selected{border-color:var(--vpc-accent)}
.prom-vp-card .vpc-take video,.prom-vp-card .vpc-take img{display:block;width:100%;aspect-ratio:9/16;max-height:220px;background:var(--vpc-soft);object-fit:contain}
.prom-vp-card .vpc-take .vpc-row{padding:4px 6px 2px}
.prom-vp-card .vpc-inuse{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--vpc-accent)}
.prom-vp-card .vpc-inuse svg{width:13px;height:13px}
.prom-vp-card .vpc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--vpc-line);background:var(--vpc-soft);color:var(--vpc-text);font:inherit;font-size:13px;cursor:pointer}
.prom-vp-card .vpc-btn:disabled{opacity:.45;cursor:default}
.prom-vp-card .vpc-btn.is-primary{background:var(--vpc-accent);border-color:transparent;color:#fff;font-weight:600}
.prom-vp-card .vpc-btn.is-wide{width:100%;margin-top:8px;min-height:40px}
.prom-vp-card .vpc-actions>*+*{margin-top:10px}
.prom-vp-card .vpc-approve{border:1px solid var(--vpc-accent);border-radius:11px;padding:10px}
.prom-vp-card .vpc-approve p{margin:4px 0}
.prom-vp-card ul{margin:6px 0;padding-left:18px;font-size:12px}
.prom-vp-card .vpc-warn{color:var(--prom-warning,#d9822b);font-size:12px;margin:6px 0}
.prom-vp-card .vpc-err{margin:0;padding:8px 12px;color:var(--prom-danger,#e5484d);font-size:12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-busy,.prom-vp-card .vpc-jobs{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--vpc-muted)}
.prom-vp-card .vpc-busy{padding:6px 12px;border-bottom:1px solid var(--vpc-line)}
.prom-vp-card .vpc-final video{display:block;width:100%;aspect-ratio:16/9;max-height:420px;border-radius:10px;background:var(--vpc-soft)}
.prom-vp-card .vpc-final .vpc-row{margin-top:6px}
.prom-vp-card .vpc-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--vpc-line);border-top-color:var(--vpc-accent);animation:vpc-spin .8s linear infinite;flex:none}
@keyframes vpc-spin{to{transform:rotate(360deg)}}
`;
