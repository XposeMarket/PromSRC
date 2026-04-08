export type TelegramProcessActor =
  | 'main_chat'
  | 'bg_agent'
  | 'background_task'
  | 'subagent'
  | 'manager';

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function actorLabel(actor: TelegramProcessActor): string {
  switch (actor) {
    case 'main_chat': return '🧠 Main Chat Agent';
    case 'bg_agent': return '🤖 BG Agent';
    case 'subagent': return '🧩 Subagent';
    case 'manager': return '🧭 Manager';
    default: return '🗂️ Background Task';
  }
}

function toolEmoji(toolName: string): string {
  const t = String(toolName || '').toLowerCase();
  if (t === 'declare_plan' || t === 'bg_plan_declare') return '🧭';
  if (t === 'step_complete' || t === 'complete_plan_step' || t === 'bg_plan_advance') return '✅';
  if (t.startsWith('browser_')) return '🌐';
  if (t.startsWith('desktop_')) return '🖥️';
  if (/(create_file|write|find_replace|replace_lines|insert_after|delete_lines|write_source|webui_source|read_file|list_files|file_)/.test(t)) return '📁';
  return '🔧';
}

function humanizeToolName(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return 'unknown_tool';
  return t;
}

function extractPath(args: any): string {
  const obj = (args && typeof args === 'object') ? args : {};
  const candidates = [
    obj.path, obj.filepath, obj.filename, obj.file, obj.target, obj.target_path, obj.src, obj.dest,
  ];
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (v) return v;
  }
  return '';
}

function extractSnippet(toolNameRaw: string, args: any): string {
  const t = String(toolNameRaw || '').toLowerCase();
  const obj = (args && typeof args === 'object') ? args : {};
  const keysByPriority =
    t.includes('find_replace')
      ? ['replace', 'find', 'new_content', 'content', 'text']
      : t.includes('replace_lines')
        ? ['new_content', 'content', 'text']
        : t.includes('insert_after')
          ? ['content', 'text']
          : t.includes('delete_lines')
            ? ['start_line', 'end_line']
            : ['content', 'text', 'value', 'message'];
  for (const k of keysByPriority) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const text = String(v).trim();
    if (!text) continue;
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  }
  return '';
}

function extractDesktopWindow(args: any): string {
  const obj = (args && typeof args === 'object') ? args : {};
  const candidates = [obj.window, obj.window_name, obj.title, obj.app, obj.application, obj.process];
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (v) return v;
  }
  return '';
}

function extractBrowserUrl(args: any, fallbackUrl?: string): string {
  const obj = (args && typeof args === 'object') ? args : {};
  const v = String(obj.url || fallbackUrl || '').trim();
  return v;
}

function normalizePlanSteps(args: any): string[] {
  const steps: string[] = [];
  const raw = (args && typeof args === 'object') ? (args as any).steps : null;
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const v = String(s || '').trim();
      if (v) steps.push(v);
    }
  }
  return steps.slice(0, 8);
}

export function inferActorFromTask(task: {
  managerEnabled?: boolean;
  subagentProfile?: string;
  title?: string;
  sessionId?: string;
}): TelegramProcessActor {
  if (task?.managerEnabled) return 'manager';
  if (String(task?.subagentProfile || '').trim()) return 'subagent';
  if (String(task?.sessionId || '').startsWith('background_')) return 'bg_agent';
  if (/\bmanager\b/i.test(String(task?.title || ''))) return 'manager';
  if (/\bsubagent\b/i.test(String(task?.title || ''))) return 'subagent';
  return 'background_task';
}

