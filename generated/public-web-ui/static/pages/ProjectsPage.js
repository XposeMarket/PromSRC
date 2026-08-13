/**
 * ProjectsPage.js — Projects System
 *
 * Handles:
 *  - Sidebar: Projects tab, project cards, session dropdowns, edit mode
 *  - Right panel: inline project context plus Canvas integration
 *  - Agent context: Project Instructions + Memory Snapshot editors
 *  - New Project modal flow + onboarding message
 *  - Project/session deletion with workspace cleanup via API
 *
 * Depends on: api() from api.js, showToast/showConfirm from utils.js,
 *   toggleCanvas() from ChatPage.js, loadChatSessions() from ChatPage.js
 *
 * API surface (all on window.*):
 *   setSidebarTab('projects'), newProject(), confirmNewProject(),
 *   closeNewProjectModal(), toggleProjectsEditMode(),
 *   filterProjects(q), setRightPanelTab(tab),
 *   saveProjectInstructions(), saveProjectMemorySnapshot(),
 *   toggleProjectEditor(blockId), openProjectContextInCanvas()
 */

import { api } from '../api.js';
import { showToast, showConfirm, timeAgo } from '../utils.js';

// ─── State ──────────────────────────────────────────────────────────────────
let _projects = [];           // Array<ProjectRecord>
const _expandedProjectIds = new Set();
let _projectsEditMode = false;
let _currentRpTab = 'project'; // 'canvas' | 'project' | 'context'
let _currentProjectSessionId = null; // session currently open in chat
let _pendingProjectName = '';
let _pendingProjectWorkspacePath = '';

function projectPinned(project) {
  return Number(project?.pinnedAt || 0) > 0 || localProjectPins().includes(String(project?.id || ''));
}

function localProjectPins() {
  try {
    const parsed = JSON.parse(localStorage.getItem('prometheus_pinned_projects') || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function setLocalProjectPin(projectId, pinned) {
  const ids = localProjectPins();
  const id = String(projectId || '');
  const index = ids.indexOf(id);
  if (pinned && index < 0) ids.unshift(id);
  if (!pinned && index >= 0) ids.splice(index, 1);
  localStorage.setItem('prometheus_pinned_projects', JSON.stringify(ids));
}

function renderProjectStarIcon(filled) {
  return typeof window.SKILL_STAR_ICON === 'function'
    ? window.SKILL_STAR_ICON(Boolean(filled))
    : (filled ? '★' : '☆');
}

// ─── Init ───────────────────────────────────────────────────────────────────
// This page is dynamically imported by the desktop shell.  Dynamic imports can
// resolve after DOMContentLoaded, so listening only for that event leaves the
// project tree visible but inert on some app starts.
function initialiseProjectSidebar() {
  ['projects-list'].forEach((listId) => {
    const list = document.getElementById(listId);
    if (!list || list.dataset.delegatedActions === 'true') return;
    list.dataset.delegatedActions = 'true';
    list.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-project-action]');
      if (!target || !list.contains(target)) return;
      const action = String(target.dataset.projectAction || '');
      const projectId = String(target.dataset.projectId || '');
      const sessionId = String(target.dataset.sessionId || '');
      if (!projectId) return;
      if (target.tagName === 'BUTTON') event.stopPropagation();
      if (action === 'toggle') window.toggleProjectCard(projectId);
      else if (action === 'new-session') void window.newProjectSession(projectId);
      else if (action === 'pin-project') void window.toggleProjectPin(projectId, event);
      else if (action === 'delete-project') void window.confirmDeleteProject(projectId, String(target.dataset.projectName || ''));
      else if (action === 'open-session' && sessionId) void window.openProjectSession(projectId, sessionId);
      else if (action === 'delete-session' && sessionId) void window.confirmDeleteProjectSession(projectId, sessionId, String(target.dataset.sessionTitle || ''));
    });
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initialiseProjectSidebar, { once: true });
} else {
  initialiseProjectSidebar();
}
// Projects are also part of the regular Chats stream, so hydrate them even
// when the user never opens the dedicated Projects tab.
setTimeout(() => { void loadProjects(); }, 0);

// ─── API calls ──────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const data = await api('/api/projects');
    _projects = Array.isArray(data) ? data : (data.projects || []);
    // The project store is the source of truth for membership.  Tag already
    // hydrated chat stubs too, so the ordinary Chats list never briefly shows
    // a project session while the session API is refreshing.
    const ownership = new Map();
    _projects.forEach((project) => {
      (project.sessions || []).forEach((session) => ownership.set(String(session.id || ''), project));
    });
    let changed = false;
    (window.chatSessions || []).forEach((session) => {
      const owner = ownership.get(String(session?.id || ''));
      if (!owner) return;
      if (session.projectId !== owner.id || session.projectName !== owner.name || session.source !== 'project') {
        session.projectId = owner.id;
        session.projectName = owner.name;
        session.source = 'project';
        changed = true;
      }
    });
    if (changed) {
      window.saveChatSessions?.();
      window.renderSessionsList?.();
    }
    window.renderSessionsList?.();
    renderProjectsList();
  } catch (e) {
    // API not wired yet — silently show empty state
    _projects = [];
    renderProjectsList();
  }
}

