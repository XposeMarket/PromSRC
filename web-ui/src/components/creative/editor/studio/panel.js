/**
 * Studio panel: the Higgsfield-style generation side of the video editor.
 *
 * Drives the server-owned video project engine (/api/video-projects/*), so the
 * same document is shared with Prom's `video_project` tool and the phone:
 *   - projects: pick / create / delete
 *   - providers: readiness chips + write-only key entry (fal, Higgsfield)
 *   - brief + "Plan with Prom" (hands the brief to chat)
 *   - characters with anchor stills (identity frames)
 *   - shot board (reorder, generate, status, selected take thumbnail)
 *   - shot inspector (right "Shot" tab): prompt, camera, model, duration,
 *     characters, chaining, variations, takes gallery (use / delete)
 *   - jobs tray with cancel, cost/budget meter, project undo/redo
 *   - "Send cut to timeline" mirrors the project cut into the editor scene
 *   - server render (layered FFmpeg) with inline playback
 */
import { api } from '../../../../api.js';
import { workspaceMediaUrl } from '../../../../utils.js';
import { assetToSceneElement } from '../assets/importer.js';
import { icon, iconButton } from '../icons.js';

const LS_ACTIVE = 'prometheus_vp_active_project';
const BASE = '/api/video-projects';

const CAMERA_PRESETS = [
  '', 'Static locked-off', 'Slow dolly in', 'Slow dolly out', 'Tracking shot', 'Orbit around subject',
  'Crane up', 'Crane down', 'Handheld', 'Whip pan', 'Push in close-up', 'Drone aerial', 'Low angle hero',
  'Over-the-shoulder', 'Rack focus', 'FPV fly-through',
];
const ASPECTS = ['16:9', '9:16', '1:1', '4:5'];

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function usd(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
function mediaUrl(rel) { return rel ? workspaceMediaUrl(rel) : ''; }
function isVideo(rel) { return /\.(mp4|webm|mov|m4v)$/i.test(String(rel || '')); }

function mediaThumb(rel, cls = 'ce-studio-thumb') {
  if (!rel) return `<div class="${cls} is-empty">${icon('film', 18)}</div>`;
  const url = esc(mediaUrl(rel));
  return isVideo(rel)
    ? `<video class="${cls}" src="${url}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img class="${cls}" src="${url}" alt="" loading="lazy">`;
}

function selectedTake(shot) {
  if (!shot?.takes?.length) return null;
  return shot.takes.find((t) => t.id === shot.selectedTakeId) || shot.takes[shot.takes.length - 1];
}

export function createStudioPanel({ container, inspector, store, getScene, applyOps, switchTab, setTitle }) {
  const state = {
    projects: [],
    project: null,
    history: { undo: 0, redo: 0 },
    models: [],
    providers: {},
    selectedShotId: null,
    busy: '',
    error: '',
    keysOpen: false,
    renderPath: '',
    variations: 2,
  };
  let events = null;
  let disposed = false;
  let reloadTimer = null;

  // ── data ────────────────────────────────────────────────────────────────
  async function call(path, body, opts = {}) {
    const res = await api(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      timeoutMs: opts.timeoutMs || 30000,
    });
    if (res && res.success === false) throw new Error(res.error || 'Request failed');
    return res;
  }

  async function guard(label, fn) {
    state.busy = label;
    state.error = '';
    render();
    try { return await fn(); }
    catch (err) { state.error = String(err?.message || err).replace(/^API \d+:\s*/, ''); return null; }
    finally { state.busy = ''; render(); }
  }

  async function loadCatalog() {
    try {
      const [m, p] = await Promise.all([call('/models'), call('/providers')]);
      state.models = m.models || [];
      state.providers = p.providers || {};
    } catch (err) { state.error = String(err?.message || err); }
  }

  async function loadProjects() {
    try { state.projects = (await call('')).projects || []; } catch (err) { state.error = String(err?.message || err); }
  }

  async function openProject(id) {
    if (!id) { state.project = null; closeEvents(); render(); return; }
    try {
      const res = await call(`/${encodeURIComponent(id)}`);
      state.project = res.project;
      state.history = res.history || state.history;
      try { localStorage.setItem(LS_ACTIVE, id); } catch { /* ignore */ }
      if (!state.project.shots.some((s) => s.id === state.selectedShotId)) state.selectedShotId = state.project.shots[0]?.id || null;
      subscribe(id);
      setTitle?.(state.project.title);
    } catch (err) {
      state.error = String(err?.message || err);
      state.project = null;
    }
    render();
  }

  function applyProjectResponse(res) {
    if (res?.project) state.project = res.project;
    if (res?.history) state.history = res.history;
  }

  async function ops(list, label = 'Saving') {
    if (!state.project) return;
    const res = await guard(label, () => call(`/${state.project.id}/ops`, { ops: list }));
    applyProjectResponse(res);
    render();
    return res;
  }

  function subscribe(id) {
    closeEvents();
    if (typeof EventSource === 'undefined') return;
    try {
      events = new EventSource(`${BASE}/${encodeURIComponent(id)}/events`);
      events.onmessage = () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          if (disposed || !state.project || state.project.id !== id) return;
          try {
            const res = await call(`/${encodeURIComponent(id)}`);
            applyProjectResponse(res);
            render();
          } catch { /* keep last state */ }
        }, 250);
      };
    } catch { events = null; }
  }
  function closeEvents() { try { events?.close(); } catch { /* ignore */ } events = null; }

  // ── generation ─────────────────────────────────────────────────────────
  async function generate(shotIds, count = 1, modelId) {
    if (!state.project) return;
    const pid = state.project.id;
    const body = { shotIds, count, modelId };
    let res = await guard('Estimating', () => call(`/${pid}/generate`, body, { timeoutMs: 120000 }));
    if (!res) return;
    if (res.needsApproval) {
      const lines = (res.estimate?.shots || []).map((s) => `• ${s.title}: ${s.count}× ${s.modelId} ≈ ${usd(s.usd)}`).join('\n');
      const ok = window.confirm(`${res.reason || 'Approve this generation?'}\n\n${lines}\n\nTotal ≈ ${usd(res.estimate?.total)}`);
      if (!ok) return;
      res = await guard('Submitting', () => call(`/${pid}/generate`, { ...body, approved: true }, { timeoutMs: 120000 }));
    }
    await openProject(pid);
  }

  async function generateAnchor(characterId) {
    const c = state.project?.characters.find((x) => x.id === characterId);
    if (!c) return;
    const prompt = window.prompt(`Describe ${c.name} for the identity still (face, outfit, lighting):`, c.notes || '');
    if (!prompt) return;
    const pid = state.project.id;
    let res = await guard('Generating anchor', () => call(`/${pid}/characters/${characterId}/anchor`, { prompt }, { timeoutMs: 120000 }));
    if (res?.needsApproval) {
      if (!window.confirm(`${res.reason}\n\nApprove ≈ ${usd(res.estimate?.total)}?`)) return;
      res = await guard('Generating anchor', () => call(`/${pid}/characters/${characterId}/anchor`, { prompt, approved: true }, { timeoutMs: 120000 }));
    }
    await openProject(pid);
  }

  // ── editor timeline bridge ─────────────────────────────────────────────
  function sendCutToTimeline() {
    const p = state.project;
    const scene = getScene?.();
    if (!p || !scene || typeof applyOps !== 'function') return;
    const existing = (scene.elements || []).filter((el) => el?.meta?.vpProjectId === p.id).map((el) => ({ op: 'delete', id: el.id }));
    const shotById = new Map(p.shots.map((s) => [s.id, s]));
    const video = p.clips
      .filter((c) => p.tracks.find((t) => t.id === c.trackId)?.kind !== 'audio')
      .sort((a, b) => a.startMs - b.startMs);
    const adds = [];
    for (const clip of video) {
      let rel = '';
      let name = clip.label || 'Clip';
      if ('shotId' in clip.source) {
        const shot = shotById.get(clip.source.shotId);
        const take = selectedTake(shot);
        if (!take) continue;
        rel = take.path;
        name = shot.title;
      } else rel = clip.source.assetPath;
      if (!rel) continue;
      const durMs = Math.max(100, clip.outMs - clip.inMs);
      const el = assetToSceneElement({
        id: `vp_${clip.id}`, type: isVideo(rel) ? 'video' : 'image', name, src: mediaUrl(rel), path: rel,
        duration: durMs, width: scene.width || 1920, height: scene.height || 1080, persisted: true,
      }, scene);
      el.x = 0; el.y = 0; el.width = scene.width || 1920; el.height = scene.height || 1080;
      el.meta = {
        ...el.meta, startMs: clip.startMs, endMs: clip.startMs + durMs, durationMs: durMs,
        trimStartMs: clip.inMs, trimEndMs: 0, vpProjectId: p.id, vpClipId: clip.id,
        vpShotId: 'shotId' in clip.source ? clip.source.shotId : undefined,
      };
      adds.push({ op: 'add', ...el });
    }
    if (!adds.length) { state.error = 'Nothing on the project timeline yet. Generate shots, then Assemble.'; render(); return; }
    const end = Math.max(...adds.map((a) => a.meta.endMs));
    applyOps([...existing, ...adds, { op: 'set-scene', patch: { durationMs: Math.max(scene.durationMs || 0, end) } }]);
    store?.setState?.({ timeMs: 0 });
  }

  async function renderFinal() {
    if (!state.project) return;
    const res = await guard('Rendering', () => call(`/${state.project.id}/render`, {}, { timeoutMs: 600000 }));
    if (res?.path) state.renderPath = res.path;
    render();
  }

  function planWithProm() {
    const p = state.project;
    if (!p) return;
    const brief = (container.querySelector('[data-vp-brief]')?.value || p.brief || '').trim();
    const text = `Plan my video project "${p.title}" (${p.id}) with video_project: ${brief || '(no brief yet, ask me)'} `
      + `Target ${p.target.aspect}, ${p.target.resolution}. Build characters and a shot list with plan.setShots, show me the estimate, and wait for my approval before generating.`;
    if (typeof window.sendChat === 'function') {
      const input = document.querySelector('#chat-input, #messageInput, textarea[data-chat-input], .chat-input textarea');
      if (input) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); window.sendChat(); return; }
      try { window.sendChat(text); return; } catch { /* fall through */ }
    }
    navigator.clipboard?.writeText(text);
    state.error = 'Brief copied. Paste it into chat to plan with Prom.';
    render();
  }

  // ── rendering ──────────────────────────────────────────────────────────
  function providerChips() {
    const names = { xai: 'Grok', openai: 'OpenAI', fal: 'fal', higgsfield: 'Higgsfield' };
    return Object.entries(names).map(([id, label]) => {
      const ok = state.providers[id]?.configured;
      return `<span class="ce-studio-chip${ok ? ' is-ok' : ''}" title="${esc(ok ? `${label} ready` : state.providers[id]?.note || `${label} not configured`)}">${label}</span>`;
    }).join('');
  }

  function keysForm() {
    if (!state.keysOpen) return '';
    const row = (id, label, placeholder) => `
      <label class="ce-studio-key">
        <span>${label}${state.providers[id]?.configured ? ' <em>saved</em>' : ''}</span>
        <span class="ce-studio-key__row">
          <input type="password" autocomplete="off" spellcheck="false" data-vp-key="${id}" placeholder="${placeholder}">
          ${iconButton({ name: 'check', label: `Save ${label} key`, attrs: `data-vp-save-key="${id}"` })}
        </span>
      </label>`;
    return `<div class="ce-studio-card ce-studio-keys">
      ${row('fal', 'fal.ai key', 'fal key')}
      ${row('higgsfield', 'Higgsfield key', 'API_ID:API_SECRET')}
      <p class="ce-studio-hint">Stored encrypted in the vault. Grok and OpenAI use your existing logins.</p>
    </div>`;
  }

  function projectBar() {
    const opts = state.projects.map((p) => `<option value="${esc(p.id)}"${state.project?.id === p.id ? ' selected' : ''}>${esc(p.title)} · ${p.shots} shots</option>`).join('');
    return `<div class="ce-studio-bar">
      <select class="ce-studio-select" data-vp-project title="Project">
        <option value="">${state.projects.length ? 'Select project…' : 'No projects yet'}</option>${opts}
      </select>
      ${iconButton({ name: 'plus', label: 'New project', attrs: 'data-vp-act="new-project"' })}
      ${state.project ? iconButton({ name: 'trash', label: 'Delete project', cls: 'ce-icon-btn is-danger', attrs: 'data-vp-act="delete-project"' }) : ''}
      ${iconButton({ name: 'key', label: 'Provider keys', attrs: 'data-vp-act="keys"', active: state.keysOpen })}
    </div>
    <div class="ce-studio-chips">${providerChips()}</div>
    ${keysForm()}`;
  }

  function emptyState() {
    return `<div class="ce-studio-empty">
      ${icon('sparkles', 28)}
      <h4>Generate a video from a brief</h4>
      <p>Create a project, add characters, plan shots, and generate them on Grok, OpenAI, fal or Higgsfield. Every take stays editable.</p>
      <button type="button" class="ce-studio-primary" data-vp-act="new-project">${icon('plus', 14)}<span>New project</span></button>
    </div>`;
  }

  function budgetMeter(p) {
    const cap = p.budget.capUsd;
    const pct = cap ? Math.min(100, (p.budget.spentUsd / cap) * 100) : 0;
    return `<div class="ce-studio-budget" title="Auto-approve under ${usd(p.budget.autoApproveUsd)}">
      <span>Spent <strong>${usd(p.budget.spentUsd)}</strong>${cap ? ` of ${usd(cap)}` : ''}</span>
      ${cap ? `<span class="ce-studio-budget__bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
      ${iconButton({ name: 'settings', label: 'Budget settings', attrs: 'data-vp-act="budget"', size: 13 })}
    </div>`;
  }

  function charactersSection(p) {
    const cards = p.characters.map((c) => `
      <div class="ce-studio-char" data-vp-char="${esc(c.id)}">
        ${mediaThumb(c.anchors?.[0], 'ce-studio-avatar')}
        <span class="ce-studio-char__name" title="${esc(c.notes || c.name)}">${esc(c.name)}</span>
        <span class="ce-studio-char__actions">
          ${iconButton({ name: 'camera', label: `Generate identity still for ${c.name}`, attrs: `data-vp-act="anchor" data-id="${esc(c.id)}"`, size: 13 })}
          ${iconButton({ name: 'trash', label: `Remove ${c.name}`, cls: 'ce-icon-btn is-danger', attrs: `data-vp-act="remove-char" data-id="${esc(c.id)}"`, size: 13 })}
        </span>
      </div>`).join('');
    return `<section class="ce-studio-section">
      <header><span>${icon('user', 13)} Characters</span>${iconButton({ name: 'plus', label: 'Add character', attrs: 'data-vp-act="add-char"', size: 14 })}</header>
      <div class="ce-studio-chars">${cards || '<p class="ce-studio-hint">Add a character to keep faces consistent across shots.</p>'}</div>
    </section>`;
  }

  function shotCard(p, s, i) {
    const take = selectedTake(s);
    const model = s.modelId || p.defaults.videoModel;
    const running = p.jobs.some((j) => (j.state === 'queued' || j.state === 'running') && j.target?.shotId === s.id);
    return `<div class="ce-studio-shot${state.selectedShotId === s.id ? ' is-selected' : ''}" data-vp-shot="${esc(s.id)}" tabindex="0">
      <div class="ce-studio-shot__media">
        ${mediaThumb(take?.path)}
        <span class="ce-studio-shot__n">${i + 1}</span>
        <span class="ce-studio-status is-${running ? 'generating' : s.status}">${running ? 'generating' : s.status}</span>
      </div>
      <div class="ce-studio-shot__body">
        <strong>${esc(s.title)}</strong>
        <p>${esc(s.prompt || 'No prompt yet')}</p>
        <span class="ce-studio-shot__meta">${s.durationSec}s · ${esc(String(model).split('/').pop())} · ${s.takes.length} take${s.takes.length === 1 ? '' : 's'}</span>
      </div>
      <div class="ce-studio-shot__actions">
        ${iconButton({ name: 'sparkles', label: 'Generate this shot', attrs: `data-vp-act="gen-shot" data-id="${esc(s.id)}"`, size: 14, disabled: running })}
        ${iconButton({ name: 'chevronUp', label: 'Move up', attrs: `data-vp-act="shot-up" data-id="${esc(s.id)}"`, size: 14, disabled: i === 0 })}
        ${iconButton({ name: 'chevronDown', label: 'Move down', attrs: `data-vp-act="shot-down" data-id="${esc(s.id)}"`, size: 14, disabled: i === p.shots.length - 1 })}
      </div>
    </div>`;
  }

  function jobsTray(p) {
    const active = p.jobs.filter((j) => j.state === 'queued' || j.state === 'running');
    const failed = p.jobs.filter((j) => j.state === 'failed').slice(-3);
    if (!active.length && !failed.length) return '';
    const label = (j) => {
      if (j.target?.shotId) return p.shots.find((s) => s.id === j.target.shotId)?.title || 'Shot';
      if (j.target?.characterId) return `${p.characters.find((c) => c.id === j.target.characterId)?.name || 'Character'} anchor`;
      return 'Asset';
    };
    return `<section class="ce-studio-section ce-studio-jobs">
      <header><span>${icon('refresh', 13)} Jobs</span></header>
      ${active.map((j) => `<div class="ce-studio-job"><span class="ce-studio-spinner"></span><span>${esc(label(j))} · ${esc(j.modelId.split('/').pop())}</span>${iconButton({ name: 'stop', label: 'Cancel job', attrs: `data-vp-act="cancel-job" data-id="${esc(j.id)}"`, size: 12 })}</div>`).join('')}
      ${failed.map((j) => `<div class="ce-studio-job is-failed" title="${esc(j.error || '')}">${icon('alert', 13)}<span>${esc(label(j))}: ${esc((j.error || 'failed').slice(0, 90))}</span></div>`).join('')}
    </section>`;
  }

  function renderBoard() {
    const p = state.project;
    if (!p) return emptyState();
    const readyShots = p.shots.filter((s) => selectedTake(s)).length;
    return `
      <div class="ce-studio-toolbar">
        ${iconButton({ name: 'undo', label: `Undo (${state.history.undo})`, attrs: 'data-vp-act="undo"', disabled: !state.history.undo })}
        ${iconButton({ name: 'redo', label: `Redo (${state.history.redo})`, attrs: 'data-vp-act="redo"', disabled: !state.history.redo })}
        <span class="ce-studio-toolbar__sep"></span>
        ${iconButton({ name: 'sequence', label: 'Assemble project timeline from selected takes', attrs: 'data-vp-act="assemble"', disabled: !readyShots })}
        ${iconButton({ name: 'timelineAdd', label: 'Send cut to editor timeline', attrs: 'data-vp-act="to-timeline"', disabled: !p.clips.length })}
        ${iconButton({ name: 'export', label: 'Render final MP4 (server)', attrs: 'data-vp-act="render"', disabled: !p.clips.length })}
        <span class="ce-studio-toolbar__spacer"></span>
        ${budgetMeter(p)}
      </div>
      <section class="ce-studio-section">
        <header><span>${icon('type', 13)} Brief</span>
          <span class="ce-studio-inline">
            <select class="ce-studio-select is-compact" data-vp-aspect title="Aspect ratio">${ASPECTS.map((a) => `<option${p.target.aspect === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
            ${iconButton({ name: 'sparkles', label: 'Plan shots with Prom', attrs: 'data-vp-act="plan"', size: 14 })}
          </span>
        </header>
        <textarea class="ce-studio-textarea" data-vp-brief rows="3" placeholder="30s coffee ad, same barista, 4 shots, warm morning light…">${esc(p.brief)}</textarea>
      </section>
      ${charactersSection(p)}
      <section class="ce-studio-section">
        <header><span>${icon('clapper', 13)} Shots <em>${p.shots.length}</em></span>
          <span class="ce-studio-inline">
            ${iconButton({ name: 'sparkles', label: 'Generate all draft shots', attrs: 'data-vp-act="gen-all"', size: 14, disabled: !p.shots.length })}
            ${iconButton({ name: 'plus', label: 'Add shot', attrs: 'data-vp-act="add-shot"', size: 14 })}
          </span>
        </header>
        <div class="ce-studio-shots">${p.shots.map((s, i) => shotCard(p, s, i)).join('') || '<p class="ce-studio-hint">No shots yet. Add one, or plan with Prom from the brief.</p>'}</div>
      </section>
      ${jobsTray(p)}
      ${state.renderPath ? `<section class="ce-studio-section"><header><span>${icon('film', 13)} Latest render</span></header>
        <video class="ce-studio-render" src="${esc(mediaUrl(state.renderPath))}" controls playsinline preload="metadata"></video>
        <p class="ce-studio-hint">${esc(state.renderPath)}</p></section>` : ''}`;
  }

  function renderInspector() {
    if (!inspector) return;
    const p = state.project;
    const s = p?.shots.find((x) => x.id === state.selectedShotId);
    if (!p || !s) {
      inspector.innerHTML = `<div class="ce-studio-empty is-compact">${icon('clapper', 22)}<p>Select a shot in Studio to edit its prompt, model and takes.</p></div>`;
      return;
    }
    const videoModels = state.models.filter((m) => m.kind === 'video');
    const current = s.modelId || p.defaults.videoModel;
    const modelOpts = videoModels.map((m) => {
      const ready = state.providers[m.provider]?.configured !== false;
      const price = m.pricing?.perSecondUsd ? ` · ${usd(m.pricing.perSecondUsd)}/s` : '';
      return `<option value="${esc(m.id)}"${m.id === current ? ' selected' : ''}${ready ? '' : ' disabled'}>${esc(m.label)}${price}${ready ? '' : ' (no key)'}</option>`;
    }).join('');
    const perSec = videoModels.find((m) => m.id === current)?.pricing?.perSecondUsd || 0;
    const takeCards = s.takes.slice().reverse().map((t) => `
      <div class="ce-studio-take${t.id === (selectedTake(s)?.id) ? ' is-selected' : ''}">
        ${isVideo(t.path)
          ? `<video src="${esc(mediaUrl(t.path))}" controls muted playsinline preload="metadata"></video>`
          : `<img src="${esc(mediaUrl(t.path))}" alt="">`}
        <div class="ce-studio-take__meta">
          <span>${esc(t.modelId.split('/').pop())} · ${usd(t.costUsd)}</span>
          <span class="ce-studio-inline">
            ${t.id === selectedTake(s)?.id
              ? `<span class="ce-studio-badge">${icon('check', 11)} In cut</span>`
              : iconButton({ name: 'check', label: 'Use this take', attrs: `data-vp-act="use-take" data-shot="${esc(s.id)}" data-id="${esc(t.id)}"`, size: 13 })}
            ${iconButton({ name: 'trash', label: 'Delete take', cls: 'ce-icon-btn is-danger', attrs: `data-vp-act="del-take" data-shot="${esc(s.id)}" data-id="${esc(t.id)}"`, size: 13 })}
          </span>
        </div>
      </div>`).join('');
    inspector.innerHTML = `<div class="ce-studio-inspector" data-vp-inspector="${esc(s.id)}">
      <label class="ce-studio-field"><span>Title</span><input data-vp-field="title" value="${esc(s.title)}"></label>
      <label class="ce-studio-field"><span>Prompt</span><textarea data-vp-field="prompt" rows="5" placeholder="What happens in this shot">${esc(s.prompt)}</textarea></label>
      <div class="ce-studio-grid2">
        <label class="ce-studio-field"><span>Camera</span><select data-vp-field="camera">${CAMERA_PRESETS.map((c) => `<option value="${esc(c)}"${(s.camera || '') === c ? ' selected' : ''}>${c || 'Auto'}</option>`).join('')}${s.camera && !CAMERA_PRESETS.includes(s.camera) ? `<option selected>${esc(s.camera)}</option>` : ''}</select></label>
        <label class="ce-studio-field"><span>Duration (s)</span><input type="number" min="1" max="60" step="1" data-vp-field="durationSec" value="${s.durationSec}"></label>
      </div>
      <label class="ce-studio-field"><span>Model</span><select data-vp-field="modelId">${modelOpts}</select></label>
      ${p.characters.length ? `<div class="ce-studio-field"><span>Characters</span><div class="ce-studio-checks">${p.characters.map((c) => `<label><input type="checkbox" data-vp-charpick="${esc(c.id)}"${s.characterIds.includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>` : ''}
      <label class="ce-studio-toggle"><input type="checkbox" data-vp-field="chainFromPrevious"${s.chainFromPrevious ? ' checked' : ''}> Start from the previous shot's last frame</label>
      <div class="ce-studio-genrow">
        <select class="ce-studio-select is-compact" data-vp-variations title="Variations">${[1, 2, 3, 4].map((n) => `<option value="${n}"${state.variations === n ? ' selected' : ''}>${n}×</option>`).join('')}</select>
        <button type="button" class="ce-studio-primary" data-vp-act="gen-variations" data-id="${esc(s.id)}">${icon('sparkles', 14)}<span>Generate</span></button>
        <span class="ce-studio-hint">≈ ${usd(perSec * s.durationSec * state.variations)}</span>
        <span class="ce-studio-toolbar__spacer"></span>
        ${iconButton({ name: 'trash', label: 'Delete shot', cls: 'ce-icon-btn is-danger', attrs: `data-vp-act="del-shot" data-id="${esc(s.id)}"` })}
      </div>
      <div class="ce-studio-takes">${takeCards || '<p class="ce-studio-hint">No takes yet.</p>'}</div>
    </div>`;
  }

  function render() {
    if (disposed || !container) return;
    const brief = container.querySelector('[data-vp-brief]');
    const hadFocus = brief && document.activeElement === brief;
    container.innerHTML = `<div class="ce-studio">
      ${projectBar()}
      ${state.error ? `<div class="ce-studio-error">${icon('alert', 13)}<span>${esc(state.error)}</span>${iconButton({ name: 'close', label: 'Dismiss', attrs: 'data-vp-act="dismiss"', size: 12 })}</div>` : ''}
      ${state.busy ? `<div class="ce-studio-busy"><span class="ce-studio-spinner"></span>${esc(state.busy)}…</div>` : ''}
      ${renderBoard()}
    </div>`;
    if (hadFocus) container.querySelector('[data-vp-brief]')?.focus();
    const insp = inspector?.querySelector('[data-vp-inspector]');
    const inspFocused = insp && insp.contains(document.activeElement);
    if (!inspFocused) renderInspector();
  }

  // ── events ─────────────────────────────────────────────────────────────
  async function onAction(act, el) {
    const p = state.project;
    const id = el.dataset.id;
    switch (act) {
      case 'dismiss': state.error = ''; render(); return;
      case 'keys': state.keysOpen = !state.keysOpen; render(); return;
      case 'new-project': {
        const title = window.prompt('Project name', 'Untitled video');
        if (!title) return;
        const res = await guard('Creating project', () => call('', { title, target: { aspect: '16:9', resolution: '720p', fps: 24 } }));
        if (res?.project) { await loadProjects(); await openProject(res.project.id); }
        return;
      }
      case 'delete-project': {
        if (!p || !window.confirm(`Delete "${p.title}" and all its generated media?`)) return;
        await guard('Deleting', () => api(`${BASE}/${p.id}`, { method: 'DELETE' }));
        try { localStorage.removeItem(LS_ACTIVE); } catch { /* ignore */ }
        state.project = null; closeEvents(); setTitle?.('');
        await loadProjects(); render(); return;
      }
      case 'budget': {
        if (!p) return;
        const auto = window.prompt('Auto-approve generations under ($):', String(p.budget.autoApproveUsd));
        if (auto === null) return;
        const cap = window.prompt('Project spending cap ($, blank for none):', p.budget.capUsd != null ? String(p.budget.capUsd) : '');
        if (cap === null) return;
        await ops([{ op: 'project.update', budget: { autoApproveUsd: Number(auto) || 0, capUsd: cap.trim() ? Number(cap) : null } }], 'Saving budget');
        return;
      }
      case 'undo': case 'redo': {
        if (!p) return;
        const res = await guard(act === 'undo' ? 'Undoing' : 'Redoing', () => call(`/${p.id}/${act}`, {}));
        applyProjectResponse(res); render(); return;
      }
      case 'plan': planWithProm(); return;
      case 'add-char': {
        const name = window.prompt('Character name');
        if (!name) return;
        const notes = window.prompt('Look / identity notes (optional)', '') || '';
        await ops([{ op: 'character.upsert', name, notes }], 'Adding character'); return;
      }
      case 'remove-char': await ops([{ op: 'character.remove', id }], 'Removing character'); return;
      case 'anchor': await generateAnchor(id); return;
      case 'add-shot': {
        const res = await ops([{ op: 'shot.add', title: `Shot ${(p?.shots.length || 0) + 1}` }], 'Adding shot');
        const last = res?.project?.shots?.[res.project.shots.length - 1];
        if (last) { state.selectedShotId = last.id; switchTab?.('right', 'shot'); render(); }
        return;
      }
      case 'shot-up': case 'shot-down': {
        const idx = p.shots.findIndex((s) => s.id === id);
        await ops([{ op: 'shot.move', id, index: idx + (act === 'shot-up' ? -1 : 1) }], 'Reordering'); return;
      }
      case 'del-shot': {
        if (!window.confirm('Delete this shot and its clips?')) return;
        await ops([{ op: 'shot.remove', id }], 'Deleting shot'); return;
      }
      case 'gen-shot': await generate([id], 1); return;
      case 'gen-all': {
        const drafts = p.shots.filter((s) => !s.takes.length).map((s) => s.id);
        await generate(drafts.length ? drafts : p.shots.map((s) => s.id), 1); return;
      }
      case 'gen-variations': await generate([id], state.variations); return;
      case 'use-take': await ops([{ op: 'take.select', shotId: el.dataset.shot, takeId: id }], 'Swapping take'); return;
      case 'del-take': await ops([{ op: 'take.remove', shotId: el.dataset.shot, takeId: id }], 'Removing take'); return;
      case 'cancel-job': await guard('Canceling', () => call(`/${p.id}/jobs/${id}/cancel`, {})); await openProject(p.id); return;
      case 'assemble': await ops([{ op: 'timeline.assemble' }], 'Assembling'); return;
      case 'to-timeline': sendCutToTimeline(); return;
      case 'render': await renderFinal(); return;
      default:
    }
  }

  async function onClick(e) {
    const actEl = e.target.closest('[data-vp-act]');
    if (actEl && !actEl.disabled) { e.stopPropagation(); await onAction(actEl.dataset.vpAct, actEl); return; }
    const saveKey = e.target.closest('[data-vp-save-key]');
    if (saveKey) {
      const provider = saveKey.dataset.vpSaveKey;
      const input = container.querySelector(`[data-vp-key="${provider}"]`);
      const key = String(input?.value || '').trim();
      if (!key) return;
      const res = await guard('Saving key', () => call(`/providers/${provider}/key`, { key }));
      if (res) { input.value = ''; await loadCatalog(); render(); }
      return;
    }
    const card = e.target.closest('[data-vp-shot]');
    if (card && !e.target.closest('video[controls]')) {
      state.selectedShotId = card.dataset.vpShot;
      switchTab?.('right', 'shot');
      render();
    }
  }

  async function onChange(e) {
    const t = e.target;
    if (t.matches('[data-vp-project]')) { state.renderPath = ''; await openProject(t.value); return; }
    if (t.matches('[data-vp-aspect]') && state.project) { await ops([{ op: 'project.update', target: { aspect: t.value } }], 'Saving'); return; }
    if (t.matches('[data-vp-variations]')) { state.variations = Number(t.value) || 1; renderInspector(); return; }
  }

  async function onBriefBlur(e) {
    if (!e.target.matches?.('[data-vp-brief]') || !state.project) return;
    const brief = e.target.value;
    if (brief !== state.project.brief) await ops([{ op: 'project.update', brief }], 'Saving brief');
  }

  // Inspector edits: one shot.update per committed field.
  async function onInspectorChange(e) {
    const root = e.target.closest('[data-vp-inspector]');
    if (!root || !state.project) return;
    const shotId = root.dataset.vpInspector;
    if (e.target.matches('[data-vp-variations]')) { state.variations = Number(e.target.value) || 1; renderInspector(); return; }
    if (e.target.matches('[data-vp-charpick]')) {
      const ids = [...root.querySelectorAll('[data-vp-charpick]')].filter((x) => x.checked).map((x) => x.dataset.vpCharpick);
      await ops([{ op: 'shot.update', id: shotId, characterIds: ids }], 'Saving'); renderInspector(); return;
    }
    const field = e.target.dataset.vpField;
    if (!field) return;
    let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (field === 'durationSec') value = Math.max(1, Math.min(60, Number(value) || 5));
    const shot = state.project.shots.find((s) => s.id === shotId);
    if (shot && shot[field] === value) return;
    await ops([{ op: 'shot.update', id: shotId, [field]: value }], 'Saving');
    renderInspector();
  }
  async function onInspectorClick(e) {
    const actEl = e.target.closest('[data-vp-act]');
    if (actEl && !actEl.disabled) { await onAction(actEl.dataset.vpAct, actEl); renderInspector(); }
  }

  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('focusout', onBriefBlur);
  inspector?.addEventListener('change', onInspectorChange);
  inspector?.addEventListener('click', onInspectorClick);

  (async () => {
    render();
    await Promise.all([loadCatalog(), loadProjects()]);
    let last = '';
    try { last = localStorage.getItem(LS_ACTIVE) || ''; } catch { /* ignore */ }
    const target = state.projects.find((x) => x.id === last)?.id || state.projects[0]?.id || '';
    if (target) await openProject(target); else render();
  })();

  return {
    render,
    reload: async () => { await loadProjects(); if (state.project) await openProject(state.project.id); },
    getProject: () => state.project,
    dispose() {
      disposed = true;
      closeEvents();
      clearTimeout(reloadTimer);
      container.removeEventListener('click', onClick);
      container.removeEventListener('change', onChange);
      container.removeEventListener('focusout', onBriefBlur);
      inspector?.removeEventListener('change', onInspectorChange);
      inspector?.removeEventListener('click', onInspectorClick);
    },
  };
}
