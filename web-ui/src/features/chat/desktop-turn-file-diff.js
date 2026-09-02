const TURN_FILE_ROW_SELECTOR = '.file-changes-card .file-change-row.is-openable';

function decodeInlineString(value) {
  if (!value) return '';
  try {
    return String(JSON.parse(value) || '').trim();
  } catch {
    return '';
  }
}

function turnFileTarget(row) {
  const handler = String(row?.getAttribute?.('onclick') || '');
  const match = handler.match(/canvasPresentFile\(\s*("(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*")(?:\s*,|\s*\))/);
  if (!match) return null;

  const path = decodeInlineString(match[1]);
  if (!path) return null;

  const fallbackLabel = decodeInlineString(match[2]);
  const displayPath = String(row.querySelector('.file-change-path')?.textContent || fallbackLabel || path).trim();
  const insertions = Number.parseInt(String(row.querySelector('.file-change-counts .ins')?.textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
  const deletions = Number.parseInt(String(row.querySelector('.file-change-counts .del')?.textContent || '').replace(/[^0-9]/g, ''), 10) || 0;

  return {
    key: `workspace-file:${path}`,
    type: 'workspace-file',
    title: displayPath,
    path,
    displayPath,
    status: 'modified',
    insertions,
    deletions,
  };
}

export function openTurnFileDiff(row) {
  const target = turnFileTarget(row);
  if (!target || typeof window.canvasPresentFile !== 'function') return false;
  // End-of-turn files belong in the already-open Canvas surface. The full
  // Coding workspace modal is still available from the Sources panel, but it
  // should not interrupt the chat just because a file-change row was clicked.
  window.canvasPresentFile(target.path, target.displayPath, {
    openMode: 'diff',
    diffView: 'turn',
  });
  return true;
}

function matchingTurnFileRow(target) {
  return target instanceof Element ? target.closest(TURN_FILE_ROW_SELECTOR) : null;
}

function onTurnFileClick(event) {
  const row = matchingTurnFileRow(event.target);
  if (!row || !openTurnFileDiff(row)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onTurnFileKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = matchingTurnFileRow(event.target);
  if (!row || !openTurnFileDiff(row)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

if (!window.__PROM_SHOULD_BOOT_MOBILE?.()) {
  document.addEventListener('click', onTurnFileClick, true);
  document.addEventListener('keydown', onTurnFileKeydown, true);
}