function projectImportedLogo(project) {
  const binding = project?.externalImport;
  if (!binding) return '';
  const sessionLike = { externalImport: { source: binding } };
  return typeof window.renderImportedSourceLogo === 'function' ? window.renderImportedSourceLogo(sessionLike) : '';
}

function renderProjectChatRow(project) {
  const id = escHtmlLocal(project.id);
  const isOpen = _expandedProjectIds.has(String(project.id));
  const pinned = projectPinned(project);
  const importedLogo = projectImportedLogo(project);
  const importedClass = importedLogo ? ' imported-project' : '';
  const projectTimestamp = projectLastActivity(project);
  const children = (project.sessions || []).slice().sort((a, b) => projectSessionLastActivity(b) - projectSessionLastActivity(a)).map((session) => {
    const cached = Array.isArray(window.chatSessions) ? window.chatSessions.find((item) => String(item?.id || '') === String(session?.id || '')) : null;
    // The project API is a snapshot. Prefer the live local session object so
    // working/unread/preview metadata changes appear in the sidebar without a
    // reload while a project chat is streaming.
    const nested = { ...session, ...(cached || {}), projectId: project.id, projectName: project.name };
    return typeof window.renderChatSessionCard === 'function'
      ? window.renderChatSessionCard(nested, { projectId: project.id, projectNested: true, projectDelete: false })
      : '';
  }).join('');
  const folder = '<span class="project-chat-folder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5h17"/></svg></span>';
  return `<div class="project-chat-group${isOpen ? ' open' : ''}${pinned ? ' pinned-project' : ''}" data-project-chat-group="${id}">
    <div class="job-item chat-session-item project-chat-row${importedClass}" data-project-action="toggle-chat" data-project-id="${id}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}" onclick="window.toggleProjectChatRow && window.toggleProjectChatRow('${id}')">
      <span class="project-chat-top-time" title="Last activity">${timeAgo(projectTimestamp)}</span>
      <button class="project-chat-new-btn" type="button" onclick="event.preventDefault();event.stopPropagation();window.newProjectSession && window.newProjectSession('${id}')" title="New chat in project" aria-label="New chat in project">+</button>
      <button class="chat-session-action-btn chat-pin-btn project-chat-pin-btn${pinned ? ' active' : ''}" type="button" onclick="window.toggleProjectPin && window.toggleProjectPin('${id}', event)" title="${pinned ? 'Unpin' : 'Pin'} project" aria-label="${pinned ? 'Unpin' : 'Pin'} project">${renderProjectStarIcon(pinned)}</button>
      <div class="job-item-head job-item-head--pinned"><div class="job-item-title-wrap"><div class="job-item-title project-chat-project-title"><span class="project-chat-icon-line">${folder}${importedLogo}</span><span class="project-chat-project-name">${escHtmlLocal(project.name)}</span></div></div></div>
    </div>
    <div class="project-chat-children"${isOpen ? '' : ' hidden'}>${children || '<div class="project-empty-session">No chats yet.</div>'}</div>
  </div>`;
}

