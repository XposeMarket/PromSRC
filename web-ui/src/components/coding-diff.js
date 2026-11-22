import { escHtml } from '../utils.js';

function hunkStart(line) {
  const match = String(line || '').match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return match ? Number(match[1]) || 1 : null;
}

export function diffStats(diff) {
  let insertions = 0;
  let deletions = 0;
  let binary = false;
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (/^Binary files /.test(line)) binary = true;
    else if (line.startsWith('+') && !line.startsWith('+++')) insertions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { insertions, deletions, binary };
}

export function renderUnifiedDiffMarkup(diff, options = {}) {
  const text = String(diff || '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    return `<div class="coding-diff-empty">${escHtml(options.emptyText || 'No changes in this view.')}</div>`;
  }
  if (/^Binary files /m.test(text)) {
    return '<div class="coding-diff-binary"><span aria-hidden="true">◈</span><span>Binary file changed. There is no text diff to display.</span></div>';
  }

  const maxLines = Math.max(100, Math.min(5000, Number(options.maxLines) || 2500));
  const lines = text.split('\n').slice(0, maxLines);
  let oldLine = 0;
  let newLine = 0;
  const rows = [];
  for (const rawLine of lines) {
    const line = rawLine === '' && rows.length === lines.length - 1 ? '' : rawLine;
    const hunk = hunkStart(line);
    if (hunk !== null) {
      const headerMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      oldLine = Number(headerMatch?.[1] || 1);
      newLine = Number(headerMatch?.[3] || hunk);
      rows.push(`<div class="coding-diff-hunk"><span>${escHtml(line)}</span></div>`);
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git ') || line.startsWith('index ')) continue;
    if (line === '\\ No newline at end of file') {
      rows.push(`<div class="coding-diff-note"><span>${escHtml(line)}</span></div>`);
      continue;
    }
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'context';
    const content = kind === 'context' ? line : line.slice(1);
    const oldNumber = kind === 'add' ? '' : oldLine++;
    const newNumber = kind === 'del' ? '' : newLine++;
    const prefix = kind === 'add' ? '+' : kind === 'del' ? '-' : ' ';
    rows.push(`<div class="coding-diff-line coding-diff-line--${kind}"><span class="coding-diff-number coding-diff-number--old">${oldNumber}</span><span class="coding-diff-number coding-diff-number--new">${newNumber}</span><span class="coding-diff-prefix">${prefix}</span><span class="coding-diff-content">${escHtml(content) || '&nbsp;'}</span></div>`);
  }
  const truncated = text.split('\n').length > maxLines;
  return `<div class="coding-diff-lines" role="list">${rows.join('')}${truncated ? '<div class="coding-diff-note">Diff truncated for performance.</div>' : ''}</div>`;
}

// Build the optional two-column view from the same escaped unified line nodes.
export function mountDiffControls(host, tab) {
  const bar = host.querySelector('.canvas-diff-toolbar');
  const list = host.querySelector('.coding-diff-lines');
  if (!bar || !list) return;
  let hunk = -1;
  const split = document.createElement('div'); split.className = 'canvas-split-diff';
  const copy = (row, side) => {
    const cell = document.createElement('div'); cell.className = 'split-cell';
    if (row) {cell.classList.add(row.classList.item(1) || 'context');
      for (const s of [`.coding-diff-number--${side}`,'.coding-diff-prefix','.coding-diff-content']) { const n = row.querySelector(s); if(n) cell.append(n.cloneNode(true)); }}
    return cell;
  };
  let before = [], after = [];
  const flush = () => {for (let i=0;i<Math.max(before.length,after.length);i++) split.append(copy(before[i],'old'),copy(after[i],'new')); before=[];after=[];};
  let built = false;
  function build() {
    if (built) return; built = true;
    for (const row of list.children) {
      if (row.classList.contains('coding-diff-line--del')) before.push(row);
      else if (row.classList.contains('coding-diff-line--add')) after.push(row);
      else {flush(); if (row.classList.contains('coding-diff-line')) split.append(copy(row,'old'),copy(row,'new')); else split.append(row.cloneNode(true));}
    } flush(); list.after(split);
  }
  const button = (label,click) => {const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=click;bar.append(b);return b;};
  function layout() { if(tab.splitDiff) build(); host.classList.toggle('prefers-split',!!tab.splitDiff); toggle.setAttribute('aria-pressed',String(!!tab.splitDiff)); }
  const toggle = button('Split',() => {tab.splitDiff=!tab.splitDiff;layout();}); toggle.className='diff-split-toggle';layout();
  if(list.querySelectorAll('.coding-diff-hunk').length > 1) for(const [label,step] of [['Previous change',-1],['Next change',1]]) {const b=button(step<0?'↑':'↓',()=>{const hunks=(split.offsetWidth?split:list).querySelectorAll('.coding-diff-hunk');hunk=(hunk+step+hunks.length)%hunks.length;hunks[hunk]?.scrollIntoView({block:'nearest'});});b.setAttribute('aria-label',label);b.title=label;}
}
