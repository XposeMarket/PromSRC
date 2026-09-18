import { escapeHtml, loading } from '../../ui/page-kit.js';
import { ICONS } from '../../ui/icons.js';

function itemsFrom(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function titleFor(item) {
  return String(item?.title || item?.name || item?.label || item?.kind || item?.agentId || 'Activity');
}

function dateFor(value) {
  const stamp = Number(new Date(value || 0));
  return stamp ? new Date(stamp).toLocaleString() : 'Time unavailable';
}

function titleCaseRun(value) {
  return String(value || 'Agent Run').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditAgent(entry) {
  const agent = String(entry?.agentId || '').trim();
  if (agent && !['main', 'unknown'].includes(agent.toLowerCase())) return agent;
  const session = String(entry?.sessionId || '').trim();
  if (/^team_dispatch_/.test(session)) return session.replace(/^team_dispatch_/, '').replace(/_\d+$/, '');
  if (/^team_coord_/.test(session)) return session.replace(/^team_coord_/, '').replace(/_\d+$/, '');
  if (/^meta_coordinator_/.test(session)) return session.replace(/^meta_coordinator_/, '').replace(/_\d+$/, '');
  if (session.startsWith('proposal_')) return 'proposal_executor';
  if (/^(cron_job_|schedule_)/.test(session)) return 'scheduled_task';
  if (/^(task_|bg_)/.test(session)) return 'background_task';
  return agent || session || 'agent';
}

function auditRunKind(entry) {
  const session = String(entry?.sessionId || '');
  const agent = String(entry?.agentId || '');
  if (session.startsWith('brain_dream_')) return 'Brain Dream';
  if (session.startsWith('brain_thought_')) return 'Brain Thought';
  if (session.startsWith('brain_')) return 'Brain Run';
  if (session.startsWith('team_dispatch_')) return `Subagent: ${titleCaseRun(session.replace(/^team_dispatch_/, '').replace(/_\d+$/, ''))}`;
  if (session.startsWith('team_coord_')) return `${titleCaseRun(session.replace(/^team_coord_/, '').replace(/_\d+$/, ''))} Team Manager`;
  if (session.startsWith('meta_coordinator_')) return `${titleCaseRun(session.replace(/^meta_coordinator_/, '').replace(/_\d+$/, ''))} Meta Coordinator`;
  if (session.startsWith('proposal_')) return 'Proposal';
  if (/^(cron_job_|schedule_)/.test(session) || agent === 'scheduled_task') return 'Scheduled Task';
  if (/^(task_|bg_)/.test(session) || agent === 'background_task') return 'Background Task';
  if (agent === 'team_coordinator') return 'Team Manager';
  if (agent === 'meta_coordinator') return 'Meta Coordinator';
  return 'Agent Run';
}

function groupedAuditRuns(response) {
  const suppliedRuns = itemsFrom(response, 'runs');
  if (suppliedRuns.some((run) => Array.isArray(run?.tools))) return suppliedRuns;
  const entries = itemsFrom(response, 'entries').length ? itemsFrom(response, 'entries')
    : itemsFrom(response, 'items').length ? itemsFrom(response, 'items') : suppliedRuns;
  const grouped = new Map();
  entries.forEach((entry) => {
    const agent = String(entry?.agentId || '').toLowerCase();
    const session = String(entry?.sessionId || '');
    if ((agent === 'main' || agent === 'unknown' || !agent) && !/^(team_|task_|bg_|proposal_|cron_|schedule_|meta_)/i.test(session)) return;
    const key = session || `${auditAgent(entry)}:${String(entry?.timestamp || '').slice(0, 13)}`;
    if (!grouped.has(key)) grouped.set(key, {
      key,
      sessionId: session,
      agentId: auditAgent(entry),
      kind: auditRunKind(entry),
      startedAt: entry?.timestamp || '',
      endedAt: entry?.timestamp || '',
      tools: [],
    });
    const run = grouped.get(key);
    run.tools.push(entry);
    if (entry?.timestamp && (!run.startedAt || entry.timestamp < run.startedAt)) run.startedAt = entry.timestamp;
    if (entry?.timestamp && (!run.endedAt || entry.timestamp > run.endedAt)) run.endedAt = entry.timestamp;
  });
  return [...grouped.values()].map((run) => ({
    ...run,
    status: run.tools.some((tool) => String(tool?.approvalStatus || '').toLowerCase() === 'pending') ? 'running'
      : run.tools.some((tool) => String(tool?.approvalStatus || '').toLowerCase() === 'rejected' || tool?.error) ? 'failed' : 'complete',
  })).sort((a, b) => Date.parse(b.endedAt || 0) - Date.parse(a.endedAt || 0));
}

function withDeadline(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} request timed out.`)), timeoutMs);
    Promise.resolve(promise).then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function memoryItemsFrom(response) {
  if (Array.isArray(response?.recent)) return response.recent;
  const graph = response?.graph && typeof response.graph === 'object' ? response.graph : response;
  return itemsFrom(graph, 'nodes');
}

function memoryOrbit(nodes, limit = 72) {
  const dots = nodes.slice(0, limit).map((node, index) => {
    const angle = index * 137.5 * Math.PI / 180;
    const radius = Math.min(43, 8 + Math.sqrt(index + 1) * 7.2);
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    const hue = Number(node?.degree || 0) > 6 ? '#ff8a2a' : Number(node?.degree || 0) > 3 ? '#a78bfa' : '#55c4ff';
    return `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;background:${hue}"></i>`;
  }).join('');
  return `<div class="pm-memory-orbit" aria-hidden="true"><div class="pm-memory-core"></div>${dots}</div>`;
}

function cardTop(icon, title, subtitle) {
  return `<div class="pm-more-card-top"><span class="pm-more-icon">${icon}</span><span><strong>${escapeHtml(title)}</strong><em>${escapeHtml(subtitle)}</em></span><span class="pm-chev">${ICONS.chevron}</span></div>`;
}