export function formatTelegramToolCall(input: {
  actor: TelegramProcessActor;
  toolName: string;
  args?: any;
  browserUrl?: string;
  browserTitle?: string;
  composite?: string;
  stepNum?: number;
  totalSteps?: number;
}): string {
  const { actor, toolName, args, browserUrl, browserTitle, composite, stepNum, totalSteps } = input;
  const tool = humanizeToolName(toolName);
  const t = tool.toLowerCase();

  // Composite step — show as "🧩 Composite: name [step X/N] → tool"
  if (composite) {
    const stepLabel = (stepNum != null && totalSteps != null) ? ` [${stepNum}/${totalSteps}]` : '';
    const lines: string[] = [
      `${actorLabel(actor)}`,
      `🧩 <b>Composite:</b> <code>${escapeHtml(composite)}</code>${stepLabel}`,
      `↳ ${toolEmoji(tool)} <code>${escapeHtml(tool)}</code>`,
    ];
    if (t.startsWith('browser_')) {
      const url = extractBrowserUrl(args, browserUrl);
      if (url) lines.push(`🌍 <b>URL:</b> <code>${escapeHtml(url)}</code>`);
    } else if (t === 'web_search') {
      const q = String((args && (args.query || args.q)) || '').trim();
      if (q) lines.push(`🔍 <b>Query:</b> ${escapeHtml(q.slice(0, 180))}`);
    } else if (t === 'web_fetch') {
      const url = String((args && args.url) || '').trim();
      if (url) lines.push(`🌐 <b>URL:</b> <code>${escapeHtml(url.slice(0, 200))}</code>`);
    }
    return lines.join('\n');
  }

  const lines: string[] = [
    `${actorLabel(actor)}`,
    `${toolEmoji(tool)} <b>Tool:</b> <code>${escapeHtml(tool)}</code>`,
  ];

  if (t === 'declare_plan' || t === 'bg_plan_declare') {
    const steps = normalizePlanSteps(args);
    lines.push('🧭 <b>Plan:</b>');
    if (steps.length === 0) {
      lines.push('⬜ (No plan steps provided)');
    } else {
      steps.forEach((s, i) => lines.push(`⬜ ${i + 1}. ${escapeHtml(s)}`));
    }
    return lines.join('\n');
  }

  if (t === 'step_complete' || t === 'complete_plan_step' || t === 'bg_plan_advance') {
    const note = String((args && (args.note || args.summary || args.result)) || '').trim();
    lines.push('✅ <b>Step Complete</b>');
    if (note) lines.push(`📝 ${escapeHtml(note.slice(0, 260))}`);
    return lines.join('\n');
  }

  if (t.startsWith('browser_')) {
    const url = extractBrowserUrl(args, browserUrl);
    const title = String(browserTitle || '').trim();
    if (url) lines.push(`🌍 <b>URL:</b> <code>${escapeHtml(url)}</code>`);
    if (title) lines.push(`🪟 <b>Window:</b> ${escapeHtml(title)}`);
    const ref = Number((args && (args.ref ?? args.element_ref)) ?? NaN);
    if (Number.isFinite(ref)) lines.push(`🎯 <b>Ref:</b> ${ref}`);
  } else if (t.startsWith('desktop_')) {
    const win = extractDesktopWindow(args);
    if (win) lines.push(`🪟 <b>Window:</b> ${escapeHtml(win)}`);
    const x = Number((args && args.x) ?? NaN);
    const y = Number((args && args.y) ?? NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) lines.push(`📍 <b>Coords:</b> ${Math.round(x)}, ${Math.round(y)}`);
  } else if (t === 'web_search') {
    const q = String((args && (args.query || args.q)) || '').trim();
    if (q) lines.push(`🔍 <b>Query:</b> ${escapeHtml(q.slice(0, 180))}`);
  } else if (t === 'web_fetch') {
    const url = String((args && args.url) || '').trim();
    if (url) lines.push(`🌐 <b>URL:</b> <code>${escapeHtml(url.slice(0, 200))}</code>`);
  } else {
    const path = extractPath(args);
    if (path) lines.push(`📄 <b>Path:</b> <code>${escapeHtml(path)}</code>`);
    const snippet = extractSnippet(t, args);
    if (snippet) lines.push(`✏️ <b>Snippet:</b> <code>${escapeHtml(snippet)}</code>`);
  }

  return lines.join('\n');
}

export function formatTelegramProgressState(input: {
  actor: TelegramProcessActor;
  items?: Array<{ text?: string; status?: string }>;
}): string | null {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length < 2) return null;
  const lines: string[] = [`${actorLabel(input.actor)}`, '🧭 <b>Plan Progress</b>'];
  for (let i = 0; i < items.length; i++) {
    const text = String(items[i]?.text || '').trim();
    if (!text) continue;
    const status = String(items[i]?.status || 'pending').toLowerCase();
    const icon =
      status === 'done' ? '✅' :
      status === 'in_progress' ? '🔄' :
      status === 'failed' ? '❌' :
      status === 'skipped' ? '⏭️' : '⬜';
    lines.push(`${icon} ${i + 1}. ${escapeHtml(text.slice(0, 180))}`);
  }
  return lines.join('\n');
}

export function formatTelegramToolError(input: {
  actor: TelegramProcessActor;
  toolName: string;
  errorText: string;
}): string {
  return [
    `${actorLabel(input.actor)}`,
    `❌ <b>Tool Error:</b> <code>${escapeHtml(input.toolName)}</code>`,
    `<code>${escapeHtml(String(input.errorText || '').slice(0, 320))}</code>`,
  ].join('\n');
}

export function formatTelegramAiTextFromMarkdown(raw: string): string {
  const source = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';
  // If caller already supplied HTML tags, preserve as-is.
  if (/<\/?(b|i|u|code|pre|a|blockquote|strong|em)\b/i.test(source)) return source;

  const codeBlocks: string[] = [];
  let text = source.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_m, body) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(String(body || '').trim())}</pre>`);
    return `@@CODE_BLOCK_${idx}@@`;
  });

  text = escapeHtml(text);
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  text = text.replace(/^[ \t]*[-*]\s+/gm, '• ');
  text = text.replace(/\n{3,}/g, '\n\n');

  text = text.replace(/@@CODE_BLOCK_(\d+)@@/g, (_m, idRaw) => {
    const id = Number(idRaw);
    return Number.isFinite(id) && codeBlocks[id] ? codeBlocks[id] : '';
  });

  return text;
}
