import { api, ENDPOINTS } from '../api.js';
import { escHtml } from '../utils.js';
import { renderUnifiedDiffMarkup } from './coding-diff.js';

export async function loadCodingWorkspace(root = '', sessionId = '') {
  if (root) {
    const suffix = `?root=${encodeURIComponent(root)}`;
    const [sessionData, contextData] = await Promise.all([
      api(`${ENDPOINTS.CODING_SESSION}${suffix}`),
      api(`${ENDPOINTS.CODING_CONTEXT}?root=${encodeURIComponent(root)}&scope=project${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`),
    ]);
    return sessionData?.session ? { ...sessionData.session, context: contextData || null } : null;
  }
  const sessionQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const contextParams = new URLSearchParams();
  if (sessionId) contextParams.set('sessionId', sessionId);
  contextParams.set('scope', sessionId ? 'thread' : 'project');
  const [sessionData, contextData] = await Promise.all([
    api(`${ENDPOINTS.CODING_SESSION}${sessionQuery}`),
    api(`${ENDPOINTS.CODING_CONTEXT}?${contextParams.toString()}`),
  ]);
  return sessionData?.session ? { ...sessionData.session, context: contextData || null } : null;
}

export function renderCodingWorkspacePanel(session) {
  if (!session) {
    return '<div class="coding-workspace-empty">No coding workspace detected.</div>';
  }
  const context = session.context || null;
  const changed = Array.isArray(context?.files) ? context.files : [];
  const dirty = changed.length ? changed.map((file) => file.displayPath || file.path) : (Array.isArray(session.dirtyFiles) ? session.dirtyFiles : []);
  const rootPath = session.root || context?.root || '';
  return `
    <div class="coding-workspace-card" data-coding-root="${escHtml(rootPath)}">
      <div class="coding-workspace-head">
        <div>
          <div class="coding-workspace-title">${escHtml(session.name || 'Workspace')}</div>
          <div class="coding-workspace-root">${escHtml(rootPath)}</div>
        </div>
        <span class="coding-workspace-pill">${escHtml(context?.repositories?.length ? 'Git' : 'Files')}</span>
      </div>
      <div class="coding-workspace-grid">
        <div><span>Branch</span><strong>${escHtml(session.branch || 'none')}</strong></div>
        <div><span>Changed</span><strong>${escHtml(String(context?.counts?.files ?? dirty.length))}</strong></div>
        <div><span>Test</span><strong>${escHtml(session.testCommand || 'not detected')}</strong></div>
        <div><span>Build</span><strong>${escHtml(session.buildCommand || 'not detected')}</strong></div>
      </div>
      ${session.devCommand ? `<div class="coding-workspace-command">Dev: ${escHtml(session.devCommand)}</div>` : ''}
      ${dirty.length ? `<div class="coding-workspace-files">${dirty.slice(0, 12).map((file, index) => {
        const item = changed[index];
        return item?.path
          ? `<button type="button" data-coding-diff-file="${escHtml(item.path)}" title="Open diff">${escHtml(file)}</button>`
          : `<span>${escHtml(file)}</span>`;
      }).join('')}</div>` : ''}
      <div class="coding-workspace-actions">
        <button type="button" data-coding-action="diff">Diff</button>
        ${session.testCommand ? `<button type="button" data-coding-command="${escHtml(session.testCommand)}">Run Tests</button>` : ''}
        ${session.buildCommand ? `<button type="button" data-coding-command="${escHtml(session.buildCommand)}">Build</button>` : ''}
        ${session.devCommand ? `<button type="button" data-coding-start="${escHtml(session.devCommand)}">Dev Server</button>` : ''}
      </div>
      <div class="coding-workspace-diff" hidden></div>
    </div>`;
}

export function installCodingWorkspaceHandlers(root = document) {
  root.addEventListener('click', async (event) => {
    const fileButton = event.target?.closest?.('[data-coding-diff-file]');
    if (fileButton) {
      const card = fileButton.closest('.coding-workspace-card');
      const rootPath = card?.dataset?.codingRoot || '';
      const filePath = fileButton.dataset.codingDiffFile || '';
      const el = card?.querySelector?.('.coding-workspace-diff');
      if (!el || !filePath) return;
      try {
        const data = await api(`${ENDPOINTS.CODING_DIFF}?root=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(filePath)}`);
        el.innerHTML = renderUnifiedDiffMarkup(data?.diff, { emptyText: data?.baselineKind === 'none' ? 'No comparison baseline is available for this file.' : undefined });
        el.hidden = false;
      } catch (error) {
        el.textContent = error?.message || 'Unable to load diff';
        el.hidden = false;
      }
      return;
    }
    const diffButton = event.target?.closest?.('[data-coding-action="diff"]');
    if (diffButton) {
      const el = diffButton.closest('.coding-workspace-card')?.querySelector?.('.coding-workspace-diff');
      if (!el) return;
      if (!el.hidden) {
        el.hidden = true;
        return;
      }
      const rootPath = diffButton.closest('.coding-workspace-card')?.dataset?.codingRoot || '';
      const firstFile = diffButton.closest('.coding-workspace-card')?.querySelector?.('[data-coding-diff-file]');
      if (firstFile?.dataset?.codingDiffFile) {
        try {
          const data = await api(`${ENDPOINTS.CODING_DIFF}?root=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(firstFile.dataset.codingDiffFile)}`);
          el.innerHTML = renderUnifiedDiffMarkup(data?.diff, { emptyText: data?.baselineKind === 'none' ? 'No comparison baseline is available for this file.' : undefined });
        } catch (error) {
          el.textContent = error?.message || 'Unable to load diff';
        }
      } else {
        el.textContent = 'No changed files are available in this workspace.';
      }
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