export async function mountMorePage({ shell, features }) {
  shell.setActiveTab('chat');
  shell.setTitle('More');
  shell.renderHeader?.({ leftIcon: 'menu' });
  const page = shell.page;
  let disposed = false;
  let loadGeneration = 0;
  let latestAudit = [];
  let latestMemory = [];
  let auditError = '';
  let memoryError = '';
  page.innerHTML = `<div class="pm-more-page" id="pm-v2-more-body" style="padding-top:4px">
    <button class="pm-more-card pm-more-card-audit" data-more-route="audit" type="button">${cardTop(ICONS.clipboard, 'Audit', 'Recent non-main agent runs')}<div class="pm-run-mini-list">${loading('Loading audit…')}</div></button>
    <button class="pm-more-card pm-more-card-memory" data-more-route="memory" type="button">${cardTop(ICONS.spark, 'Memory', 'Latest graph additions')}<div class="pm-memory-mini">${memoryOrbit([])}<div class="pm-memory-mini-list"><span><b>Loading memory…</b></span></div></div></button>
    <section class="pm-more-card" style="cursor:default">${cardTop(ICONS.doc, 'App health', 'Refresh activity or reload V2 assets')}<div style="display:flex;flex-direction:column;gap:8px;padding-top:6px"><button class="pm-btn ghost" id="pm-v2-more-refresh" type="button" style="justify-content:center">↻ Refresh recent activity</button><button class="pm-btn ghost" id="pm-v2-reload-assets" type="button" style="justify-content:center">Reload latest assets</button><span style="font-size:11px;color:var(--pm-muted);line-height:1.5">Reload this V2 app after a gateway update. Your pairing and chats remain saved.</span></div></section>
    <button class="pm-more-card" data-more-route="gateways" type="button">${cardTop(ICONS.users, 'Gateway Connections', 'Manage paired Prometheus computers')}<div class="pm-more-list"><span><b>Connections</b><em>Pair, reconnect, or switch gateways.</em></span></div></button>
    <button class="pm-more-card" data-more-route="settings" type="button">${cardTop(ICONS.person, 'Settings', 'Appearance, install, heartbeat, and voice')}<div class="pm-more-list"><span><b>Mobile settings</b><em>Adjust the V2 app on this device.</em></span></div></button>
    <button class="pm-more-card" data-more-route="creative" type="button">${cardTop(ICONS.spark, 'Creative Studio', 'Generate images and video')}<div class="pm-more-list"><span><b>Make something</b><em>Choose a provider, prompt, and output type.</em></span></div></button>
  </div>`;
  page.querySelectorAll('[data-more-route]').forEach((button) => button.addEventListener('click', () => shell.navigate?.(button.dataset.moreRoute)));
  page.querySelector('#pm-v2-reload-assets')?.addEventListener('click', () => window.location.reload());
  page.querySelector('#pm-v2-more-refresh')?.addEventListener('click', load);

  function paintAudit() {
    const host = page.querySelector('.pm-run-mini-list');
    if (!host) return;
    host.innerHTML = latestAudit.length ? latestAudit.slice(0, 3).map((run) => `<span><b>${escapeHtml(titleFor(run))}</b><em>${escapeHtml(dateFor(run.endedAt || run.startedAt || run.updatedAt))}</em><small>${escapeHtml(run.status || 'Recorded')}</small></span>`).join('') : `<span><b>${auditError ? 'Audit is temporarily unavailable.' : 'No agent runs recorded yet.'}</b><em>${auditError ? `${escapeHtml(auditError)} Tap refresh to try again.` : 'Recent activity will appear here.'}</em></span>`;
  }

  function paintMemory() {
    const host = page.querySelector('.pm-memory-mini');
    if (!host) return;
    host.innerHTML = `${memoryOrbit(latestMemory)}<div class="pm-memory-mini-list">${latestMemory.length ? latestMemory.slice(0, 3).map((node) => `<span><b>${escapeHtml(titleFor(node))}</b><em>${escapeHtml(node.type || node.kind || node.sourceTypeLabel || node.sourceType || 'Memory')} · ${escapeHtml(dateFor(node.timestamp || node.updatedAt || node.createdAt))}</em></span>`).join('') : `<span><b>${memoryError ? 'Memory is temporarily unavailable.' : 'No recent memory items.'}</b><em>${memoryError ? `${escapeHtml(memoryError)} Tap refresh to try again.` : 'Associative memory updates will appear here.'}</em></span>`}</div>`;
  }

  async function load() {
    const generation = ++loadGeneration;
    latestAudit = [];
    latestMemory = [];
    auditError = '';
    memoryError = '';
    const auditHost = page.querySelector('.pm-run-mini-list');
    const memoryHost = page.querySelector('.pm-memory-mini-list');
    if (auditHost) auditHost.innerHTML = loading('Loading audit…');
    if (memoryHost) memoryHost.innerHTML = '<span><b>Loading memory…</b></span>';

    const loadAudit = withDeadline(features.audit(24, 4500), 5000, 'Audit').then((audit) => {
      if (audit?.success === false) throw new Error(audit.error || 'Could not load audit.');
      if (disposed || generation !== loadGeneration) return;
      latestAudit = groupedAuditRuns(audit).sort((a, b) => Date.parse(b.endedAt || b.startedAt || 0) - Date.parse(a.endedAt || a.startedAt || 0));
      paintAudit();
    }).catch((error) => {
      if (disposed || generation !== loadGeneration) return;
      latestAudit = [];
      auditError = String(error?.message || 'Could not load audit.');
      paintAudit();
    });
    const loadMemory = withDeadline(features.memory(3300), 3500, 'Memory').then((memory) => {
      if (memory?.success === false) throw new Error(memory.error || 'Could not load memory.');
      if (disposed || generation !== loadGeneration) return;
      latestMemory = memoryItemsFrom(memory).sort((a, b) => Date.parse(b.timestamp || b.updatedAt || b.createdAt || 0) - Date.parse(a.timestamp || a.updatedAt || a.createdAt || 0));
      paintMemory();
    }).catch((error) => {
      if (disposed || generation !== loadGeneration) return;
      latestMemory = [];
      memoryError = String(error?.message || 'Could not load memory.');
      paintMemory();
    });
    await Promise.all([loadAudit, loadMemory]);
  }

  load();
  return () => { disposed = true; };
}

const CREATIVE_PROVIDERS = {
  image: [
    { id: 'xai', label: 'xAI Image', mark: '𝕏' },
    { id: 'openai', label: 'OpenAI Image', mark: '◎' },
    { id: 'hf', label: 'HyperFrames', mark: '▧' },
  ],
  video: [
    { id: 'xai', label: 'xAI Video', mark: '𝕏' },
    { id: 'hf', label: 'HyperFrames', mark: '▧' },
  ],
};

