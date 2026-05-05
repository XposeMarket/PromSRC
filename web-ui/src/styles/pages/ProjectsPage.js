/**
 * ProjectsPage.js — Projects System
 *
 * Handles:
 *  - Sidebar: Projects tab, project cards, session dropdowns, edit mode
 *  - Right panel: Canvas/Connectors/Context tab switching (project sessions only)
 *  - Project Context tab: file grid, upload, token meter
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
 *   toggleProjectEditor(blockId), onProjectFileInput(event)
 */

import { api } from '../../api.js';
import { showToast, showConfirm, timeAgo } from '../../utils.js';

// ─── State ──────────────────────────────────────────────────────────────────
let _projects = [];           // Array<ProjectRecord>
let _activeProjectId = null;  // currently open project (card expanded)
let _projectsEditMode = false;
let _currentRpTab = 'canvas'; // 'canvas' | 'connectors' | 'context'
let _currentProjectSessionId = null; // session currently open in chat

// ─── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    loadProjects();
  }, 400);
});

// ─── API calls ──────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const data = await api('/api/projects');
    _projects = Array.isArray(data) ? data : (data.projects || []);
    renderProjectsList();
  } catch (e) {
    // API not wired yet — silently show empty state
    _projects = [];
    renderProjectsList();
  }
}

async function createProjectApi(name) {
  return await api('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
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
  const fd = new FormData();
  fd.append('file', file);
  return await api(`/api/projects/${projectId}/files`, { method: 'POST', body: fd });
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
    ? _projects.filter(p => p.name.toLowerCase().includes(q))
    : _projects;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${q ? 'No projects match.' : 'No projects yet.<br>Create your first project.'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => renderProjectCard(p)).join('');
}

function renderProjectCard(p) {
  const sessionCount = (p.sessions || []).length;
  const lastActive = p.updatedAt ? timeAgo(p.updatedAt) : 'never';
  const isOpen = _activeProjectId === p.id;
  const sessionRows = (p.sessions || []).map(s => renderProjectSessionItem(p.id, s)).join('');

  return `
<div class="project-card${isOpen ? ' open' : ''}${_currentProjectSessionId && (p.sessions||[]).find(s=>s.id===_currentProjectSessionId) ? ' active-project' : ''}"
     id="proj-card-${p.id}">
  <div class="project-card-header" onclick="toggleProjectCard('${p.id}')">
    <div class="project-card-icon">🗂</div>
    <div class="project-card-meta">
      <div class="project-card-name">${escHtmlLocal(p.name)}</div>
      <div class="project-card-sub">${sessionCount} session${sessionCount !== 1 ? 's' : ''} · ${lastActive}</div>
    </div>
    <button class="project-card-add-btn" title="New chat in project"
      onclick="event.stopPropagation();newProjectSession('${p.id}')">+</button>
    <button class="project-card-delete-btn" title="Delete project"
      onclick="event.stopPropagation();confirmDeleteProject('${p.id}','${escHtmlLocal(p.name)}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>
    <span class="project-card-chevron">&#9660;</span>
  </div>
  <div class="project-sessions-list">
    ${sessionRows || `<div style="padding:10px 20px;font-size:11px;color:var(--muted)">No sessions yet — click + to start one.</div>`}
  </div>
</div>`;
}

function renderProjectSessionItem(projectId, s) {
  const isActive = s.id === _currentProjectSessionId;
  const title = s.title || s.id?.slice(0, 12) || 'Untitled';
  const when = s.updatedAt ? timeAgo(s.updatedAt) : '';
  return `
<div class="project-session-item${isActive ? ' active-session' : ''}"
     onclick="openProjectSession('${projectId}','${s.id}')">
  <span class="project-session-dot"></span>
  <span class="project-session-name">${escHtmlLocal(title)}</span>
  <span class="project-session-time">${when}</span>
  <button class="project-session-delete-btn" title="Delete session"
    onclick="event.stopPropagation();confirmDeleteProjectSession('${projectId}','${s.id}','${escHtmlLocal(title)}')">✕</button>
</div>`;
}

function escHtmlLocal(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Project card toggle ─────────────────────────────────────────────────────

window.toggleProjectCard = function(projectId) {
  _activeProjectId = _activeProjectId === projectId ? null : projectId;
  renderProjectsList(document.getElementById('project-search')?.value || '');
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

// ─── New Project modal ───────────────────────────────────────────────────────

window.newProject = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) modal.classList.add('open');
  setTimeout(() => document.getElementById('new-project-name')?.focus(), 100);
};

window.closeNewProjectModal = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) modal.classList.remove('open');
  const input = document.getElementById('new-project-name');
  if (input) input.value = '';
};