window.renderProjectChatRows = function({ pinned = false, query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return _projects
    .filter((project) => pinned ? projectPinned(project) : true)
    .filter((project) => !q || projectMatchesFilter(project, q))
    .sort((a, b) => (projectPinned(b) ? Number(b.pinnedAt || 0) : projectLastActivity(b)) - (projectPinned(a) ? Number(a.pinnedAt || 0) : projectLastActivity(a)))
    .map(renderProjectChatRow)
    .join('');
};

// The bell/priority rail keeps project chats visible as their own groups. The
// project title remains the familiar project row, while its child chats use
// the priority rail's richer Hermes-style session card and are never hidden
// behind the normal expandable tree.
window.renderPriorityProjectGroups = function() {
  return _projects
    .filter((project) => project && (project.sessions || []).length)
    .slice()
    .sort((a, b) => {
      const pinnedDelta = Number(projectPinned(b)) - Number(projectPinned(a));
      return pinnedDelta || projectLastActivity(b) - projectLastActivity(a);
    })
    .map((project) => {
      const projectId = escHtmlLocal(project.id);
      const projectName = escHtmlLocal(project.name || 'Untitled project');
      const importedLogo = projectImportedLogo(project);
      const folder = '<span class="project-chat-folder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path><path d="M3.5 9.5h17"></path></svg></span>';
      const pinned = projectPinned(project);
      const collapsed = typeof window.isPriorityProjectCollapsed === 'function'
        && window.isPriorityProjectCollapsed(project.id);
      const children = (project.sessions || [])
        .slice()
        .sort((a, b) => projectSessionLastActivity(b) - projectSessionLastActivity(a))
        .map((session) => {
          const cached = Array.isArray(window.chatSessions)
            ? window.chatSessions.find((item) => String(item?.id || '') === String(session?.id || ''))
            : null;
          const nested = { ...session, ...(cached || {}), projectId: project.id, projectName: project.name, source: 'project' };
          return typeof window.renderChatSessionCard === 'function'
            ? window.renderChatSessionCard(nested, { priority: true, projectId: project.id, projectNested: true, projectLabel: project.name, projectDelete: false })
            : '';
        }).join('');
      return `<section class="priority-project-group${collapsed ? ' is-collapsed' : ''}" data-priority-project-id="${projectId}">
        <div class="priority-project-title project-chat-row${importedLogo ? ' imported-project' : ''}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}" onclick="togglePriorityProject(event)" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePriorityProject(event); }" title="${escHtmlLocal(project.workspacePath || project.externalImport?.sourcePath || project.name)}">
          <div class="priority-project-title-name"><span class="project-chat-icon-line">${folder}${importedLogo}</span><span>${projectName}</span></div>
          <span class="priority-project-time">${timeAgo(projectLastActivity(project))}</span>
          <button class="project-chat-new-btn priority-project-action" type="button" onclick="event.preventDefault();event.stopPropagation();window.newProjectSession && window.newProjectSession('${projectId}')" title="New chat in project" aria-label="New chat in project">+</button>
          <button class="project-chat-pin-btn priority-project-action${pinned ? ' active' : ''}" type="button" onclick="event.preventDefault();event.stopPropagation();window.toggleProjectPin && window.toggleProjectPin('${projectId}', event)" title="${pinned ? 'Unpin' : 'Pin'} project" aria-label="${pinned ? 'Unpin' : 'Pin'} project">${renderProjectStarIcon(pinned)}</button>
        </div>
        <div class="priority-project-children"${collapsed ? ' hidden' : ''}>${children}</div>
      </section>`;
    }).join('');
};

async function createProjectApi(name, workspacePath = '') {
  return await api('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(workspacePath ? { workspacePath } : {}) }),
  });
}

async function deleteProjectApi(projectId) {
  return await api(`/api/projects/${projectId}`, { method: 'DELETE' });
}

async function deleteProjectSessionApi(projectId, sessionId) {
  return await api(`/api/projects/${projectId}/sessions/${sessionId}`, { method: 'DELETE' });
}

async function updateProjectInstructionsApi(projectId, instructions) {
  return await api(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
}

async function updateProjectMemoryApi(projectId, memorySnapshot) {
  return await api(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memorySnapshot }),
  });
}

async function loadProjectFiles(projectId) {
  try {
    return await api(`/api/projects/${projectId}/files`);
  } catch { return []; }
}

async function uploadProjectFile(projectId, file) {
  // Read file as base64 or text and send as JSON (router expects JSON, not multipart)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const textExts = new Set(['txt','md','csv','json','js','ts','jsx','tsx','html','htm','css','scss','py','rb','php','java','c','cpp','go','rs','sh','yaml','yml','toml','xml','svg','sql','vue','svelte','log','ini','cfg','conf','graphql']);
    if (textExts.has(ext)) {
      reader.onload = async e => {
        try {
          const result = await api(`/api/projects/${projectId}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, content: e.target.result }),
          });
          resolve(result);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    } else {
      reader.onload = async e => {
        try {
          const base64 = e.target.result.split(',')[1];
          const result = await api(`/api/projects/${projectId}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, base64, mimeType: file.type || 'application/octet-stream' }),
          });
          resolve(result);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    }
  });
}

async function deleteProjectFileApi(projectId, fileId) {
  return await api(`/api/projects/${projectId}/files/${fileId}`, { method: 'DELETE' });
}

// ─── Sidebar tab switching ───────────────────────────────────────────────────

// Patch setSidebarTab AFTER DOMContentLoaded so ChatPage.js has already
// defined the original function on window.
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const _orig = window.setSidebarTab;

    window.setSidebarTab = function(tab) {
      // Always deactivate projects button/panel first
      document.getElementById('sidebar-projects-btn')?.classList.remove('active');
      const projPanel = document.getElementById('sidebar-projects');
      if (projPanel) projPanel.style.display = 'none';

      if (tab === 'projects') {
        // Manually deactivate the other two tabs (mirrors what _orig does for jobs/skills)
        document.getElementById('tab-jobs')?.classList.remove('active');
        document.getElementById('tab-skills')?.classList.remove('active');
        const jobsEl = document.getElementById('sidebar-jobs');
        const skillsEl = document.getElementById('sidebar-skills');
        if (jobsEl) jobsEl.style.display = 'none';
        if (skillsEl) skillsEl.style.display = 'none';

        // Activate projects
        document.getElementById('sidebar-projects-btn')?.classList.add('active');
        if (projPanel) projPanel.style.display = 'flex';

        loadProjects();
      } else {
        // Delegate to original for jobs / skills
        if (typeof _orig === 'function') _orig(tab);
      }
    };
  }, 300); // after ChatPage.js has run
});

// ─── Render projects list ────────────────────────────────────────────────────

