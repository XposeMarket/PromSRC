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

function truncateLabel(raw: any, max = 140): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function pickArg(args: any, keys: string[], max = 140): string {
  const obj = (args && typeof args === 'object') ? args : {};
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 3).join(' | ');
      if (joined) return truncateLabel(joined, max);
      continue;
    }
    const text = truncateLabel(value, max);
    if (text) return text;
  }
  return '';
}

function titleCaseTool(raw: string): string {
  return String(raw || 'tool')
    .replace(/^(browser|desktop|creative|memory|source|webui|web|team|agent|background|bg)_/i, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
    .join(' ') || 'Tool';
}

function argSubject(args: any): string {
  return pickArg(args, [
    'path', 'file', 'filename', 'filepath', 'target_path', 'source_path', 'dest_path', 'directory', 'dir',
    'url', 'query', 'q', 'pattern', 'name', 'id', 'skill_id', 'agent_id', 'team_id', 'model', 'provider',
  ]);
}

function coordLabel(args: any): string {
  const obj = (args && typeof args === 'object') ? args : {};
  const x = Number(obj.x);
  const y = Number(obj.y);
  return Number.isFinite(x) && Number.isFinite(y) ? ` (${Math.round(x)}, ${Math.round(y)})` : '';
}

function quoteTextLabel(args: any): string {
  const text = pickArg(args, ['text', 'value', 'content', 'message'], 90);
  return text ? ` ("${text}")` : '';
}

function formatFriendlyToolAction(toolNameRaw: string, args: any = {}): string {
  const tool = String(toolNameRaw || '').trim();
  const t = tool.toLowerCase();
  const subject = argSubject(args);
  const withSubject = (base: string, label = subject) => label ? `${base}: ${label}` : base;
  const withParens = (base: string, label = subject) => label ? `${base} (${label})` : base;
  const modelProvider = [pickArg(args, ['model']), pickArg(args, ['provider', 'providerId'])].filter(Boolean).join(' / ');

  const exact: Record<string, string> = {
    declare_plan: 'Declaring Plan...',
    complete_plan_step: 'Completing Plan Step...',
    step_complete: 'Completing Step...',
    bg_plan_declare: 'Declaring Background Plan...',
    bg_plan_advance: 'Advancing Background Plan...',
    request_tool_category: withSubject('Requesting Tool Category', pickArg(args, ['category', 'tool_category', 'name', 'id'])),
    business_context_mode: withSubject('Switching Business Context', pickArg(args, ['mode', 'context', 'profile'])),
    switch_model: withParens('Switching Model...', modelProvider),
    write_note: 'Writing Note...',
    memory_search: withSubject('Searching Memory', pickArg(args, ['query', 'q', 'text'])),
    memory_read_record: withSubject('Reading Memory Record', pickArg(args, ['id', 'record_id'])),
    memory_search_project: withSubject('Searching Project Memory', pickArg(args, ['query', 'q'])),
    memory_search_timeline: withSubject('Searching Memory Timeline', pickArg(args, ['query', 'q'])),
    memory_get_related: withSubject('Finding Related Memory', pickArg(args, ['id', 'record_id', 'query'])),
    memory_graph_snapshot: 'Snapshotting Memory Graph...',
    web_search: withSubject('Searching the Web', pickArg(args, ['query', 'q'])),
    web_fetch: withSubject('Fetching URL', pickArg(args, ['url'])),
    run_command: withParens('Running Command', pickArg(args, ['command'], 180)),
    shell: withParens('Running Shell Command', pickArg(args, ['command'], 180)),
    skill_list: 'Searching Skills...',
    skill_read: withSubject('Reading Skill', pickArg(args, ['id', 'skill_id', 'name'])),
    skill_create: withSubject('Creating Skill', pickArg(args, ['name', 'id'])),
    grep_file: withSubject('Grep File', [pickArg(args, ['path', 'file']), pickArg(args, ['pattern', 'query'])].filter(Boolean).join(' | ')),
    grep_files: withSubject('Grep Files', [pickArg(args, ['path', 'directory', 'dir']), pickArg(args, ['pattern', 'query'])].filter(Boolean).join(' | ')),
    search_files: withParens('Searching Files...', pickArg(args, ['pattern', 'query', 'q'])),
    list_directory: withSubject('Listing Available Directories', pickArg(args, ['path', 'directory', 'dir']) || '.'),
    list_files: withSubject('Listing Files', pickArg(args, ['path', 'directory', 'dir']) || '.'),
    read_file: withSubject('Reading File'),
    file_stats: withSubject('Checking File Stats'),
    apply_patch: 'Applying Patch...',
    replace_lines: withParens('Replacing Lines', [pickArg(args, ['path', 'file']), pickArg(args, ['start_line', 'start']), pickArg(args, ['end_line', 'end'])].filter(Boolean).join(' | ')),
    insert_after: withParens('Inserting After Line', [pickArg(args, ['path', 'file']), pickArg(args, ['line', 'after_line'])].filter(Boolean).join(' | ')),
    delete_lines: withParens('Deleting Lines', [pickArg(args, ['path', 'file']), pickArg(args, ['start_line', 'start']), pickArg(args, ['end_line', 'end'])].filter(Boolean).join(' | ')),
    find_replace: withParens('Replacing Text', pickArg(args, ['path', 'file'])),
    background_spawn: withParens('Spawning Background Agent', pickArg(args, ['task', 'prompt', 'message'], 180)),
    background_status: withSubject('Checking Background Agent', pickArg(args, ['background_id', 'id'])),
    background_progress: withSubject('Checking Background Agent Progress', pickArg(args, ['background_id', 'id'])),
    background_wait: withSubject('Waiting for Background Agent', pickArg(args, ['background_id', 'id', 'wait_ms', 'timeout_ms'])),
    background_join: withSubject('Joining Background Agent', pickArg(args, ['background_id', 'id'])),
    ask_team_coordinator: 'Talking to Team Coordinator...',
    dispatch_team_agent: withParens('Dispatching Team Agent', pickArg(args, ['task', 'prompt', 'message'], 180)),
    request_team_member_turn: withParens('Requesting Team Member Turn', pickArg(args, ['task', 'prompt', 'message'], 180)),
    dispatch_to_agent: withParens('Dispatching Agent', pickArg(args, ['task', 'prompt', 'message'], 180)),
    get_agent_result: withSubject('Getting Agent Result', pickArg(args, ['task_id', 'id'])),
    post_to_team_chat: withParens('Posting to Team Chat', pickArg(args, ['message', 'content'], 160)),
    message_main_agent: withParens('Messaging Main Agent', pickArg(args, ['message', 'content'], 160)),
    reply_to_team: withParens('Replying to Team', pickArg(args, ['message', 'content'], 160)),
    talk_to_subagent: withParens('Talking to Subagent', pickArg(args, ['message', 'content', 'task'], 160)),
    message_subagent: withParens('Messaging Subagent', pickArg(args, ['message', 'content', 'task'], 160)),
    talk_to_manager: withParens('Talking to Manager', pickArg(args, ['message', 'content'], 160)),
    talk_to_teammate: withParens('Talking to Teammate', pickArg(args, ['message', 'content'], 160)),
    manage_team_goal: withSubject('Managing Team Goal', pickArg(args, ['action', 'goal', 'team_id'])),
    team_manage: withSubject('Managing Team', pickArg(args, ['action', 'team_id', 'name'])),
    present_file: withSubject('Presenting File'),
    generate_image: withParens('Generating Image', pickArg(args, ['prompt'], 180)),
    download_url: withSubject('Downloading URL', pickArg(args, ['url'])),
    download_media: withSubject('Downloading Media', pickArg(args, ['url'])),
    analyze_image: withSubject('Analyzing Image'),
    analyze_video: withSubject('Analyzing Video'),
    upload_image: withSubject('Uploading Image'),
    fetch_image: withSubject('Fetching Image', pickArg(args, ['url', 'path'])),
    view_connections: 'Viewing Connections...',
    gateway_restart: 'Restarting Gateway...',
    time_now: 'Checking Time...',
    task_control: withSubject('Managing Task', pickArg(args, ['action', 'task_id', 'id'])),
  };
  if (exact[t]) return exact[t];

  if (t.startsWith('browser_')) {
    const name = t.slice('browser_'.length);
    if (name === 'open') return withSubject('Opening Browser - URL', pickArg(args, ['url']));
    if (name === 'click') return `Clicking...${coordLabel(args)}`;
    if (name === 'press_key') return withSubject('Pressed', pickArg(args, ['key', 'keys']));
    if (name === 'type' || name === 'type_raw' || name === 'fill') return `Typing...${quoteTextLabel(args)}`;
    if (name === 'snapshot') return 'Snapshotting Browser...';
    if (name === 'scroll') return `Scrolling Browser...${coordLabel(args)}`;
    if (name === 'wait') return withParens('Waiting in Browser', pickArg(args, ['ms', 'milliseconds', 'seconds']));
    if (name === 'run_js') return 'Running Browser JavaScript...';
    return withParens(`${titleCaseTool(tool)} Browser`, subject);
  }

  if (t.startsWith('desktop_')) {
    const name = t.slice('desktop_'.length);
    if (name === 'find_window') return withParens('Finding Desktop Window...', pickArg(args, ['name', 'title', 'window', 'query']));
    if (name === 'focus_window') return withParens('Focusing Desktop Window...', pickArg(args, ['name', 'title', 'window']));
    if (name === 'screenshot' || name === 'window_screenshot') return 'Screenshotting Desktop...';
    if (name === 'click') return `Clicking...${coordLabel(args)}`;
    if (name === 'press_key') return withSubject('Pressed', pickArg(args, ['key', 'keys']));
    if (name === 'type' || name === 'type_raw') return `Typing...${quoteTextLabel(args)}`;
    if (name === 'scroll') return `Scrolling Desktop...${coordLabel(args)}`;
    if (name === 'drag') return 'Dragging Desktop Pointer...';
    if (name === 'launch_app') return withSubject('Launching App', pickArg(args, ['app', 'name', 'query']));
    if (name === 'close_app') return withSubject('Closing App', pickArg(args, ['app', 'name', 'title']));
    return withParens(`${titleCaseTool(tool)} Desktop`, subject);
  }

  if (t.startsWith('creative_') || t.startsWith('image_') || t.startsWith('video_')) {
    const family = t.startsWith('video_') ? 'Video' : t.startsWith('image_') ? 'Image' : 'Creative';
    return withParens(`${titleCaseTool(tool)} ${family}`, subject);
  }

  if (t.includes('source') || t.startsWith('src_') || t.startsWith('prom_')) {
    if (t.includes('grep')) return withSubject('Grep Source', [pickArg(args, ['path', 'file']), pickArg(args, ['pattern', 'query'])].filter(Boolean).join(' | '));
    if (t.includes('list')) return withSubject('Listing Source', pickArg(args, ['path', 'directory', 'dir']) || '.');
    if (t.includes('stats')) return withSubject('Checking Source Stats');
    if (t.includes('write')) return withSubject('Writing Source');
    return withSubject('Reading Source');
  }

  if (t.startsWith('memory_')) return withSubject(`${titleCaseTool(tool)} Memory`, subject);
  if (t.startsWith('agent_')) return withSubject(`${titleCaseTool(tool)} Agent`, subject);
  if (t.startsWith('vercel_')) return withSubject(`${titleCaseTool(tool)} Vercel`, subject);
  if (t.startsWith('mcp_')) return withSubject(`${titleCaseTool(tool)} MCP`, subject);
  if (t.startsWith('webhook_')) return withSubject(`${titleCaseTool(tool)} Webhook`, subject);
  if (t.startsWith('schedule_') || t === 'timer') return withSubject(`${titleCaseTool(tool)} Schedule`, subject);
  return withParens(titleCaseTool(tool), subject);
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

function isCodeSnippetTool(toolNameRaw: string): boolean {
  const t = String(toolNameRaw || '').toLowerCase();
  return /(^|_)(read|write|edit|create|replace|insert|append|patch|source)($|_)|find_replace|replace_lines|insert_after|delete_lines|read_file|write_file|create_file|apply_patch|webui_source|write_source/.test(t);
}

const TELEGRAM_CODE_ARG_PREVIEW_CHARS = 50;
const TELEGRAM_CODE_RESULT_PREVIEW_CHARS = 260;

function isSkillListResult(toolNameRaw: string): boolean {
  return String(toolNameRaw || '').toLowerCase() === 'skill_list';
}

function isSkillReadResult(toolNameRaw: string): boolean {
  return String(toolNameRaw || '').toLowerCase() === 'skill_read';
}

function compactSkillReadTitle(rawResult: string): string {
  const firstLine = String(rawResult || '').replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).find(Boolean);
  return firstLine || 'Skill loaded.';
}

function compactSkillListSummary(rawResult: string): string {
  const text = String(rawResult || '').trim();
  const countMatch = text.match(/\b(\d+)\s+skills?\s+available\b/i);
  if (countMatch) {
    const count = Number(countMatch[1]);
    return `Showing ${Number.isFinite(count) ? count : countMatch[1]} available skill${count === 1 ? '' : 's'}.`;
  }
  if (/no skills installed/i.test(text)) return 'No skills installed yet.';
  return 'Available skills loaded.';
}

function extractSnippet(toolNameRaw: string, args: any): string {
  const t = String(toolNameRaw || '').toLowerCase();
  const obj = (args && typeof args === 'object') ? args : {};
	  const keysByPriority =
	    t === 'run_command'
	      ? ['command']
	      : t.includes('grep') || t.includes('search')
	        ? ['pattern', 'query', 'q', 'file_glob', 'glob']
	        : t.includes('list_')
	          ? ['path', 'directory', 'dir']
	          : t === 'skill_read'
	            ? ['id', 'skill_id', 'name']
	            : t.includes('find_replace')
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
    const max = isCodeSnippetTool(t) ? TELEGRAM_CODE_ARG_PREVIEW_CHARS : 220;
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }
	  return '';
	}

