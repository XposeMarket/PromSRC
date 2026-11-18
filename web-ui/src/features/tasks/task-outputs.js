// Files and media a task produced, derived from what the task record already
// keeps (artifacts, final response, write-tool calls). Pure: no DOM, no storage.

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const FILE_EXT = /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|wav|md|txt|html?|pdf|json|csv|tsv|ya?ml|js|mjs|cjs|ts|tsx|jsx|css|py|ps1|sh|lua|luau|zip|docx?|xlsx?|pptx?)$/i;
const WRITE_ACTIONS = new Set(['workspace_edit', 'create_file', 'write_file', 'edit_file', 'file_write', 'append_file', 'find_replace', 'replace_lines', 'apply_patch']);
const MEDIA_ACTIONS = /^(media_generate|generate_image|generate_video|imagegen|creative_|hyperframes_|desktop_screenshot|delivery_send)/;
const READ_ONLY_EDIT_ACTIONS = new Set(['preview_patch', 'mkdir', 'delete_file', 'delete_lines']);

/** Workspace-relative, forward-slash path or '' when it is not a safe local file reference. */
export function normalizeOutputPath(raw) {
  let p = String(raw || '').trim().replace(/^<|>$/g, '').replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/');
  if (!p || /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith('data:') || p.startsWith('#')) return '';
  const ws = p.toLowerCase().lastIndexOf('/workspace/');
  if (/^[a-z]:\//i.test(p) || p.startsWith('/')) {
    if (ws < 0) return '';
    p = p.slice(ws + '/workspace/'.length);
  }
  p = p.replace(/^\.\//, '').replace(/[?#].*$/, '');
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  if (!p || p.split('/').some(seg => !seg || seg === '..' || seg === '.') || /[\x00-\x1f:]/.test(p)) return '';
  return FILE_EXT.test(p) ? p : '';
}

export function outputKind(path) {
  return MEDIA_EXT.test(path) ? 'image' : VIDEO_EXT.test(path) ? 'video' : 'file';
}

function argsFromCall(text, action) {
  const m = String(text || '').match(/^[\w.:-]+\(([\s\S]*)\)$/);
  const body = m ? m[1] : String(text || '');
  const out = {};
  for (const hit of body.matchAll(/"(path|filename|file|destination|output|outputPath|output_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try { out[hit[1]] = JSON.parse(`"${hit[2]}"`); } catch { out[hit[1]] = hit[2]; }
  }
  const act = body.match(/"action"\s*:\s*"([\w-]+)"/);
  if (act) out.action = act[1];
  return { action, ...out };
}

/** [{ path, name, kind, source }] newest-first-ish, deduped, capped. */
export function taskOutputs(task, { limit = 12 } = {}) {
  const found = new Map();
  const add = (raw, source) => {
    const path = normalizeOutputPath(raw);
    if (!path || found.has(path.toLowerCase())) return;
    found.set(path.toLowerCase(), { path, name: path.split('/').pop(), kind: outputKind(path), source });
  };
  for (const a of Array.isArray(task?.artifacts) ? task.artifacts : []) add(typeof a === 'string' ? a : a?.path || a?.relPath || a?.file, 'artifact');
  const summary = String(task?.finalSummary || '');
  for (const m of summary.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1], 'response');
  for (const m of summary.matchAll(/`([^`\s]+\.[a-z0-9]{1,5})`/gi)) add(m[1], 'response');
  const journal = Array.isArray(task?.journal) ? task.journal : [];
  for (const entry of journal) {
    const content = String(entry?.content || '');
    const action = content.split(/[\s(:]/)[0];
    if (entry?.type === 'tool_call' && WRITE_ACTIONS.has(action)) {
      const args = argsFromCall(content, action);
      if (READ_ONLY_EDIT_ACTIONS.has(args.action)) continue;
      add(args.destination || args.path || args.filename || args.file, 'edited');
    } else if (entry?.type === 'tool_result' && MEDIA_ACTIONS.test(action)) {
      for (const m of content.matchAll(/([\w./\\-]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov))/gi)) add(m[1], 'generated');
    }
  }
  for (const entry of Array.isArray(task?.activity) ? task.activity : []) {
    if (entry?.kind === 'tool' && WRITE_ACTIONS.has(String(entry.name || ''))) {
      const args = argsFromCall(entry.detail, entry.name);
      if (!READ_ONLY_EDIT_ACTIONS.has(args.action)) add(args.destination || args.path || args.filename || args.file, 'edited');
    }
  }
  const list = [...found.values()];
  // Media first (most visual), then files; keep discovery order inside each group.
  return [...list.filter(o => o.kind !== 'file'), ...list.filter(o => o.kind === 'file')].slice(0, limit);
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>';

/** Outputs section HTML. urlFor(path) must return an authenticated inline URL. */
export function renderTaskOutputs(outputs, { urlFor, label = 'Outputs', labelClass = '' } = {}) {
  const list = Array.isArray(outputs) ? outputs : [];
  if (!list.length || typeof urlFor !== 'function') return '';
  const media = list.filter(o => o.kind !== 'file');
  const files = list.filter(o => o.kind === 'file');
  const tile = 'display:block;border-radius:10px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 5%,transparent);aspect-ratio:1/1';
  const mediaHtml = media.length ? `<div class="task-outputs-media" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px">${media.map(o => {
    const url = esc(urlFor(o.path));
    const inner = o.kind === 'video'
      ? `<video src="${url}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block"></video>`
      : `<img src="${url}" alt="${esc(o.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.closest('a').style.display='none'">`;
    return `<a href="${url}" target="_blank" rel="noopener" title="${esc(o.path)}" data-task-output="${esc(o.path)}" style="${tile}">${inner}</a>`;
  }).join('')}</div>` : '';
  const filesHtml = files.length ? `<div class="task-outputs-files" style="display:flex;flex-direction:column;gap:6px">${files.map(o => `<a href="${esc(urlFor(o.path))}" target="_blank" rel="noopener" data-task-output="${esc(o.path)}" title="${esc(o.path)}" style="display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border-radius:9px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);color:inherit;text-decoration:none;font-size:12.5px">${FILE_ICON}<span style="font-weight:600;white-space:nowrap">${esc(o.name)}</span><span style="opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(o.path.slice(0, -o.name.length).replace(/\/$/, ''))}</span><span style="margin-left:auto;opacity:.55;font-size:11px;white-space:nowrap">${esc(o.source)}</span></a>`).join('')}</div>` : '';
  return `<section class="task-outputs" data-task-outputs style="display:flex;flex-direction:column;gap:8px;min-width:0"><div class="${esc(labelClass)}"${labelClass ? '' : ' style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;opacity:.65"'}>${esc(label)} · ${list.length}</div>${mediaHtml}${filesHtml}</section>`;
}