function renderProjectsList(filter = '') {
  const list = document.getElementById('projects-list');
  if (!list) return;

  const q = filter.toLowerCase();
  const filtered = q
    ? _projects.filter((project) => projectMatchesFilter(project, q))
    : _projects;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${q ? 'No projects match.' : 'No projects yet.<br>Create your first project.'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => renderProjectCard(p, { sidebar: true })).join('');
  list.style.display = 'flex';
}

function projectLastActivity(project) {
  return (project?.sessions || []).reduce((latest, session) => {
    const value = Number(session?.lastMessageAt || session?.updatedAt || session?.createdAt || 0);
    return Math.max(latest, Number.isFinite(value) ? value : 0);
  }, Number(project?.updatedAt || project?.createdAt || 0) || 0);
}

function projectSessionLastActivity(session) {
  const explicit = Number(session?.lastMessageAt || session?.updatedAt || session?.createdAt || 0);
  return Number.isFinite(explicit) ? explicit : 0;
}

function projectMatchesFilter(project, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(project?.name || '').toLowerCase().includes(q)
    || (project?.sessions || []).some((session) => String(session?.title || '').toLowerCase().includes(q));
}

function renderProjectCard(p, options = {}) {
  const isOpen = _expandedProjectIds.has(p.id);
  const sessionRows = (p.sessions || [])
    .slice()
    .sort((a, b) => projectSessionLastActivity(b) - projectSessionLastActivity(a))
    .map(s => renderProjectSessionItem(p.id, s, options)).join('');
  const isActiveProject = Boolean(_currentProjectSessionId && (p.sessions || []).find(s => s.id === _currentProjectSessionId));
  const projectClass = options.sidebar ? ' project-sidebar-group' : '';
  const projectRowState = isActiveProject ? ' active' : '';
  const projectPinnedState = projectPinned(p);
  const projectTimestamp = projectLastActivity(p);

  return `
<div class="project-card${projectClass}${isOpen ? ' open' : ''}${isActiveProject ? ' active-project' : ''}"
     id="proj-card-${p.id}">
  <div class="project-card-header${options.sidebar ? ` job-item chat-session-item project-sidebar-row${projectRowState}` : ''}" data-project-action="toggle" data-project-id="${escHtmlLocal(p.id)}" title="${escHtmlLocal(p.workspacePath || p.externalImport?.sourcePath || p.name)}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}">
     <div class="project-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.7 2h7.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5h17"/></svg></div>
     <div class="job-item-head job-item-head--pinned project-row-content"><div class="job-item-title-wrap"><div class="job-item-title">${escHtmlLocal(p.name)}</div></div></div>
     <span class="project-sidebar-top-time" title="Last activity">${timeAgo(projectTimestamp)}</span>
     <button class="project-card-add-btn" title="New chat in project" data-project-action="new-session" data-project-id="${escHtmlLocal(p.id)}">+</button>
     <button class="project-card-pin-btn${projectPinnedState ? ' active' : ''}" title="${projectPinnedState ? 'Unpin' : 'Pin'} project" aria-label="${projectPinnedState ? 'Unpin' : 'Pin'} project" data-project-action="pin-project" data-project-id="${escHtmlLocal(p.id)}">${renderProjectStarIcon(projectPinnedState)}</button>
     <button class="project-card-delete-btn" title="Delete project" data-project-action="delete-project" data-project-id="${escHtmlLocal(p.id)}" data-project-name="${escHtmlLocal(p.name)}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>
  </div>
  <div class="project-sessions-list">
    ${sessionRows || '<div class="project-empty-session">No chats yet — click + to start one.</div>'}
  </div>
</div>`;
}

function renderProjectSessionItem(projectId, s, options = {}) {
  const isActive = s.id === _currentProjectSessionId;
  const title = s.title || s.id?.slice(0, 12) || 'Untitled';
  const activity = projectSessionLastActivity(s);
  if (options.sidebar) {
    const cachedSession = Array.isArray(window.chatSessions)
      ? window.chatSessions.find((session) => String(session?.id || '') === String(s?.id || ''))
      : null;
    const nestedSession = {
      ...s,
      ...(cachedSession || {}),
      // Keep a local title when one was just generated by the active turn.
      title: cachedSession?.title || title,
      updatedAt: cachedSession?.updatedAt || s.updatedAt || activity,
      lastMessageAt: Math.max(
        Number(cachedSession?.lastMessageAt || 0),
        Number(s.lastMessageAt || activity || 0),
      ) || activity,
    };
    if (typeof window.renderChatSessionCard === 'function') {
      return window.renderChatSessionCard(nestedSession, { projectId, projectNested: true, projectDelete: true });
    }
  }
  return `
<div class="project-session-item${isActive ? ' active-session' : ''}"
     data-project-action="open-session" data-project-id="${escHtmlLocal(projectId)}" data-session-id="${escHtmlLocal(s.id)}">
  <span class="project-session-dot"></span>
  <span class="project-session-name">${escHtmlLocal(title)}</span>
  <span class="project-session-time">${timeAgo(activity)}</span>
  <button class="project-session-delete-btn" title="Delete session" data-project-action="delete-session" data-project-id="${escHtmlLocal(projectId)}" data-session-id="${escHtmlLocal(s.id)}" data-session-title="${escHtmlLocal(title)}">✕</button>
</div>`;
}

