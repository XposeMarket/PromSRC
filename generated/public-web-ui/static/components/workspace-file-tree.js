/**
 * Small vanilla-JS file tree used by the desktop workspace surfaces.
 *
 * It intentionally mirrors the behavior of the FileTree reference without
 * pulling React-only dependencies into the desktop build: nested branches,
 * a gliding selection, and roving keyboard navigation are all provided by
 * regular buttons and event delegation.
 */

const FILE_TAGS = {
  json: ['JSN', 'json'], md: ['MD', 'markdown'], markdown: ['MD', 'markdown'],
  txt: ['TXT', 'text'], log: ['LOG', 'log'], csv: ['CSV', 'data'],
  html: ['HTM', 'html'], htm: ['HTM', 'html'], js: ['JS', 'javascript'],
  mjs: ['JS', 'javascript'], cjs: ['JS', 'javascript'], ts: ['TS', 'typescript'],
  jsx: ['JSX', 'javascript'], tsx: ['TSX', 'typescript'], py: ['PY', 'python'],
  sh: ['SH', 'shell'], bash: ['SH', 'shell'], yaml: ['YML', 'data'], yml: ['YML', 'data'],
  css: ['CSS', 'stylesheet'], scss: ['CSS', 'stylesheet'], xml: ['XML', 'markup'],
  svg: ['SVG', 'image'], png: ['IMG', 'image'], jpg: ['IMG', 'image'],
  jpeg: ['IMG', 'image'], gif: ['IMG', 'image'], webp: ['IMG', 'image'],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileTag(name) {
  const rawExt = String(name || '').split('.').pop().toLowerCase();
  const [label, kind] = FILE_TAGS[rawExt] || [(rawExt || 'FIL').slice(0, 3).toUpperCase(), 'file'];
  return `<span class="prom-file-tree-file-tag prom-file-tree-file-tag--${kind}" aria-hidden="true">${label}</span>`;
}

function formatSize(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '';
  const value = Number(bytes);
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value > 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function renderEntry(entry, depth, options, parentPath = '') {
  const relativePath = String(entry?.relativePath || entry?.name || '').replace(/\\/g, '/');
  const name = String(entry?.name || relativePath.split('/').pop() || 'Untitled');
  const indent = Math.max(0, Number(depth) || 0);
  const expanded = options.expandedPaths.has(relativePath);
  const selected = options.selectedPath === relativePath;
  const parent = parentPath || relativePath.split('/').slice(0, -1).join('/');
  const tabIndex = options.tabIndexAssigned ? -1 : 0;
  options.tabIndexAssigned = true;

  if (entry?.isDirectory) {
    const children = Array.isArray(entry.children) ? entry.children : [];
    return `<div class="prom-file-tree-node ${expanded ? 'is-expanded' : ''}" data-file-tree-node>
      <button type="button" class="prom-file-tree-row prom-file-tree-folder-row" data-file-tree-row data-file-tree-folder="${escapeHtml(relativePath)}" data-file-tree-parent="${escapeHtml(parent)}" aria-expanded="${expanded ? 'true' : 'false'}" tabindex="${tabIndex}" style="--file-tree-depth:${indent}">
        <span class="prom-file-tree-chevron" aria-hidden="true"></span>
        <span class="prom-file-tree-folder-icon" aria-hidden="true"></span>
        <span class="prom-file-tree-name">${escapeHtml(name)}</span>
        <span class="prom-file-tree-count">${children.length}</span>
      </button>
      ${expanded && children.length ? `<div class="prom-file-tree-branch" data-file-tree-branch>${children.map((child) => renderEntry(child, indent + 1, options, relativePath)).join('')}</div>` : ''}
    </div>`;
  }

  const size = options.showMetadata ? formatSize(entry?.size) : '';
  const modified = options.showMetadata && entry?.modifiedAt && typeof options.timeAgo === 'function'
    ? options.timeAgo(entry.modifiedAt)
    : '';
  const writer = options.showAgentMetadata && entry?.writtenBy
    ? `<span class="prom-file-tree-agent-tag">w: ${escapeHtml(entry.writtenBy)}</span>`
    : '';
  const readers = options.showAgentMetadata && Array.isArray(entry?.readBy)
    ? entry.readBy.slice(0, 3).map((id) => `<span class="prom-file-tree-reader-tag">r: ${escapeHtml(id)}</span>`).join('')
    : '';
  return `<button type="button" class="prom-file-tree-row prom-file-tree-file-row ${selected ? 'is-selected' : ''}" data-file-tree-row data-file-tree-file="${escapeHtml(relativePath)}" data-file-tree-parent="${escapeHtml(parent)}" aria-selected="${selected ? 'true' : 'false'}" tabindex="${tabIndex}" style="--file-tree-depth:${indent}" title="${escapeHtml(relativePath)}">
    <span class="prom-file-tree-file-leading">${fileTag(name)}</span>
    <span class="prom-file-tree-name">${escapeHtml(name)}</span>
    <span class="prom-file-tree-file-meta">${writer}${readers}${size ? `<span>${size}</span>` : ''}${modified ? `<span>${escapeHtml(modified)}</span>` : ''}</span>
  </button>`;
}

export function renderWorkspaceFileTree(entries, options = {}) {
  const expandedPaths = options.expandedPaths instanceof Set ? options.expandedPaths : new Set(options.expandedPaths || []);
  const config = {
    expandedPaths,
    selectedPath: String(options.selectedPath || ''),
    showMetadata: options.showMetadata !== false,
    showAgentMetadata: options.showAgentMetadata === true,
    timeAgo: options.timeAgo,
    tabIndexAssigned: false,
  };
  const list = Array.isArray(entries) ? entries : [];
  return list.length
    ? list.map((entry) => renderEntry(entry, 0, config)).join('')
    : '<div class="prom-file-tree-empty">No workspace files yet.</div>';
}

export function bindWorkspaceFileTree(root, { onToggle, onSelect } = {}) {
  if (!root) return () => {};
  root.__promWorkspaceFileTreeCleanup?.();

  const rows = () => Array.from(root.querySelectorAll('[data-file-tree-row]'));
  const focusRow = (row) => {
    if (!row) return;
    rows().forEach((candidate) => candidate.setAttribute('tabindex', candidate === row ? '0' : '-1'));
    row.focus({ preventScroll: true });
  };
  const activate = (row) => {
    if (!row) return;
    if (row.dataset.fileTreeFolder) onToggle?.(row.dataset.fileTreeFolder);
    else if (row.dataset.fileTreeFile) onSelect?.(row.dataset.fileTreeFile);
  };
  const onClick = (event) => {
    const row = event.target?.closest?.('[data-file-tree-row]');
    if (!row || !root.contains(row)) return;
    activate(row);
  };
  const onKeyDown = (event) => {
    const row = event.target?.closest?.('[data-file-tree-row]');
    if (!row || !root.contains(row)) return;
    const currentRows = rows();
    const index = currentRows.indexOf(row);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(currentRows.length - 1, index + 1)
        : Math.max(0, index - 1);
      focusRow(currentRows[nextIndex]);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(row);
      return;
    }
    if (event.key === 'ArrowRight' && row.dataset.fileTreeFolder) {
      if (row.getAttribute('aria-expanded') !== 'true') {
        event.preventDefault();
        onToggle?.(row.dataset.fileTreeFolder);
      } else if (currentRows[index + 1]) {
        event.preventDefault();
        focusRow(currentRows[index + 1]);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      if (row.dataset.fileTreeFolder && row.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        onToggle?.(row.dataset.fileTreeFolder);
      } else {
        const parent = row.dataset.fileTreeParent;
        const parentRow = parent ? currentRows.find((candidate) => candidate.dataset.fileTreeFolder === parent) : null;
        if (parentRow) {
          event.preventDefault();
          focusRow(parentRow);
        }
      }
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  const cleanup = () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
    if (root.__promWorkspaceFileTreeCleanup === cleanup) delete root.__promWorkspaceFileTreeCleanup;
  };
  root.__promWorkspaceFileTreeCleanup = cleanup;
  return cleanup;
}