window.confirmNewProject = async function() {
  const input = document.getElementById('new-project-name');
  const name = input?.value?.trim();
  if (!name) { input?.focus(); return; }

  closeNewProjectModal();

  try {
    const project = await createProjectApi(name);
    showToast(`Project "${name}" created!`);
    await loadProjects();

    // Expand the new project card
    _activeProjectId = project.id;
    renderProjectsList();

    // Create first session in this project
    await newProjectSession(project.id, true);
  } catch (e) {
    showToast('Failed to create project. Make sure the backend is wired.', 'error');
    console.error('createProject error:', e);
  }
};

window.closeNewProjectModal = closeNewProjectModal;

// ─── Session management ──────────────────────────────────────────────────────

window.newProjectSession = async function(projectId, isOnboarding = false) {
  try {
    const result = await api(`/api/projects/${projectId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOnboarding }),
    });

    await loadProjects();
    await openProjectSession(projectId, result.sessionId, isOnboarding);
  } catch (e) {
    showToast('Could not create project session.', 'error');
    console.error(e);
  }
};

window.openProjectSession = async function(projectId, sessionId, isOnboarding = false) {
  _currentProjectSessionId = sessionId;
  _activeProjectId = projectId;

  // Mark body as in-project-session — triggers CSS changes for right panel
  document.body.classList.add('in-project-session');
  document.body.dataset.projectId = projectId;

  // Switch to the session in the main chat view
  if (typeof window.switchToSession === 'function') {
    window.switchToSession(sessionId);
  } else if (typeof window.setAgentSessionId === 'function') {
    window.setAgentSessionId(sessionId);
    if (typeof window.loadChatHistory === 'function') window.loadChatHistory(sessionId);
  }

  // Re-render sidebar to highlight active session
  renderProjectsList(document.getElementById('project-search')?.value || '');

  // Load project data into right panel editors
  await loadProjectEditors(projectId);

  // Set canvas tab as default when entering project session
  setRightPanelTab('canvas');

  // If onboarding, fire the welcome message after a short delay
  if (isOnboarding) {
    setTimeout(() => sendOnboardingMessage(projectId), 800);
  }
};

function sendOnboardingMessage(projectId) {
  const project = _projects.find(p => p.id === projectId);
  const projectName = project?.name || 'your new project';
  const userName = window._userName || 'there';

  const msg = `Hey ${userName}! I've set up a new project workspace for **${projectName}**. To help me build the right context from the start — what are we working on here? Feel free to share any background, goals, or files. A few things that would help:\n\n- What's the main goal or outcome for this project?\n- Any key people, clients, or tools involved?\n- Would you like to give it a different name?\n\nYou can also drag files into the Context tab on the right at any time and I'll work them into my understanding of the project.`;

  // Inject as an assistant message into the chat
  if (typeof window.injectAssistantMessage === 'function') {
    window.injectAssistantMessage(msg);
  } else {
    // Fallback: send as a system-triggered chat
    if (typeof window.sendChat === 'function') {
      window.sendChat(`__project_onboarding__${JSON.stringify({ projectId, projectName })}`, { hidden: true });
    }
  }
}

// ─── Deletion ────────────────────────────────────────────────────────────────

window.confirmDeleteProject = async function(projectId, projectName) {
  const ok = await showConfirm(
    `Delete project "${projectName}"?\n\nThis will permanently delete all sessions and knowledge files in the project workspace.`
  );
  if (!ok) return;

  try {
    await deleteProjectApi(projectId);
    showToast(`Project "${projectName}" deleted.`);
    if (_activeProjectId === projectId) _activeProjectId = null;
    if (_currentProjectSessionId) {
      // Check if current session belonged to this project
      const proj = _projects.find(p => p.id === projectId);
      const owned = (proj?.sessions || []).find(s => s.id === _currentProjectSessionId);
      if (owned) {
        _currentProjectSessionId = null;
        document.body.classList.remove('in-project-session');
        delete document.body.dataset.projectId;
      }
    }
    await loadProjects();
  } catch (e) {
    showToast('Delete failed.', 'error');
    console.error(e);
  }
};

window.confirmDeleteProjectSession = async function(projectId, sessionId, sessionTitle) {
  const ok = await showConfirm(`Delete session "${sessionTitle}"?`);
  if (!ok) return;

  try {
    await deleteProjectSessionApi(projectId, sessionId);
    showToast('Session deleted.');
    if (_currentProjectSessionId === sessionId) {
      _currentProjectSessionId = null;
      document.body.classList.remove('in-project-session');
    }
    await loadProjects();
  } catch (e) {
    showToast('Delete failed.', 'error');
    console.error(e);
  }
};

// ─── Right panel tabs ────────────────────────────────────────────────────────

window.setRightPanelTab = function(tab) {
  _currentRpTab = tab;

  // Update tab button states
  ['canvas', 'connectors', 'context'].forEach(t => {
    document.getElementById(`rp-tab-${t}`)?.classList.toggle('active', t === tab);
  });

  const canvasPanel = document.getElementById('canvas-panel');
  const connectionsSection = document.getElementById('connections-section');
  const contextTab = document.getElementById('rp-context-tab');

  // Hide all first
  if (canvasPanel) canvasPanel.style.display = 'none';
  if (connectionsSection) connectionsSection.style.display = 'none';
  if (contextTab) contextTab.style.display = 'none';

  if (tab === 'canvas') {
    // Show canvas — use existing toggleCanvas logic
    if (canvasPanel) canvasPanel.style.display = 'flex';
    if (typeof window.openCanvas === 'function') window.openCanvas();
  } else if (tab === 'connectors') {
    if (connectionsSection) connectionsSection.style.display = 'block';
    // Reload connectors if needed
    if (typeof window.renderConnectors === 'function') window.renderConnectors();
  } else if (tab === 'context') {
    if (contextTab) contextTab.style.display = 'flex';
    const projId = document.body.dataset.projectId;
    if (projId) refreshProjectFileGrid(projId);
  }
};

// ─── Project file grid ───────────────────────────────────────────────────────

async function refreshProjectFileGrid(projectId) {
  const grid = document.getElementById('project-file-grid');
  if (!grid) return;

  const files = await loadProjectFiles(projectId);
  renderFileGrid(files, projectId);
  updateTokenMeter(files);
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    md: '📝', txt: '📄', pdf: '📕', doc: '📘', docx: '📘',
    xls: '📗', xlsx: '📗', csv: '📊', json: '🔧', js: '⚡',
    ts: '⚡', py: '🐍', html: '🌐', css: '🎨', png: '🖼',
    jpg: '🖼', jpeg: '🖼', gif: '🖼', zip: '📦', mp4: '🎬',
  };
  return icons[ext] || '📄';
}

function renderFileGrid(files, projectId) {
  const grid = document.getElementById('project-file-grid');
  if (!grid) return;

  if (!files.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:11px;padding:16px 0">No knowledge files yet.<br>Upload files to build project context.</div>`;
    return;
  }

  grid.innerHTML = files.map(f => `
    <div class="project-file-card" onclick="openProjectFileInCanvas('${projectId}','${f.id}','${escHtmlLocal(f.name)}')" title="${escHtmlLocal(f.name)}">
      <div class="project-file-icon">${getFileIcon(f.name)}</div>
      <div class="project-file-name">${escHtmlLocal(f.name)}</div>
    </div>
  `).join('');
}

function updateTokenMeter(files) {
  const totalTokens = files.reduce((sum, f) => sum + (f.tokens || 0), 0);
  const maxTokens = 50000; // approximate budget
  const pct = Math.min(100, Math.round((totalTokens / maxTokens) * 100));

  const label = document.getElementById('project-token-label');
  const fill = document.getElementById('project-token-fill');
  const pctEl = document.getElementById('project-token-pct');

  if (label) label.textContent = `${totalTokens.toLocaleString()} tokens`;
  if (fill) fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
}

window.openProjectFileInCanvas = function(projectId, fileId, fileName) {
  // Open canvas and load this project file
  if (typeof window.toggleCanvas === 'function') window.toggleCanvas();
  setRightPanelTab('canvas');
  // Load file into canvas — use existing canvas API
  if (typeof window.canvasLoadProjectFile === 'function') {
    window.canvasLoadProjectFile(projectId, fileId, fileName);
  } else {
    // Fallback: fetch file content and open in canvas
    api(`/api/projects/${projectId}/files/${fileId}/content`)
      .then(data => {
        if (typeof window.canvasOpenContent === 'function') {
          window.canvasOpenContent(data.content, fileName);
        }
      })
      .catch(() => showToast('Could not open file.', 'error'));
  }
};

// ─── File upload ─────────────────────────────────────────────────────────────

window.onProjectFileInput = async function(event) {
  const projectId = document.body.dataset.projectId;
  if (!projectId) return;

  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  for (const file of files) {
    try {
      await uploadProjectFile(projectId, file);
      showToast(`${file.name} added to project.`);
    } catch (e) {
      showToast(`Failed to upload ${file.name}.`, 'error');
    }
  }
  event.target.value = '';
  await refreshProjectFileGrid(projectId);
};

// Drag and drop on upload zone
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const zone = document.getElementById('project-upload-zone');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const projectId = document.body.dataset.projectId;
      if (!projectId) return;
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        try {
          await uploadProjectFile(projectId, file);
          showToast(`${file.name} uploaded.`);
        } catch { showToast(`Failed to upload ${file.name}.`, 'error'); }
      }
      await refreshProjectFileGrid(projectId);
    });
  }, 600);
});

// ─── Project editors ─────────────────────────────────────────────────────────

window.toggleProjectEditor = function(blockId) {
  document.getElementById(blockId)?.classList.toggle('collapsed');
};

async function loadProjectEditors(projectId) {
  const project = _projects.find(p => p.id === projectId);
  if (!project) return;

  const instrTA = document.getElementById('proj-instructions-ta');
  const memTA = document.getElementById('proj-memory-ta');

  if (instrTA) instrTA.value = project.instructions || '';
  if (memTA) memTA.value = project.memorySnapshot || '';
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
  const ownerProject = _projects.find(p =>
    (p.sessions || []).some(s => s.id === sessionId)
  );
  if (!ownerProject && _currentProjectSessionId) {
    _currentProjectSessionId = null;
    document.body.classList.remove('in-project-session');
    delete document.body.dataset.projectId;
    _currentRpTab = 'canvas';
  }
}
window._maybeClearProjectState = _maybeClearProjectState;

// ─── Expose for external use ─────────────────────────────────────────────────
window.loadProjects = loadProjects;
window.renderProjectsList = renderProjectsList;
window.refreshProjectFileGrid = refreshProjectFileGrid;