function renderProjectSidebarTree(filter = '') {
  renderProjectsList(filter);
}

function escHtmlLocal(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Project card toggle ─────────────────────────────────────────────────────

window.toggleProjectCard = function(projectId) {
  if (_expandedProjectIds.has(projectId)) _expandedProjectIds.delete(projectId);
  else _expandedProjectIds.add(projectId);
  renderProjectsList(document.getElementById('project-search')?.value || '');
};

window.toggleProjectChatRow = function(projectId) {
  const id = String(projectId || '');
  if (_expandedProjectIds.has(id)) _expandedProjectIds.delete(id);
  else _expandedProjectIds.add(id);
  window.renderSessionsList?.();
};

window.toggleProjectPin = async function(projectId, event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const project = _projects.find((item) => String(item?.id || '') === String(projectId || ''));
  if (!project) return;
  const wasPinned = projectPinned(project);
  const nextPinned = !wasPinned;
  setLocalProjectPin(project.id, nextPinned);
  project.pinnedAt = nextPinned ? Date.now() : undefined;
  window.renderSessionsList?.();
  try {
    const updated = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: nextPinned }),
    });
    project.pinnedAt = Number(updated?.pinnedAt || 0) || undefined;
    setLocalProjectPin(project.id, !!project.pinnedAt);
    window.renderSessionsList?.();
  } catch (error) {
    project.pinnedAt = wasPinned ? Date.now() : undefined;
    setLocalProjectPin(project.id, wasPinned);
    window.renderSessionsList?.();
    showToast(error?.message || 'Could not update project pin', 'error');
  }
};

// ─── Edit mode ───────────────────────────────────────────────────────────────

window.toggleProjectsEditMode = function() {
  _projectsEditMode = !_projectsEditMode;
  document.body.classList.toggle('projects-edit-mode', _projectsEditMode);
  const btn = document.getElementById('projects-edit-btn');
  if (btn) {
    btn.textContent = _projectsEditMode ? 'Done' : 'Edit';
    btn.style.color = _projectsEditMode ? 'var(--brand)' : '';
  }
};

window.filterProjects = function(q) {
  renderProjectsList(q);
};

window.filterProjectSidebar = function(q) {
  renderProjectSidebarTree(q);
};

// ─── New Project modal ───────────────────────────────────────────────────────

window.newProject = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) {
    // The markup starts with inline display:none. Keep the modal functional
    // even if the Projects stylesheet was cached or failed to load.
    modal.classList.add('open');
    modal.style.display = 'flex';
  }
  setTimeout(() => document.getElementById('new-project-name')?.focus(), 100);
};

window.closeNewProjectModal = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
  const input = document.getElementById('new-project-name');
  if (input) input.value = '';
  _pendingProjectName = '';
};

window.confirmNewProject = async function() {
  const input = document.getElementById('new-project-name');
  const name = input?.value?.trim();
  if (!name) { input?.focus(); return; }

  _pendingProjectName = name;
  const modal = document.getElementById('new-project-modal');
  if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
  document.getElementById('project-directory-modal')?.classList.add('open');
};

window.closeProjectDirectoryModal = function() {
  document.getElementById('project-directory-modal')?.classList.remove('open');
  _pendingProjectWorkspacePath = '';
  if (_pendingProjectName) {
    const input = document.getElementById('new-project-name');
    if (input) input.value = _pendingProjectName;
    window.newProject();
  }
};

