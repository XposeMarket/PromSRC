// Shared project helpers for desktop + mobile:
// - Optional "Folder" field for every New project form. Suggests folders the
//   connected agents (Codex, Claude Code, ...) already work in. A project linked
//   to a folder holds every agent's chats for that folder.
// - "Move to project" new-project form (name + folder) used by both surfaces.
//
// Exposed as window.__pmProjectFolder so the large legacy page files only need
// a one-line hook instead of importing this module.
import { esc, externalAgentRequest, loadAgentFolders, loadExternalAgents, selectableAgents } from './external-agent-ui.js';

let seq = 0;

function baseName(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(p || '');
}

/** Markup for the optional folder field. `value` pre-fills (editing an existing project). */
export function projectFolderFieldHtml(prefix = 'pm', value = '') {
  const id = `${prefix}-project-folder-${++seq}`;
  return `<div class="pm-project-folder" data-project-folder-field>
    <label class="pm-project-folder-label" for="${id}">Folder <span>optional</span></label>
    <input id="${id}" class="pm-project-folder-input" data-project-folder type="text" autocomplete="off" spellcheck="false" value="${esc(value)}" placeholder="Paste a folder path to link" list="${id}-list" />
    <datalist id="${id}-list"></datalist>
    <div class="pm-project-folder-chips" data-project-folder-chips></div>
    <div class="pm-project-folder-access" data-project-folder-access hidden></div>
    <div class="pm-project-folder-hint">Chats from any agent working in this folder show up in the project.</div>
  </div>`;
}

/** Folders the connected agents already use, minus ones linked to a project. */
export async function suggestedProjectFolders() {
  try { await loadExternalAgents(); } catch { return []; }
  const seen = new Map();
  for (const agent of selectableAgents()) {
    let list = [];
    try { list = await loadAgentFolders(agent.id, { fresh: true }); } catch { list = []; }
    for (const f of list) {
      if (!f?.path || f.projectId) continue;
      const key = String(f.path).replace(/[\\/]+$/, '').toLowerCase();
      if (!seen.has(key)) seen.set(key, { path: f.path, at: Number(f.updatedAt || 0) });
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).map((f) => f.path);
}

/** Fill suggestions into a rendered folder field (no-op if the field is missing). */
export function wireProjectFolderField(root) {
  const field = root?.querySelector?.('[data-project-folder-field]');
  if (!field || field.dataset.wired) return;
  field.dataset.wired = '1';
  const input = field.querySelector('[data-project-folder]');
  const list = field.querySelector('datalist');
  const chips = field.querySelector('[data-project-folder-chips]');
  chips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-folder-path]');
    if (!chip || !input) return;
    event.preventDefault();
    event.stopPropagation();
    input.value = chip.getAttribute('data-folder-path') || '';
    for (const c of chips.querySelectorAll('[data-folder-path]')) c.classList.toggle('is-active', c === chip);
    void checkAccess();
  });
  // Folders outside what Prometheus can access need an explicit "Allow access" first,
  // because linking one also opens it to Prometheus's file tools.
  const notice = field.querySelector('[data-project-folder-access]');
  let checkSeq = 0;
  let timer = 0;
  const show = (html) => { if (!notice) return; notice.innerHTML = html; notice.hidden = !html; };
  const render = (access) => {
    if (!access?.path) return show('');
    if (access.allowed && access.revocable) {
      return show(`<span>Prometheus can access this folder.</span><button type="button" class="pm-project-folder-access-btn is-quiet" data-folder-access="revoke">Remove access</button>`);
    }
    if (access.allowed) return show('');
    if (access.grantable) {
      return show(`<span>Outside the folders Prometheus can access. Linking it lets Prometheus read and edit files there.</span><button type="button" class="pm-project-folder-access-btn" data-folder-access="grant">Allow access</button>`);
    }
    return show(`<span class="is-warn">${esc(access.reason || 'This folder can\'t be linked.')}</span>`);
  };
  async function checkAccess() {
    const value = String(input?.value || '').trim();
    const mine = ++checkSeq;
    if (!value) return show('');
    try {
      const access = await externalAgentRequest(`/api/projects/folder-access?path=${encodeURIComponent(value)}`);
      if (mine === checkSeq && field.isConnected) render(access);
    } catch { if (mine === checkSeq) show(''); }
  }
  input?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => void checkAccess(), 450); });
  input?.addEventListener('change', () => { clearTimeout(timer); void checkAccess(); });
  notice?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-folder-access]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const revoke = btn.getAttribute('data-folder-access') === 'revoke';
    btn.disabled = true;
    try {
      const value = String(input?.value || '').trim();
      const result = revoke
        ? await externalAgentRequest(`/api/projects/folder-access?path=${encodeURIComponent(value)}`, { method: 'DELETE' })
        : await externalAgentRequest('/api/projects/folder-access', { method: 'POST', body: { path: value } });
      if (result?.error) throw new Error(result.error);
      render(result);
    } catch (error) {
      show(`<span class="is-warn">${esc(error?.message || 'Could not change folder access.')}</span>`);
    }
  });
  if (input?.value) void checkAccess();
  void suggestedProjectFolders().then((paths) => {
    if (!field.isConnected) return;
    if (list) list.innerHTML = paths.map((p) => `<option value="${esc(p)}"></option>`).join('');
    const top = paths.slice(0, 4);
    // Same folder name in two places ("workspace", "workspace"): show parent/name instead.
    const label = (p) => {
      const name = baseName(p);
      if (top.filter((q) => baseName(q).toLowerCase() === name.toLowerCase()).length < 2) return name;
      const parts = String(p).split(/[\\/]/).filter(Boolean);
      return parts.slice(-2).join('/');
    };
    if (chips) chips.innerHTML = top.map((p) => `<button type="button" class="pm-project-folder-chip" data-folder-path="${esc(p)}" title="${esc(p)}">${esc(label(p))}</button>`).join('');
  });
}

