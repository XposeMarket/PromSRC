// Both Tasks surfaces use their existing sanitized Markdown renderer.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prose = 'font-size:13px;line-height:1.6;overflow-wrap:anywhere;min-width:0';
function detail(value, renderMarkdown) {
  const text = String(value || '');
  if (!text) return '';
  try { return `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">${escape(JSON.stringify(JSON.parse(text), null, 2))}</pre>`; }
  catch { return `<div class="markdown-body" style="${prose}">${renderMarkdown(text)}</div>`; }
}
export function renderTaskTool(row, renderMarkdown, time = '', identity = '') {
  const key = `${identity}:${row.t || 0}:${row.name || 'tool'}`;
  return `<details class="task-tool-disclosure" data-task-tool="${escape(key)}" style="padding:8px 0;border-bottom:1px solid var(--line,rgba(128,128,128,.15));min-width:0">
    <summary style="cursor:pointer;min-height:28px;line-height:28px;font-size:13px;overflow-wrap:anywhere"><span>${escape(row.name || 'tool')}</span>${row.error ? ' <small>Failed</small>' : row.pending ? ' <small>running…</small>' : ''}${time ? ` <span style="opacity:.6;font-size:11px">${time}</span>` : ''}</summary>
    <div style="padding:8px 0 4px 14px;min-width:0">${row.call ? `<div style="opacity:.6;font-size:11px">Arguments</div>${detail(row.call, renderMarkdown)}` : ''}${row.result ? `<div style="opacity:.6;font-size:11px">Result</div>${detail(row.result, renderMarkdown)}` : `<div style="opacity:.6;font-size:12px">${row.pending ? 'Waiting for result…' : 'No result recorded in this activity snapshot.'}</div>`}</div>
  </details>`;
}
export function renderTaskEvidence(entries, renderMarkdown, formatTime = () => '') {
  if (!entries?.length) return '<div style="font-size:13px;opacity:.65">No notes or evidence recorded for this run yet.</div>';
  return `<div class="task-evidence-prose">${entries.slice().reverse().map(entry => {
    const text = entry.content ?? entry.value ?? entry.summary ?? entry.text ?? '';
    return `<section style="padding:10px 0;min-width:0;border-bottom:1px solid var(--line,rgba(128,128,128,.15))"><div style="font-size:11px;opacity:.6;margin-bottom:6px">${escape(entry.title || entry.category || entry.type || 'Evidence')}${entry.t || entry.timestamp ? ` · ${escape(formatTime(entry.t || entry.timestamp))}` : ''}</div><div class="markdown-body pm-task-markdown" style="${prose}">${renderMarkdown(String(text))}</div></section>`;
  }).join('')}</div>`;
}
/** Preserve native disclosure state when a polling refresh replaces the task body. */
export function rememberTaskTools(root) {
  const open = new Set(Array.from(root?.querySelectorAll('details[data-task-tool][open]') || [], el => el.dataset.taskTool));
  return () => { root?.querySelectorAll('details[data-task-tool]').forEach(el => { el.open = open.has(el.dataset.taskTool); }); };
}