function normalisePathForComparison(value) {
  return String(value || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function pathIsInside(selectedPath, rootPath) {
  const selected = normalisePathForComparison(selectedPath);
  const root = normalisePathForComparison(rootPath);
  return !!selected && !!root && (selected === root || selected.startsWith(`${root}/`));
}

async function createProjectFromPendingSetup(workspacePath = '') {
  const name = _pendingProjectName;
  if (!name) return;
  document.getElementById('project-directory-modal')?.classList.remove('open');
  document.getElementById('project-directory-permission-modal')?.classList.remove('open');
  try {
    const project = await createProjectApi(name, workspacePath);
    _pendingProjectName = '';
    _pendingProjectWorkspacePath = '';
    const input = document.getElementById('new-project-name');
    if (input) input.value = '';
    showToast(`Project "${name}" created!`);
    await loadProjects();
    _expandedProjectIds.add(project.id);
    renderProjectsList();
    await newProjectSession(project.id);
  } catch (e) {
    showToast('Failed to create project. Make sure the selected directory is allowed.', 'error');
    console.error('createProject error:', e);
  }
}

window.skipProjectDirectory = function() {
  void createProjectFromPendingSetup('');
};

function getSelectedLocalPath(result) {
  if (Array.isArray(result)) return String(result[0] || '').trim();
  if (typeof result === 'string') return result.trim();
  if (result && typeof result === 'object') {
    if (Array.isArray(result.paths)) return String(result.paths[0] || '').trim();
    return String(result.path || result.filePath || '').trim();
  }
  return '';
}

function updateProjectDirectoryPermissionSelection(selected) {
  const value = String(selected || '').trim();
  const pathEl = document.getElementById('project-directory-permission-path');
  const allowButton = document.getElementById('project-directory-permission-allow');
  if (pathEl) pathEl.value = value;
  if (allowButton) allowButton.disabled = !value;
}

async function continueProjectDirectorySetup(value) {
  const selected = String(value || '').trim();
  if (!selected) {
    showToast('Paste or choose a file or folder path first.', 'error');
    return;
  }
  const configured = await api('/api/settings/paths');
  const roots = [configured?.workspace_path, ...(Array.isArray(configured?.allowed_paths) ? configured.allowed_paths : [])];
  if (roots.some((root) => pathIsInside(selected, root))) {
    await createProjectFromPendingSetup(selected);
    return;
  }
  _pendingProjectWorkspacePath = selected;
  const pasteInput = document.getElementById('project-directory-path-input');
  if (pasteInput) pasteInput.value = selected;
  document.getElementById('project-directory-modal')?.classList.remove('open');
  updateProjectDirectoryPermissionSelection(selected);
  document.getElementById('project-directory-permission-modal')?.classList.add('open');
}

window.usePastedProjectDirectory = function() {
  const value = document.getElementById('project-directory-path-input')?.value || '';
  void continueProjectDirectorySetup(value).catch((error) => {
    showToast(error?.message || 'Could not use that project path.', 'error');
    console.error('pasted project path failed:', error);
  });
};

window.updatePastedProjectDirectory = function(value) {
  _pendingProjectWorkspacePath = String(value || '').trim();
  updateProjectDirectoryPermissionSelection(_pendingProjectWorkspacePath);
};

async function selectProjectLocalPath() {
  const bridge = window.prometheusFiles;
  const select = bridge?.selectProjectPath
    || bridge?.selectProjectFolder
    || bridge?.selectCanvasFolder;
  if (typeof select !== 'function') {
    throw new Error('The native File Explorer picker is available only in the Prometheus Desktop app.');
  }
  return await select.call(bridge);
}

window.chooseProjectDirectory = async function() {
  try {
    const result = await selectProjectLocalPath();
    const selected = getSelectedLocalPath(result);
    if (!selected) return;
    await continueProjectDirectorySetup(selected);
  } catch (error) {
    showToast(error?.message || 'Could not open File Explorer to select a project path.', 'error');
    console.error('project directory selection failed:', error);
  }
};

window.closeProjectDirectoryPermissionModal = function() {
  document.getElementById('project-directory-permission-modal')?.classList.remove('open');
  document.getElementById('project-directory-modal')?.classList.add('open');
  _pendingProjectWorkspacePath = '';
  updateProjectDirectoryPermissionSelection('');
};

window.allowProjectDirectory = async function() {
  const selected = String(document.getElementById('project-directory-permission-path')?.value || _pendingProjectWorkspacePath || '').trim();
  if (!selected) {
    showToast('Choose a file or folder before allowing access.', 'error');
    return;
  }
  try {
    const configured = await api('/api/settings/paths');
    const allowed = Array.isArray(configured?.allowed_paths) ? configured.allowed_paths : [];
    await api('/api/settings/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_path: configured?.workspace_path || '',
        allowed_paths: [...allowed, selected],
        blocked_paths: Array.isArray(configured?.blocked_paths) ? configured.blocked_paths : [],
      }),
    });
    await createProjectFromPendingSetup(selected);
  } catch (error) {
    showToast('Could not add the directory to allowed paths.', 'error');
    console.error('project directory permission failed:', error);
  }
};

// ─── Session management ──────────────────────────────────────────────────────

