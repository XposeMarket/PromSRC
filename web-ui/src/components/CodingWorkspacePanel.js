import { api, ENDPOINTS } from '../api.js';
import { escHtml } from '../utils.js';

export async function loadCodingWorkspace(root = '') {
  const suffix = root ? `?root=${encodeURIComponent(root)}` : '';
  const data = await api(`${ENDPOINTS.CODING_SESSION}${suffix}`);
  return data?.session || null;
}

export function renderCodingWorkspacePanel(session) {
  if (!session) {
    return '<div class="coding-workspace-empty">No coding workspace detected.</div>';
  }
  const dirty = Array.isArray(session.dirtyFiles) ? session.dirtyFiles : [];
  return `
    <div class="coding-workspace-card" data-coding-root="${escHtml(session.root || '')}">
      <div class="coding-workspace-head">
        <div>
          <div class="coding-workspace-title">${escHtml(session.name || 'Workspace')}</div>
          <div class="coding-workspace-root">${escHtml(session.root || '')}</div>
        </div>
        <span class="coding-workspace-pill">${escHtml(session.packageManager || 'unknown')}</span>
      </div>
      <div class="coding-workspace-grid">
        <div><span>Branch</span><strong>${escHtml(session.branch || 'none')}</strong></div>
        <div><span>Changed</span><strong>${dirty.length}</strong></div>
        <div><span>Test</span><strong>${escHtml(session.testCommand || 'not detected')}</strong></div>
        <div><span>Build</span><strong>${escHtml(session.buildCommand || 'not detected')}</strong></div>
      </div>
      ${session.devCommand ? `<div class="coding-workspace-command">Dev: ${escHtml(session.devCommand)}</div>` : ''}
      ${dirty.length ? `<div class="coding-workspace-files">${dirty.slice(0, 12).map((file) => `<span>${escHtml(file)}</span>`).join('')}</div>` : ''}
      <div class="coding-workspace-actions">
        <button type="button" data-coding-action="diff">Diff</button>
        ${session.testCommand ? `<button type="button" data-coding-command="${escHtml(session.testCommand)}">Run Tests</button>` : ''}
        ${session.buildCommand ? `<button type="button" data-coding-command="${escHtml(session.buildCommand)}">Build</button>` : ''}
        ${session.devCommand ? `<button type="button" data-coding-start="${escHtml(session.devCommand)}">Dev Server</button>` : ''}
      </div>
      <pre class="coding-workspace-diff" id="coding-workspace-diff" hidden></pre>
    </div>`;
}

export function installCodingWorkspaceHandlers(root = document) {
  root.addEventListener('click', async (event) => {
    const diffButton = event.target?.closest?.('[data-coding-action="diff"]');
    if (diffButton) {
      const el = document.getElementById('coding-workspace-diff');
      if (!el) return;
      if (!el.hidden) {
        el.hidden = true;
        return;
      }
      const rootPath = diffButton.closest('.coding-workspace-card')?.dataset?.codingRoot || '';
      const suffix = rootPath ? `?root=${encodeURIComponent(rootPath)}` : '';
      const data = await api(`${ENDPOINTS.CODING_DIFF}${suffix}`);
      el.textContent = data?.diff || '(no diff)';
      el.hidden = false;
      return;
    }

    const commandButton = event.target?.closest?.('[data-coding-command]');
    if (commandButton) {
      const command = commandButton.dataset.codingCommand;
      const rootPath = commandButton.closest('.coding-workspace-card')?.dataset?.codingRoot || '';
      await api(ENDPOINTS.PROCESSES, {
        method: 'POST',
        body: { command, cwd: rootPath || undefined, background: false, timeoutMs: 120000 },
        timeoutMs: 180000,
      });
      window.refreshProcessRunsPanel?.();
      return;
    }

    const startButton = event.target?.closest?.('[data-coding-start]');
    if (startButton) {
      const command = startButton.dataset.codingStart;
      const rootPath = startButton.closest('.coding-workspace-card')?.dataset?.codingRoot || '';
      await api(ENDPOINTS.PROCESSES, {
        method: 'POST',
        body: { command, cwd: rootPath || undefined, background: true, title: 'Dev server', stdinMode: 'pipe' },
      });
      window.refreshProcessRunsPanel?.();
    }
  });
}