function shouldShowToolResult(toolNameRaw: string, error: boolean, forceShow: boolean = false): boolean {
  if (forceShow) return true;
  if (error) return true;
  const t = String(toolNameRaw || '').toLowerCase();
  return t === 'run_command'
    || t === 'skill_read'
    || t.startsWith('grep_')
    || t.includes('_grep')
    || t.startsWith('list_')
    || t.includes('_list')
    || t.startsWith('search_')
    || t.includes('_search');
}

function extractCommandOutput(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const stdoutMatch = text.match(/stdout:\s*([\s\S]*?)(?:\n\s*stderr:|\n\s*exit\s+code:|$)/i);
  const stderrMatch = text.match(/stderr:\s*([\s\S]*?)(?:\n\s*exit\s+code:|$)/i);
  const stdout = String(stdoutMatch?.[1] || '').trim();
  const stderr = String(stderrMatch?.[1] || '').trim();
  return stdout || stderr || text;
}

function compactResultPreview(toolNameRaw: string, rawResult: string, maxChars = 1400): string {
  const t = String(toolNameRaw || '').toLowerCase();
  if (isSkillListResult(t)) return compactSkillListSummary(rawResult);
  if (isSkillReadResult(t)) return compactSkillReadTitle(rawResult);
  const effectiveMax = isCodeSnippetTool(t) ? Math.min(maxChars, TELEGRAM_CODE_RESULT_PREVIEW_CHARS) : maxChars;
  const source = t === 'run_command' ? extractCommandOutput(rawResult) : String(rawResult || '').trim();
  if (!source) return '';
  const compact = source
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return compact.length > effectiveMax ? `${compact.slice(0, effectiveMax)}...` : compact;
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
  const friendlyAction = formatFriendlyToolAction(tool, args);
  const lines: string[] = [`${actorLabel(actor)}`];

  if (composite) {
    const stepLabel = (stepNum != null && totalSteps != null) ? ` [${stepNum}/${totalSteps}]` : '';
    lines.push(`Composite: <code>${escapeHtml(composite)}</code>${stepLabel}`);
    lines.push(`${toolEmoji(tool)} <b>Action:</b> ${escapeHtml(friendlyAction)}`);
  } else {
    lines.push(`${toolEmoji(tool)} <b>Action:</b> ${escapeHtml(friendlyAction)}`);
  }

  if (t === 'declare_plan' || t === 'bg_plan_declare') {
    const steps = normalizePlanSteps(args);
    lines.push('<b>Plan:</b>');
    if (steps.length === 0) lines.push('(No plan steps provided)');
    else steps.forEach((s, i) => lines.push(`${i + 1}. ${escapeHtml(s)}`));
    return lines.join('\n');
  }

  if (t === 'step_complete' || t === 'complete_plan_step' || t === 'bg_plan_advance') {
    const note = String((args && (args.note || args.summary || args.result)) || '').trim();
    lines.push('<b>Step Complete</b>');
    if (note) lines.push(escapeHtml(note.slice(0, 260)));
    return lines.join('\n');
  }

  if (t.startsWith('browser_')) {
    const url = extractBrowserUrl(args, browserUrl);
    const title = String(browserTitle || '').trim();
    if (url) lines.push(`URL: <code>${escapeHtml(url)}</code>`);
    if (title) lines.push(`Window: ${escapeHtml(title)}`);
    const ref = Number((args && (args.ref ?? args.element_ref)) ?? NaN);
    if (Number.isFinite(ref)) lines.push(`Ref: ${ref}`);
  } else if (t.startsWith('desktop_')) {
    const win = extractDesktopWindow(args);
    if (win) lines.push(`Window: ${escapeHtml(win)}`);
    const x = Number((args && args.x) ?? NaN);
    const y = Number((args && args.y) ?? NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) lines.push(`Coords: ${Math.round(x)}, ${Math.round(y)}`);
  } else if (t === 'web_search') {
    const q = String((args && (args.query || args.q)) || '').trim();
    if (q) lines.push(`Query: ${escapeHtml(q.slice(0, 180))}`);
  } else if (t === 'web_fetch') {
    const url = String((args && args.url) || '').trim();
    if (url) lines.push(`URL: <code>${escapeHtml(url.slice(0, 200))}</code>`);
  } else if (t === 'run_command') {
    const command = String((args && args.command) || '').trim();
    if (command) lines.push(`Command: <code>${escapeHtml(command.slice(0, 260))}</code>`);
  } else if (t === 'skill_read') {
    const id = String((args && (args.id || args.skill_id || args.name)) || '').trim();
    if (id) lines.push(`Skill: <code>${escapeHtml(id.slice(0, 180))}</code>`);
  } else if (t.startsWith('grep_') || t.includes('_grep') || t.startsWith('search_') || t.includes('_search')) {
    const pattern = String((args && (args.pattern || args.query || args.q)) || '').trim();
    if (pattern) lines.push(`Searched: <code>${escapeHtml(pattern.slice(0, 220))}</code>`);
    const path = extractPath(args);
    if (path) lines.push(`Path: <code>${escapeHtml(path)}</code>`);
  } else if (t.startsWith('list_') || t.includes('_list')) {
    const path = extractPath(args);
    lines.push(`Listed: <code>${escapeHtml(path || '.')}</code>`);
  } else {
    const path = extractPath(args);
    if (path) lines.push(`Path: <code>${escapeHtml(path)}</code>`);
    const snippet = extractSnippet(t, args);
    if (snippet) lines.push(`Snippet: <code>${escapeHtml(snippet)}</code>`);
  }

  return lines.join('\n');
}
export function formatTelegramToolResult(input: {
  actor: TelegramProcessActor;
  toolName: string;
  args?: any;
  result?: string;
  error?: boolean;
  forceShow?: boolean;
}): string | null {
  if (!shouldShowToolResult(input.toolName, input.error === true, input.forceShow === true)) return null;
  const preview = compactResultPreview(input.toolName, String(input.result || ''));
  if (!preview) return null;
  const t = String(input.toolName || '').toLowerCase();
  const actionLabel = formatFriendlyToolAction(input.toolName, input.args || {}).replace(/\.\.\.$/, '');
  const label = input.error ? `${actionLabel} Failed` : t === 'run_command' ? 'Command Output' : `${actionLabel} Complete`;
  return [
    `${actorLabel(input.actor)}`,
    `${input.error ? 'Error' : 'Result'} <b>${escapeHtml(label)}:</b>`,
    `<pre>${escapeHtml(preview)}</pre>`,
  ].join('\n');
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
  const actionLabel = formatFriendlyToolAction(input.toolName, {}).replace(/\.\.\.$/, '');
  return [
    `${actorLabel(input.actor)}`,
    `❌ <b>${escapeHtml(actionLabel)} Failed</b>`,
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