window.newProjectSession = async function(projectId) {
  try {
    const result = await api(`/api/projects/${projectId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    await loadProjects();
    await openProjectSession(projectId, result.sessionId);
  } catch (e) {
    showToast('Could not create project session.', 'error');
    console.error(e);
  }
};

window.openProjectSession = async function(projectId, sessionId) {
  if (window.currentMode !== 'chat' && typeof window.setMode === 'function') {
    window.setMode('chat');
  }

  _currentProjectSessionId = sessionId;
  _expandedProjectIds.add(projectId);
  const project = _projects.find((item) => item.id === projectId) || null;

  // Mark body as in-project-session — triggers CSS changes for right panel
  document.body.classList.add('in-project-session');
  document.body.dataset.projectId = projectId;
  document.body.dataset.projectName = project?.name || '';

  // Fetch session history from server, then upsert into chatSessions before switching.
  if (Array.isArray(window.chatSessions)) {
    const existing = window.chatSessions.find(s => s.id === sessionId);
    if (!existing) {
      // Try to load persisted history from the server
      let serverHistory = [];
      let serverTitle = 'New chat';
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        if (data.session) {
          serverHistory = (data.session.history || []).map(m => ({
            role: m.role === 'ai' ? 'assistant' : (m.role || 'user'),
            content: m.content || '',
            timestamp: m.timestamp || Date.now(),
          }));
          serverTitle = data.session.title || 'New chat';
        }
      } catch {}
      window.chatSessions.unshift({
        id: sessionId,
        title: serverTitle,
        history: serverHistory,
        processLog: [],
        source: 'project',
        projectId,
        projectName: project?.name || null,
        canvasProjectRoot: project?.workspacePath || null,
        canvasProjectLabel: project?.name || null,
        automated: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      if (typeof window.saveChatSessions === 'function') window.saveChatSessions();
    } else {
      existing.source = existing.source || 'project';
      existing.projectId = existing.projectId || projectId;
      existing.projectName = project?.name || existing.projectName || null;
      existing.canvasProjectRoot = project?.workspacePath || existing.canvasProjectRoot || null;
      existing.canvasProjectLabel = project?.name || existing.canvasProjectLabel || null;
      existing.automated = false;
      if (typeof window.saveChatSessions === 'function') window.saveChatSessions();
    }
  }
  // Switch to it — syncs history into chat view
  if (typeof window.openSession === 'function') {
    window.openSession(sessionId);
  } else if (typeof window.setAgentSessionId === 'function') {
    window.setAgentSessionId(sessionId);
    if (typeof window.syncActiveChat === 'function') window.syncActiveChat();
  }

  // Re-render sidebar to highlight active session
  renderProjectsList(document.getElementById('project-search')?.value || '');

  // Load project data into right panel editors
  await loadProjectEditors(projectId);

  // A project opens on its own workspace rather than generic chat connectors.
  setRightPanelTab('project');

};

// ─── Deletion ────────────────────────────────────────────────────────────────

window.confirmDeleteProject = async function(projectId, projectName) {
  showConfirm(
    `Delete project "${projectName}"? This will permanently delete all sessions and knowledge files in the project workspace.`,
    async () => {
      try {
        await deleteProjectApi(projectId);
        showToast(`Project "${projectName}" deleted.`);
        _expandedProjectIds.delete(projectId);
        if (_currentProjectSessionId) {
          const proj = _projects.find(p => p.id === projectId);
          const owned = (proj?.sessions || []).find(s => s.id === _currentProjectSessionId);
          if (owned) {
            _currentProjectSessionId = null;
            document.body.classList.remove('in-project-session');
            delete document.body.dataset.projectId;
            delete document.body.dataset.projectName;
          }
        }
        await loadProjects();
      } catch (e) {
        showToast('Delete failed.', 'error');
        console.error(e);
      }
    },
    null,
    { title: 'Delete Project', confirmText: 'Delete', danger: true }
  );
};

window.confirmDeleteProjectSession = async function(projectId, sessionId, sessionTitle) {
  showConfirm(
    `Delete session "${sessionTitle}"?`,
    async () => {
      try {
        await deleteProjectSessionApi(projectId, sessionId);
        showToast('Session deleted.');
        if (_currentProjectSessionId === sessionId) {
          _currentProjectSessionId = null;
          document.body.classList.remove('in-project-session');
          delete document.body.dataset.projectId;
          delete document.body.dataset.projectName;
        }
        await loadProjects();
      } catch (e) {
        showToast('Delete failed.', 'error');
        console.error(e);
      }
    },
    null,
    { title: 'Delete Session', confirmText: 'Delete', danger: true }
  );
};

// ─── Right panel tabs ────────────────────────────────────────────────────────

window.setRightPanelTab = function(tab) {
  _currentRpTab = tab;
  const canvasPanel = document.getElementById('canvas-panel');
  if (tab === 'canvas') {
    // ChatPage owns the Canvas lifecycle. Calling its explicit open state keeps
    // the normal Canvas button, editor setup, and panel sizing intact.
    if (typeof window.toggleCanvas === 'function') window.toggleCanvas(true);
    else if (canvasPanel) canvasPanel.style.display = 'flex';
    return;
  }
  if (canvasPanel) canvasPanel.style.display = 'none';
};

window.openProjectContextInCanvas = async function() {
  const projectId = document.body.dataset.projectId;
  if (!projectId) return;
  try {
    const data = await api(`/api/projects/${projectId}/context`);
    window.setRightPanelTab('canvas');
    if (typeof window.canvasOpenContent === 'function') {
      window.canvasOpenContent(String(data?.content || ''), 'CONTEXT.md');
    } else {
      showToast('Canvas is not ready yet.', 'error');
    }
  } catch (error) {
    showToast('Could not open CONTEXT.md.', 'error');
    console.error('project context canvas open failed:', error);
  }
};

// ─── Project editors ─────────────────────────────────────────────────────────

window.toggleProjectEditor = function(blockId) {
  document.getElementById(blockId)?.classList.toggle('collapsed');
};

async function loadProjectEditors(projectId) {
  const project = _projects.find(p => p.id === projectId);
  if (!project) return;

  const instrTA = document.getElementById('proj-instructions-ta');
  const memTA = document.getElementById('proj-memory-ta');
  const workspaceName = document.getElementById('project-workspace-name');
  const workspacePath = document.getElementById('project-workspace-path');

  if (instrTA) instrTA.value = project.instructions || '';
  if (memTA) memTA.value = project.memorySnapshot || '';
  if (workspaceName) workspaceName.textContent = project.name || 'Project';
  if (workspacePath) workspacePath.textContent = project.workspacePath
    || (project.externalImport?.sourcePath ? `Source path detected (permission required to link): ${project.externalImport.sourcePath}` : 'No linked path — project context is stored in Prometheus.');
}

window.saveProjectInstructions = async function() {
  const projectId = document.body.dataset.projectId;
  if (!projectId) return;
  const val = document.getElementById('proj-instructions-ta')?.value || '';
  try {
    await updateProjectInstructionsApi(projectId, val);
    showToast('Instructions saved.');
    // Update local cache
    const p = _projects.find(p => p.id === projectId);
    if (p) p.instructions = val;
  } catch (e) {
    showToast('Save failed.', 'error');
  }
};

window.saveProjectMemorySnapshot = async function() {
  const projectId = document.body.dataset.projectId;
  if (!projectId) return;
  const val = document.getElementById('proj-memory-ta')?.value || '';
  try {
    await updateProjectMemoryApi(projectId, val);
    showToast('Memory snapshot saved.');
    const p = _projects.find(p => p.id === projectId);
    if (p) p.memorySnapshot = val;
  } catch (e) {
    showToast('Save failed.', 'error');
  }
};

// ─── Leave project session (when user clicks a non-project session) ──────────
// Expose a helper that ChatPage.js can call when switching sessions, or
// call it directly from openProjectSession / openSession hooks.

function _maybeClearProjectState(sessionId) {
  const cachedSession = Array.isArray(window.chatSessions)
    ? window.chatSessions.find(s => s.id === sessionId)
    : null;
  if (cachedSession?.projectId) {
    _currentProjectSessionId = sessionId;
    _expandedProjectIds.add(cachedSession.projectId);
    document.body.classList.add('in-project-session');
    document.body.dataset.projectId = cachedSession.projectId;
    document.body.dataset.projectName = cachedSession.projectName || cachedSession.canvasProjectLabel || '';
    void loadProjectEditors(cachedSession.projectId);
    window.setRightPanelTab?.(_currentRpTab === 'canvas' ? 'project' : _currentRpTab);
    return;
  }
  if (!_projects.length) return;

  const ownerProject = _projects.find(p =>
    (p.sessions || []).some(s => s.id === sessionId)
  );
  if (ownerProject) {
    _currentProjectSessionId = sessionId;
    _expandedProjectIds.add(ownerProject.id);
    document.body.classList.add('in-project-session');
    document.body.dataset.projectId = ownerProject.id;
    document.body.dataset.projectName = ownerProject.name || '';
    void loadProjectEditors(ownerProject.id);
    window.setRightPanelTab?.(_currentRpTab === 'canvas' ? 'project' : _currentRpTab);
    return;
  }
  if (!ownerProject) {
    // Not a project session — clear all project UI state
    _currentProjectSessionId = null;
    _currentRpTab = 'project';
    document.body.classList.remove('in-project-session');
    delete document.body.dataset.projectId;
    delete document.body.dataset.projectName;
    window.syncChatTopbarTitle?.();

    // Restore the normal right panel topbar
    const topbar = document.getElementById('right-panel-topbar');
    if (topbar) topbar.style.display = 'flex';

    // Hide the project tab strip
    const projectTabs = document.getElementById('right-panel-project-tabs');
    if (projectTabs) projectTabs.style.display = 'none';

    // Hide the context tab content
    const contextTab = document.getElementById('rp-context-tab');
    if (contextTab) contextTab.style.display = 'none';
    const projectTab = document.getElementById('rp-project-tab');
    if (projectTab) projectTab.style.display = 'none';

    // Hide the agent-context project editors (instructions + memory snapshot)
    const agentContext = document.getElementById('agent-context-section');
    if (agentContext) agentContext.style.display = '';

    // Ensure canvas panel visibility is restored to its previous state
    // (don't force-open it, just make sure it's not stuck hidden by project tab logic)
    const canvasPanel = document.getElementById('canvas-panel');
    if (canvasPanel && canvasPanel.style.display === 'none') {
      // Only restore if canvas was open before entering project mode
      // Leave it as-is — syncActiveChat() in ChatPage will handle canvas tab state
    }
  }
}
window._maybeClearProjectState = _maybeClearProjectState;

// ─── Expose for external use ─────────────────────────────────────────────────
window.loadProjects = loadProjects;
window.renderProjectsList = renderProjectsList;
window.renderProjectSidebarTree = renderProjectSidebarTree;