const CREATIVE_ICONS = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 18l9 5 9-5"/></svg>',
  preset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 14.9 8.6 22 9.3 16.6 14 18.2 21 12 17.4 5.8 21 7.4 14 2 9.3 9.1 8.6 12 2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
};

const CREATIVE_TEMPLATES = [
  { id: 'chibi', title: 'Chibi', hint: 'Cute & stylized', prompt: 'Adorable chibi-style character portrait, soft lighting, vivid colors, big expressive eyes, clean studio background, high-detail illustration.' },
  { id: 'headshot', title: 'Professional Headshot', hint: 'Clean & polished', prompt: 'Professional studio headshot, soft natural light, neutral background, sharp focus, photorealistic, business attire, confident expression.' },
  { id: 'bg-gen', title: 'Background Generator', hint: 'Scenic & textures', prompt: 'Cinematic background plate with rich textures, depth, no characters, balanced composition for a product hero shot.' },
  { id: 'street70s', title: '70s Street Style', hint: 'Vintage mood', prompt: '1970s street fashion photograph, grainy film, warm tones, urban backdrop, golden hour, candid pose.' },
];

const CREATIVE_MOTION_PRESETS = [
  { id: 'flythrough', title: 'Sci-Fi Flythrough', prompt: 'Slow cinematic flythrough across a futuristic floating city above the clouds, fighter jets escorting the camera, golden hour, 6 seconds, smooth motion.' },
  { id: 'neon', title: 'Neon Streets', prompt: 'Walking POV down neon-lit night streets, rain-slicked asphalt, blade-runner palette, slow handheld motion, 4 seconds.' },
  { id: 'sunrise', title: 'Mountain Sunrise', prompt: 'Time-lapse sunrise over a mountain lake reflecting pink and amber clouds, drifting mist, 5 seconds.' },
  { id: 'cozy', title: 'Cozy Interior', prompt: 'Slow dolly through a warm cozy living room, fireplace glow, soft sunbeams through window, vintage decor, 3 seconds.' },
];

const CREATIVE_ASPECTS = {
  image: [
    { id: 'portrait', label: '2:3', ratio: 'portrait' },
    { id: 'square', label: '1:1', ratio: 'square' },
    { id: 'landscape', label: '3:2', ratio: 'landscape' },
  ],
  video: [
    { id: 'landscape', label: '16:9', ratio: 'landscape' },
    { id: 'square', label: '1:1', ratio: 'square' },
    { id: 'portrait', label: '9:16', ratio: 'portrait' },
  ],
};

function flattenGallery(body, kind) {
  const output = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value === 'string') { output.push({ name: value.split('/').pop(), path: value }); return; }
    if (typeof value !== 'object') return;
    const path = String(value.path || value.relPath || value.relativePath || value.file || '');
    const name = String(value.name || path.split('/').pop() || '');
    const type = String(value.type || value.kind || '').toLowerCase();
    if (path && type !== 'directory' && type !== 'dir') output.push({ ...value, name, path });
    for (const key of ['files', 'children', 'items', 'entries', 'tree']) if (value[key]) visit(value[key]);
  };
  visit(body);
  const matches = kind === 'video' ? /\.(mp4|webm|mov|m4v|gif)$/ : /\.(png|jpe?g|webp|gif|avif)$/;
  const unique = new Map();
  output.forEach((item) => { if (matches.test(String(item.path || '').toLowerCase())) unique.set(item.path, item); });
  return [...unique.values()].sort((a, b) => Number(b.mtime || b.updatedAt || 0) - Number(a.mtime || a.updatedAt || 0));
}

async function creativeGallery(gateway, kind) {
  const root = kind === 'video' ? 'generated/videos' : 'generated/images';
  return flattenGallery(await gateway.request(`/api/canvas/files?root=${encodeURIComponent(root)}`), kind);
}