export function readProjectFolder(root) {
  const value = String(root?.querySelector?.('[data-project-folder]')?.value || '').trim();
  return value || undefined;
}

/**
 * Inline "New project" form for Move to project. `create({ name, workspacePath })`
 * must create the project and move the chat; it throws with a readable message.
 */
export function mountMoveNewProjectForm(container, { create, onCancel, prefix = 'pm-move' } = {}) {
  container.innerHTML = `<form class="pm-move-new-project" novalidate>
    <label class="pm-project-folder-label" for="${prefix}-name">Project name</label>
    <input id="${prefix}-name" class="pm-project-folder-input" data-move-name type="text" maxlength="120" autocomplete="off" placeholder="e.g. Mobile app" />
    ${projectFolderFieldHtml(prefix)}
    <div class="pm-move-new-project-error" role="alert" hidden></div>
    <div class="pm-move-new-project-actions">
      <button type="button" class="pm-move-btn" data-move-cancel>Back</button>
      <button type="submit" class="pm-move-btn pm-move-btn-primary" data-move-create>Create and move</button>
    </div>
  </form>`;
  const form = container.querySelector('form');
  const nameInput = container.querySelector('[data-move-name]');
  const error = container.querySelector('.pm-move-new-project-error');
  const submit = container.querySelector('[data-move-create]');
  wireProjectFolderField(container);
  container.querySelector('[data-move-cancel]')?.addEventListener('click', (event) => { event.preventDefault(); onCancel?.(); });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const name = String(nameInput?.value || '').trim();
    if (!name) { error.textContent = 'Enter a project name.'; error.hidden = false; nameInput?.focus(); return; }
    error.hidden = true;
    submit.disabled = true;
    try {
      await create({ name, workspacePath: readProjectFolder(container) });
    } catch (err) {
      submit.disabled = false;
      error.textContent = String(err?.message || err || 'Could not create project.');
      error.hidden = false;
    }
  });
  setTimeout(() => nameInput?.focus({ preventScroll: true }), 0);
}

/**
 * Project list for the desktop Chat/Project picker. ChatPage.js calls this as a bare
 * global (`normalizeDesktopNewChatProjects(data)`) but never defined it, so the
 * picker always said "Projects are unavailable right now." Pinned first, then recent.
 */
export function normalizeDesktopNewChatProjects(data) {
  const list = Array.isArray(data) ? data : (Array.isArray(data?.projects) ? data.projects : []);
  return list
    .filter((p) => p && String(p.id || '').trim())
    .map((p) => ({
      id: String(p.id).trim(),
      name: String(p.name || '').trim() || 'Untitled project',
      workspacePath: String(p.workspacePath || ''),
      pinnedAt: Number(p.pinnedAt || 0),
      updatedAt: Number(p.updatedAt || 0),
    }))
    .sort((a, b) => (b.pinnedAt - a.pinnedAt) || (b.updatedAt - a.updatedAt));
}
if (typeof window.normalizeDesktopNewChatProjects !== 'function') {
  window.normalizeDesktopNewChatProjects = normalizeDesktopNewChatProjects;
}

window.__pmProjectFolder = {
  html: projectFolderFieldHtml,
  wire: wireProjectFolderField,
  read: readProjectFolder,
  mountMoveNewProjectForm,
};