export async function mountCreativePage({ shell, gateways }) {
  shell.setActiveTab('chat');
  shell.setTitle('Creative');
  shell.renderHeader?.({ leftIcon: 'menu' });
  const page = shell.page;
  let mode = 'image';
  let provider = 'xai';
  let aspect = { image: 'portrait', video: 'landscape' };
  let agentEnabled = false;
  let busy = false;
  let sessionId = `mobile_v2_creative_${mode}`;
  let disposed = false;
  let galleryGeneration = { image: 0, video: 0 };
  let galleries = { image: [], video: [] };
  let currentResult = null;
  let extract = { busy: false, requestId: '', stages: [] };
  let lastExtraction = null;
  const overlays = new Set();
  const extractStageWeights = {
    source_loaded: 8, vision_candidates: 22, text_candidates: 32, proposal_merge: 38,
    foreground_start: 44, foreground_mask: 56, sam_start: 60, sam_masks: 74,
    alpha_cutouts: 78, vector_trace: 82, inpaint_start: 86, clean_plate: 94,
    scene_assembled: 96, layer_assets_saved: 100,
  };

  function paintProviders() {
    const host = page.querySelector('[data-creative-providers]');
    if (!host) return;
    host.innerHTML = CREATIVE_PROVIDERS[mode].map((item) => `<button type="button" class="pm-creative-provider ${provider === item.id ? 'active' : ''}" data-provider="${item.id}"><span class="pm-creative-provider-mark">${item.mark}</span><span>${escapeHtml(item.label)}</span></button>`).join('');
    host.querySelectorAll('[data-provider]').forEach((button) => button.addEventListener('click', () => {
      provider = button.dataset.provider;
      paintProviders();
      const label = page.querySelector('[data-creative-provider-label]');
      if (label) label.textContent = CREATIVE_PROVIDERS[mode].find((item) => item.id === provider)?.label || 'Auto';
    }));
  }

  function mediaName(path) { return String(path || '').split('/').pop() || 'Output'; }
  function formattedName(path) { return mediaName(path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 32); }
  function timeAgo(value) {
    const stamp = Number(value || 0);
    if (!stamp) return 'Time unavailable';
    const delta = Math.max(0, Date.now() - stamp);
    if (delta < 60_000) return 'now';
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
    return `${Math.floor(delta / 86_400_000)}d ago`;
  }

  async function loadImageDataUrl(path) {
    try {
      const data = await gateways.active.request(`/api/canvas/download?path=${encodeURIComponent(path)}`);
      if (data?.success && data.isImage && data.base64 && data.mimeType) return `data:${data.mimeType};base64,${data.base64}`;
    } catch {}
    return '';
  }

  function galleryCard(item, kind) {
    const path = String(item.path || '');
    const url = gateways.active.inlineMediaUrl(path);
    return `<button type="button" class="pm-creative-gallery-card" data-gallery-path="${escapeHtml(path)}" data-gallery-kind="${kind}">
      ${kind === 'video' ? `<span class="pm-creative-thumb video"><video src="${escapeHtml(url)}#t=0.1" muted playsinline preload="metadata"></video><span class="pm-creative-thumb-play">${ICONS.spark}</span></span>` : `<span class="pm-creative-thumb"><img src="${escapeHtml(url)}" alt="${escapeHtml(item.name || 'Generated image')}" loading="lazy"/></span>`}
      <strong>${escapeHtml(formattedName(path))}</strong><small>${escapeHtml(mediaName(path).split('.').pop())} · ${escapeHtml(timeAgo(item.mtime))}</small>
    </button>`;
  }

  function bindGalleryCards(root = page) {
    root.querySelectorAll('[data-gallery-path]').forEach((button) => button.addEventListener('click', async () => {
      const path = button.dataset.galleryPath;
      const kind = button.dataset.galleryKind || mode;
      if (!path) return;
      currentResult = { kind, path };
      if (kind === 'image') currentResult.dataUrl = await loadImageDataUrl(path);
      paintCurrentResult();
      const galleryOverlay = root.closest('.pm-creative-sheet-overlay');
      if (galleryOverlay) { galleryOverlay.remove(); overlays.delete(galleryOverlay); }
      page.querySelector('[data-creative-stage]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function paintGallery(items = galleries[mode]) {
    const host = page.querySelector('[data-creative-gallery]');
    if (!host) return;
    host.innerHTML = items.length ? items.slice(0, 12).map((item) => galleryCard(item, mode)).join('') : `<div class="pm-creative-gallery-empty"><span>${mode === 'video' ? CREATIVE_ICONS.video : CREATIVE_ICONS.image}</span><span>No ${mode === 'video' ? 'renders' : 'images'} yet — generate one below.</span></div>`;
    bindGalleryCards(host);
  }

  async function loadGallery(kind = mode) {
    const host = page.querySelector('[data-creative-gallery]');
    const generation = ++galleryGeneration[kind];
    if (host && kind === mode) host.innerHTML = loading('Loading gallery…');
    try {
      const items = await creativeGallery(gateways.active, kind);
      if (disposed || generation !== galleryGeneration[kind]) return;
      galleries[kind] = items;
      if (kind === mode) paintGallery(items);
    } catch (error) {
      if (!disposed && generation === galleryGeneration[kind] && host && kind === mode) host.innerHTML = `<div class="pm-v2-error-card">${escapeHtml(error?.message || 'Gallery unavailable.')}</div>`;
    }
  }

  async function refreshGallery() {
    await Promise.all([loadGallery('image'), loadGallery('video')]);
  }

  function setResultMessage(message) {
    const result = page.querySelector('[data-creative-result]');
    if (result) result.textContent = message || '';
  }

  function paintCurrentResult() {
    const imageHost = page.querySelector('[data-image-current]');
    const videoHost = page.querySelector('[data-video-preview]');
    const meta = page.querySelector('[data-video-meta]');
    if (imageHost) imageHost.innerHTML = currentResult?.kind === 'image' ? `<div class="pm-creative-current-image">
      <div class="pm-creative-current-thumb"><img src="${escapeHtml(currentResult.dataUrl || gateways.active.inlineMediaUrl(currentResult.path))}" alt="${escapeHtml(formattedName(currentResult.path))}"/></div>
      <div class="pm-creative-current-meta"><strong>${escapeHtml(formattedName(currentResult.path))}</strong><small>${escapeHtml(currentResult.path)}</small>
        <div class="pm-creative-current-actions"><button class="pm-btn primary" type="button" data-extract-current>${CREATIVE_ICONS.layers} Extract Layers</button><a class="pm-btn ghost" download="${escapeHtml(mediaName(currentResult.path))}" href="${escapeHtml(currentResult.dataUrl || gateways.active.inlineMediaUrl(currentResult.path))}">Save</a></div>
      </div></div>` : '';
    imageHost?.querySelector('[data-extract-current]')?.addEventListener('click', () => runExtractLayers(currentResult?.path));
    if (videoHost) {
      if (currentResult?.kind === 'video') {
        const src = gateways.active.inlineMediaUrl(currentResult.path);
        videoHost.innerHTML = `<video data-current-video src="${escapeHtml(src)}" controls playsinline preload="metadata"></video>`;
        const video = videoHost.querySelector('video');
        if (meta) meta.hidden = false;
        video?.addEventListener('loadedmetadata', () => {
          const height = video.videoHeight || 0;
          const width = video.videoWidth || 0;
          const resolution = height >= 1080 ? '1080p' : height >= 720 ? '720p' : height >= 480 ? '480p' : (width && height ? `${width}x${height}` : '—');
          const duration = Number.isFinite(video.duration) ? `${Math.round(video.duration)}s` : '—';
          const res = page.querySelector('[data-meta-res]');
          const dur = page.querySelector('[data-meta-dur]');
          if (res) res.textContent = resolution;
          if (dur) dur.textContent = duration;
        }, { once: true });
        video?.addEventListener('error', () => {
          if (videoHost.isConnected) videoHost.innerHTML = `<div class="pm-creative-preview-stub">${ICONS.doc}<strong>${escapeHtml(formattedName(currentResult.path))}</strong><small>${escapeHtml(currentResult.path)}</small><span class="pm-creative-preview-hint">Couldn’t load this render. Refresh and try again.</span></div>`;
        }, { once: true });
      } else {
        videoHost.innerHTML = `<div class="pm-creative-preview-empty"><div class="pm-empty-icon">${ICONS.doc}</div><p>Generated video will appear here.</p></div>`;
        if (meta) meta.hidden = true;
      }
    }
    paintExtractionOutput();
  }

  function paintExtractionOutput() {
    const host = page.querySelector('[data-extraction-output]');
    if (!host) return;
    const result = lastExtraction;
    if (!result) { host.innerHTML = ''; return; }
    const layers = Array.isArray(result.layers) ? result.layers : [];
    const warnings = Array.isArray(result.diagnostics?.warnings) ? result.diagnostics.warnings : [];
    host.innerHTML = `<section class="pm-card pm-v2-card" style="margin-top:12px"><div class="pm-v2-card-title">${ICONS.spark} Editable scene ready</div>
      <p style="margin:0 0 9px;color:var(--pm-muted);font-size:12px">${layers.length} layer${layers.length === 1 ? '' : 's'} · ${escapeHtml(result.scene?.width || '—')} × ${escapeHtml(result.scene?.height || '—')}</p>
      ${result.scenePath ? `<a class="pm-btn ghost" style="display:inline-flex;text-decoration:none;margin-bottom:8px" href="${escapeHtml(gateways.active.inlineMediaUrl(result.scenePath))}" target="_blank" rel="noopener">Open scene JSON</a>` : ''}
      <div style="display:flex;flex-direction:column;gap:7px">${layers.slice(0, 8).map((layer) => {
        const previewPath = String(layer.cutoutPath || layer.vectorPath || '');
        return `<div style="display:flex;align-items:center;gap:9px;padding:7px;border:1px solid var(--pm-border);border-radius:11px;background:var(--pm-bg-soft,var(--pm-surface))">${previewPath ? `<img src="${escapeHtml(gateways.active.inlineMediaUrl(previewPath))}" alt="" loading="lazy" style="width:42px;height:42px;object-fit:contain;border-radius:8px;background:var(--pm-surface);flex:0 0 auto"/>` : `<span style="width:42px;height:42px;display:grid;place-items:center;border-radius:8px;background:var(--pm-surface);color:var(--pm-muted);flex:0 0 auto">${ICONS.doc}</span>`}<span style="min-width:0"><strong style="display:block;font-size:12px">${escapeHtml(layer.name || layer.label || layer.type || 'Layer')}</strong><small style="display:block;color:var(--pm-muted);font-size:11px">${escapeHtml(layer.type || 'element')}${previewPath ? ` · ${escapeHtml(previewPath.split('/').pop())}` : ''}</small></span></div>`;
      }).join('') || '<div class="pm-creative-gallery-empty">No editable sublayers were detected; the scene preserves its background reference.</div>'}</div>
      ${warnings.length ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--pm-muted);font-size:12px">${warnings.length} note${warnings.length === 1 ? '' : 's'}</summary><ul style="padding-left:18px;color:var(--pm-muted);font-size:12px">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></details>` : ''}</section>`;
  }

  function paint() {
    const selectedAspect = CREATIVE_ASPECTS[mode].find((item) => item.id === aspect[mode]) || CREATIVE_ASPECTS[mode][0];
    page.innerHTML = `<div class="pm-creative pm-v2-creative-page" data-creative-mode="${mode}">
      <h1 class="pm-creative-title">Creative Studio</h1>
      <div class="pm-creative-status"><span class="pm-creative-dot"></span> Online</div>
      <div class="pm-creative-modeswitch" data-creative-mode-switch><button type="button" class="${mode === 'image' ? 'active' : ''}" data-mode="image">${CREATIVE_ICONS.image}<span>Image</span></button><button type="button" class="${mode === 'video' ? 'active' : ''}" data-mode="video">${CREATIVE_ICONS.video}<span>Video</span></button></div>
      <div class="pm-creative-providers" data-creative-providers></div>
      <div class="pm-creative-actions"><button type="button" class="pm-creative-action" data-action="upload">${CREATIVE_ICONS.upload} <span>Upload</span></button><button type="button" class="pm-creative-action accent" data-action="secondary">${mode === 'image' ? CREATIVE_ICONS.layers : CREATIVE_ICONS.upload} <span>${mode === 'image' ? 'Extract Layers' : 'Export'}</span></button><button type="button" class="pm-creative-action" data-action="presets">${CREATIVE_ICONS.preset} <span>Presets</span> ${ICONS.chevron}</button></div>
      <input type="file" data-creative-upload hidden accept="${mode === 'video' ? 'video/*,image/*' : 'image/*'}"/>
      <section class="pm-creative-section" data-creative-stage ${mode === 'video' ? 'hidden' : ''}>
        <div data-image-current></div>
        <div class="pm-creative-section-head"><h2>Featured Templates</h2><button class="pm-creative-link" type="button" data-link="templates">View all</button></div>
        <div class="pm-creative-templates">${CREATIVE_TEMPLATES.map((item, index) => `<button type="button" class="pm-creative-template" data-template="${index}"><span class="pm-creative-template-thumb">${CREATIVE_ICONS.image}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.hint)}</small></button>`).join('')}</div>
        <div data-extraction-output></div>
      </section>
      <section class="pm-creative-section" data-video-stage ${mode === 'image' ? 'hidden' : ''}><div class="pm-creative-preview" data-video-preview></div><div class="pm-creative-chiprow" data-video-meta hidden><span class="pm-creative-chip">${CREATIVE_ICONS.eye} <span data-meta-res>720p</span></span><span class="pm-creative-chip">${CREATIVE_ICONS.clock} <span data-meta-dur>—</span></span><span class="pm-creative-chip ok"><span class="pm-creative-dot"></span> Timeline live</span></div></section>
      <div class="pm-v2-prose" data-creative-result aria-live="polite"></div>
      <section class="pm-creative-section" data-gallery-section><div class="pm-creative-section-head"><h2>${mode === 'video' ? 'Recent renders' : 'Discover'}</h2><button type="button" class="pm-creative-link" data-link="gallery">View all</button></div><div class="pm-creative-gallery" data-creative-gallery></div></section>
      ${mode === 'video' ? `<section class="pm-creative-section"><div class="pm-creative-quickrow"><button type="button" class="pm-creative-quick" data-quick="create-hf"><span class="pm-creative-quick-icon">${ICONS.spark}</span><div><strong>Create HyperFrame</strong><small>Generate motion with deterministic frames.</small></div>${ICONS.chevron}</button><button type="button" class="pm-creative-quick" data-quick="motion-preset"><span class="pm-creative-quick-icon">${CREATIVE_ICONS.layers}</span><div><strong>Motion preset</strong><small>Sci-Fi Flythrough · View & edit preset</small></div>${ICONS.chevron}</button></div></section>` : ''}
      <form class="pm-creative-composer" data-creative-form><span class="pm-glass-lens" aria-hidden="true"></span><div class="pm-creative-composer-row"><button type="button" class="pm-icon-btn" data-composer="add" aria-label="Attach">${ICONS.plus}</button><input type="text" class="pm-creative-input" name="prompt" data-creative-prompt placeholder="${mode === 'video' ? 'Describe the motion you want…' : 'Type to imagine'}" autocomplete="off"/><button type="button" class="pm-icon-btn" data-composer="voice" aria-label="Voice">${ICONS.mic}</button><button type="submit" class="pm-creative-send${busy ? ' busy' : ''}" aria-label="Generate" ${busy ? 'disabled' : ''}>${busy ? '…' : ICONS.send}</button></div><div class="pm-creative-composer-meta"><button type="button" class="pm-creative-meta-chip" data-meta="agent">${ICONS.robot} Agent <small>${agentEnabled ? 'On' : 'Beta'}</small></button><button type="button" class="pm-creative-meta-chip accent" data-meta="kind">${mode === 'video' ? CREATIVE_ICONS.video : CREATIVE_ICONS.image} <span>${mode === 'video' ? 'Video' : 'Image'}</span></button><button type="button" class="pm-creative-meta-chip" data-meta="aspect">${CREATIVE_ICONS.monitor} <span data-aspect-label>${selectedAspect.label}</span> ${ICONS.chevron}</button><button type="button" class="pm-creative-meta-chip" data-meta="outputs">${CREATIVE_ICONS.eye} View outputs ${ICONS.chevron}</button></div></form>
      <div class="pm-creative-extract-modal" data-extract-modal hidden><div class="pm-creative-extract-card"><div class="pm-creative-extract-icon">${CREATIVE_ICONS.layers}</div><h3 data-extract-stage>Extracting layers</h3><p data-extract-detail class="pm-card-body">Preparing layer analysis…</p><div class="pm-creative-extract-bar"><div data-extract-fill></div></div><ul class="pm-creative-extract-stages" data-extract-stages></ul><button class="pm-btn ghost" type="button" data-extract-close>Hide</button></div></div>
    </div>`;
    paintProviders();
    page.querySelector('[data-creative-gallery]')?.replaceChildren();
    paintGallery(galleries[mode]);
    paintCurrentResult();
    page.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
      mode = button.dataset.mode;
      if (!CREATIVE_PROVIDERS[mode].some((item) => item.id === provider)) provider = CREATIVE_PROVIDERS[mode][0].id;
      aspect[mode] = CREATIVE_ASPECTS[mode][0].id;
      sessionId = `mobile_v2_creative_${mode}`;
      paint();
      loadGallery(mode);
    }));
    page.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => {
      const item = CREATIVE_TEMPLATES[Number(button.dataset.template)];
      const input = page.querySelector('[data-creative-prompt]');
      if (item && input) { input.value = item.prompt; input.focus(); }
    }));
    page.querySelector('[data-link="templates"]')?.addEventListener('click', () => openPresetSheet('image'));
    page.querySelector('[data-link="gallery"]')?.addEventListener('click', openGallerySheet);
    page.querySelector('[data-creative-form]')?.addEventListener('submit', generate);
    page.querySelector('[data-extract-close]')?.addEventListener('click', () => { const modal = page.querySelector('[data-extract-modal]'); if (modal) modal.hidden = true; });
    page.querySelector('[data-extract-modal]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.hidden = true; });
    page.querySelector('[data-creative-upload]')?.addEventListener('change', uploadSelectedFile, { once: true });
    page.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.action === 'upload') page.querySelector('[data-creative-upload]')?.click();
      else if (button.dataset.action === 'presets') openPresetSheet(mode);
      else if (mode === 'image') runExtractLayers(currentResult?.kind === 'image' ? currentResult.path : galleries.image[0]?.path || '');
      else {
        const path = currentResult?.kind === 'video' ? currentResult.path : galleries.video[0]?.path;
        if (!path) { shell.showNotice('Generate or upload a video first.'); return; }
        window.open(gateways.active.inlineMediaUrl(path), '_blank', 'noopener');
      }
    }));
    page.querySelectorAll('[data-composer]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.composer === 'add') page.querySelector('[data-creative-upload]')?.click();
      else shell.navigate?.('voice');
    }));
    page.querySelectorAll('[data-meta]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.meta === 'aspect') openAspectSheet();
      else if (button.dataset.meta === 'kind') {
        mode = mode === 'image' ? 'video' : 'image';
        if (!CREATIVE_PROVIDERS[mode].some((item) => item.id === provider)) provider = CREATIVE_PROVIDERS[mode][0].id;
        aspect[mode] = CREATIVE_ASPECTS[mode][0].id;
        sessionId = `mobile_v2_creative_${mode}`;
        paint();
        loadGallery(mode);
      } else if (button.dataset.meta === 'agent') {
        agentEnabled = !agentEnabled;
        const label = button.querySelector('small');
        if (label) label.textContent = agentEnabled ? 'On' : 'Beta';
      } else openGallerySheet();
    }));
    page.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.quick === 'create-hf') {
        mode = 'video'; provider = 'hf'; sessionId = 'mobile_v2_creative_video'; aspect.video = CREATIVE_ASPECTS.video[0].id;
        paint(); loadGallery('video'); page.querySelector('[data-creative-prompt]')?.focus();
      } else openPresetSheet('video');
    }));
  }

  function addOverlay(html) {
    const overlay = document.createElement('div');
    overlay.className = 'pm-creative-sheet-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    overlays.add(overlay);
    const remove = () => { overlay.remove(); overlays.delete(overlay); };
    overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('[data-close]')) remove(); });
    return { overlay, remove };
  }

  function openAspectSheet() {
    const options = CREATIVE_ASPECTS[mode];
    const { overlay, remove } = addOverlay(`<div class="pm-creative-sheet"><h3>Aspect ratio</h3><div class="pm-creative-sheet-options">${options.map((item) => `<button type="button" data-aspect="${item.id}" class="${aspect[mode] === item.id ? 'active' : ''}">${item.label}<small>${item.ratio}</small></button>`).join('')}</div><button type="button" class="pm-btn ghost" data-close>Cancel</button></div>`);
    overlay.querySelectorAll('[data-aspect]').forEach((button) => button.addEventListener('click', () => {
      aspect[mode] = button.dataset.aspect;
      const selected = options.find((item) => item.id === aspect[mode]);
      const label = page.querySelector('[data-aspect-label]');
      if (label && selected) label.textContent = selected.label;
      remove();
    }));
  }

  function openPresetSheet(kind = mode) {
    const list = kind === 'video' ? CREATIVE_MOTION_PRESETS : CREATIVE_TEMPLATES;
    const { overlay, remove } = addOverlay(`<div class="pm-creative-sheet"><h3>${kind === 'video' ? 'Motion presets' : 'Image presets'}</h3><div class="pm-creative-sheet-list">${list.map((item) => `<button type="button" data-preset="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.hint || item.prompt.slice(0, 90))}</small></button>`).join('')}</div><button type="button" class="pm-btn ghost" data-close>Close</button></div>`);
    overlay.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => {
      const item = list.find((entry) => entry.id === button.dataset.preset);
      if (item) { const input = page.querySelector('[data-creative-prompt]'); if (input) { input.value = item.prompt; input.focus(); } }
      if (kind === 'video' && page.querySelector('[data-creative-mode]')?.dataset.creativeMode !== 'video') {
        mode = 'video'; provider = 'hf'; sessionId = 'mobile_v2_creative_video'; aspect.video = CREATIVE_ASPECTS.video[0].id; paint(); loadGallery('video');
        const input = page.querySelector('[data-creative-prompt]'); if (input) input.value = item?.prompt || '';
      }
      remove();
    }));
  }

  async function openGallerySheet() {
    const galleryKind = mode;
    if (!galleries[galleryKind].length) await loadGallery(galleryKind);
    if (disposed) return;
    const items = galleries[galleryKind];
    const { overlay } = addOverlay(`<div class="pm-creative-sheet" data-gallery-overlay style="max-height:82vh"><h3>${galleryKind === 'video' ? 'Recent renders' : 'Discover'}</h3><div class="pm-creative-gallery" data-gallery-all style="max-height:62vh;overflow:auto">${items.length ? items.map((item) => galleryCard(item, galleryKind)).join('') : `<div class="pm-creative-gallery-empty"><span>No ${galleryKind === 'video' ? 'renders' : 'images'} yet.</span></div>`}</div><button type="button" class="pm-btn ghost" data-close style="margin-top:12px">Close</button></div>`);
    bindGalleryCards(overlay);
  }

  async function uploadSelectedFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const gateway = gateways.active;
    shell.showNotice('Uploading…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      const response = await gateway.uploadBinaryFile({ filename: file.name, base64: btoa(binary), mimeType: file.type || 'application/octet-stream' });
      if (!response?.success || !response.path) throw new Error(response?.error || 'Upload failed.');
      const kind = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'video' : 'image';
      currentResult = { kind, path: response.path };
      if (kind === 'image') currentResult.dataUrl = await loadImageDataUrl(response.path);
      shell.showNotice('Uploaded · ready to use');
      paintCurrentResult();
      if (kind === mode) { await loadGallery(kind); page.querySelector('[data-creative-stage]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } catch (error) {
      setResultMessage(error?.message || 'Upload failed.');
    } finally {
      input.value = '';
      input.addEventListener('change', uploadSelectedFile, { once: true });
    }
  }

  function generationPrompt(text) {
    const selectedAspect = CREATIVE_ASPECTS[mode].find((item) => item.id === aspect[mode]) || CREATIVE_ASPECTS[mode][0];
    const ratio = selectedAspect?.ratio || 'square';
    if (mode === 'video') {
      if (provider === 'hf') return `Use HyperFrames to compose and render a short motion video. Prompt: ${text}\nAspect: ${ratio}. After rendering, save the MP4 under generated/videos/ and tell me the final path.`;
      return `Use the generate_video tool with provider="xai" to create a short video.\nPrompt: ${text}\nAspect ratio: ${ratio}. Duration: 6 seconds. Resolution: 720p. Save under generated/videos/. Reply with the final file path.`;
    }
    if (provider === 'hf') return `Compose a HyperFrames still using web-based motion freeze-frame. Prompt: ${text}\nAspect: ${ratio}. Save the result PNG under generated/images/ and report the path.`;
    const transparency = /\b(transparent|no background|alpha|cutout|sprite)\b/i.test(text) ? '\nSet background="transparent" and output_format="png" on the tool call for real alpha transparency.' : '';
    return `Use the generate_image tool with provider="${provider}" to create an image.\nPrompt: ${text}\nAspect ratio: ${ratio}.${transparency} Save under generated/images/. Reply with the final file path.`;
  }

  function outputPathFrom(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      try { return outputPathFrom(JSON.parse(value)); } catch { return /(?:generated\/(?:images|videos)\/[^\s"']+\.(?:png|jpe?g|webp|mp4|webm|mov))/i.exec(value)?.[0] || ''; }
    }
    if (Array.isArray(value)) { for (const item of value) { const path = outputPathFrom(item); if (path) return path; } return ''; }
    if (typeof value !== 'object') return '';
    for (const key of ['path', 'relPath', 'outputPath', 'filePath']) if (typeof value[key] === 'string' && value[key]) return value[key];
    for (const key of ['extra', 'result', 'data', 'toolResult', 'generated_image', 'generated_video', 'generated_images', 'generated_videos', 'content', 'output']) {
      const path = outputPathFrom(value[key]); if (path) return path;
    }
    return '';
  }

  async function generate(event) {
    event.preventDefault();
    if (busy) return;
    const input = page.querySelector('[data-creative-prompt]');
    const userPrompt = String(input?.value || '').trim();
    if (!userPrompt) { input?.focus(); shell.showNotice('Enter a prompt first.'); return; }
    const kind = mode;
    const requestSessionId = sessionId;
    const prompt = generationPrompt(userPrompt);
    busy = true;
    setResultMessage(kind === 'video' ? 'Generating video…' : 'Generating image…');
    const button = page.querySelector('.pm-creative-send');
    if (button) { button.disabled = true; button.classList.add('busy'); }
    let answer = '';
    let producedPath = '';
    try {
      const gateway = gateways.active;
      try { await gateway.createSession({ id: requestSessionId, title: 'Creative Studio' }); } catch {}
      await gateway.streamChat({
        sessionId: requestSessionId,
        message: agentEnabled ? `Use the configured creative agent to fulfill this request. ${prompt}` : prompt,
        clientRequestId: `creative_${Date.now()}`,
        onEvent: (normalized, raw) => {
          if (normalized.type === 'assistant.delta') { answer += normalized.text || ''; setResultMessage(answer); }
          else if (normalized.type === 'assistant.done') { if (!answer) answer = normalized.text || ''; if (answer) setResultMessage(answer); }
          const name = String(raw?.name || raw?.tool || raw?.function?.name || raw?.action || '').toLowerCase();
          if (/generate_(image|video)/.test(name)) producedPath = outputPathFrom(raw) || producedPath;
          if (!producedPath && normalized.type === 'tool.activity') producedPath = outputPathFrom(normalized.raw) || producedPath;
        },
      });
      if (!producedPath) producedPath = outputPathFrom(answer);
      if (producedPath) {
        const resultKind = /\.(mp4|webm|mov|m4v|gif)$/i.test(producedPath) ? 'video' : kind;
        currentResult = { kind: resultKind, path: producedPath };
        if (resultKind === 'image') currentResult.dataUrl = await loadImageDataUrl(producedPath);
        paintCurrentResult();
        shell.showNotice('Saved · refreshing gallery');
      } else shell.showNotice(`${kind === 'image' ? 'Image' : 'Video'} generation request finished.`);
      if (!answer) setResultMessage('Request finished. Checking gallery…');
      window.setTimeout(() => { if (!disposed) refreshGallery(); }, 900);
    } catch (error) {
      setResultMessage(error?.message || 'Generation failed.');
    } finally {
      busy = false;
      if (!disposed) { const send = page.querySelector('.pm-creative-send'); if (send) { send.disabled = false; send.classList.remove('busy'); } }
    }
  }

  let extractSocket = null;

  function onExtractProgress(message) {
    if (!extract.busy || (message?.requestId && message.requestId !== extract.requestId)) return;
    const label = String(message?.label || String(message?.stage || 'progress').replace(/_/g, ' '));
    const detail = String(message?.detail || '');
    const stage = String(message?.stage || 'progress');
    const stageEl = page.querySelector('[data-extract-stage]');
    const detailEl = page.querySelector('[data-extract-detail]');
    const fill = page.querySelector('[data-extract-fill]');
    const list = page.querySelector('[data-extract-stages]');
    if (stageEl) stageEl.textContent = label;
    if (detailEl && detail) detailEl.textContent = detail;
    if (fill) fill.style.width = `${extractStageWeights[stage] || Math.min(95, (extract.stages.length + 1) * 10)}%`;
    if (list) {
      extract.stages.push(stage);
      const row = document.createElement('li');
      row.innerHTML = `<span class="pm-creative-stage-dot"></span><strong>${escapeHtml(label)}</strong>${detail ? ` <small>${escapeHtml(detail)}</small>` : ''}`;
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
    }
  }

  function openExtractModal() {
    const modal = page.querySelector('[data-extract-modal]');
    if (!modal) return;
    modal.hidden = false;
    const stage = page.querySelector('[data-extract-stage]');
    const detail = page.querySelector('[data-extract-detail]');
    const fill = page.querySelector('[data-extract-fill]');
    const list = page.querySelector('[data-extract-stages]');
    const close = page.querySelector('[data-extract-close]');
    if (stage) stage.textContent = 'Extracting layers';
    if (detail) detail.textContent = 'Preparing layer analysis…';
    if (fill) fill.style.width = '4%';
    if (list) list.replaceChildren();
    if (close) close.textContent = 'Hide';
  }

  function closeExtractSocket() {
    if (!extractSocket) return;
    extractSocket.onmessage = null;
    try { extractSocket.close(1000, 'layer extraction finished'); } catch {}
    extractSocket = null;
  }

  async function runExtractLayers(sourcePath) {
    if (!sourcePath) { shell.showNotice('Pick or generate an image first.'); return; }
    if (extract.busy) return;
    const requestId = `mob_${Date.now()}`;
    extract = { busy: true, requestId, stages: [] };
    openExtractModal();
    const gateway = gateways.active;
    if (typeof WebSocket !== 'undefined') {
      try {
        extractSocket = new WebSocket(gateway.wsUrl('/ws'));
        extractSocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'creative_extract_layers_progress') onExtractProgress(message);
          } catch {}
        };
      } catch { extractSocket = null; }
    }
    try {
      const result = await gateway.request('/api/canvas/creative-extract-layers', {
        method: 'POST',
        timeoutMs: 300000,
        body: JSON.stringify({
          sessionId: sessionId || 'mobile_v2_creative', source: sourcePath, mode: 'balanced', requestId,
          textEditable: true, extractObjects: true, preserveOriginal: true, copySource: true,
          useVision: true, useOcr: false, useSam: true, inpaintBackground: true, vectorTraceShapes: true,
        }),
      });
      if (!result?.success) throw new Error(result?.error || 'Layer extraction failed.');
      lastExtraction = result;
      paintExtractionOutput();
      const count = Array.isArray(result.layers) ? result.layers.length : 0;
      const stage = page.querySelector('[data-extract-stage]');
      const detail = page.querySelector('[data-extract-detail]');
      const fill = page.querySelector('[data-extract-fill]');
      const close = page.querySelector('[data-extract-close]');
      if (stage) stage.textContent = 'Editable scene ready';
      if (detail) detail.textContent = `${count} layer${count === 1 ? '' : 's'} extracted${result.scenePath ? ` · ${result.scenePath}` : ''}`;
      if (fill) fill.style.width = '100%';
      if (close) close.textContent = 'Done';
      if (result.scenePath) {
        const list = page.querySelector('[data-extract-stages]');
        if (list) {
          const row = document.createElement('li');
          row.innerHTML = `<span class="pm-creative-stage-dot"></span><strong>Scene saved</strong> <small>${escapeHtml(result.scenePath)}</small>`;
          list.appendChild(row);
        }
      }
      page.querySelector('[data-extraction-output]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      shell.showNotice(`Extracted ${count} layers · scene saved`);
    } catch (error) {
      const stage = page.querySelector('[data-extract-stage]');
      const detail = page.querySelector('[data-extract-detail]');
      const close = page.querySelector('[data-extract-close]');
      if (stage) stage.textContent = 'Extraction failed';
      if (detail) detail.textContent = error?.message || 'Extract failed.';
      if (close) close.textContent = 'Done';
      shell.showNotice(error?.message || 'Layer extraction failed.');
    } finally {
      extract.busy = false;
      closeExtractSocket();
    }
  }

  paint();
  refreshGallery();
  return () => {
    disposed = true;
    closeExtractSocket();
    overlays.forEach((overlay) => overlay.remove());
    overlays.clear();
  };
}
