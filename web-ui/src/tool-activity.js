/**
 * Shared presentation + lifecycle helpers for user-facing tool activity.
 *
 * Provider model events, normalized gateway calls, progress updates, and final
 * results are intentionally folded into two visible records:
 *   1. one operation row that evolves from preparing -> running
 *   2. one result row
 *
 * The stream stays compact; raw protocol details remain available to logs and
 * telemetry instead of adding a second technical panel to every row.
 */

function compact(value, max = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstValue(obj, keys, max = 120) {
  const source = obj && typeof obj === 'object' ? obj : {};
  for (const key of keys) {
    const value = source[key];
    if (value == null || typeof value === 'object') continue;
    const text = compact(value, max);
    if (text) return text;
  }
  return '';
}

function pathLabel(value) {
  const raw = compact(value, 180);
  if (!raw) return '';
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return compact(parts[parts.length - 1] || raw, 72);
}

function quote(value, max = 72) {
  const text = compact(value, max);
  return text ? `“${text}”` : '';
}

function parseArgs(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function durationLabel(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

const COMMAND_TERMINAL_MAX_CHARS = 64 * 1024;
const TERMINAL_COMMAND_ACTIONS = new Set([
  'workspace_run',
  'run_command',
  'terminal',
  'shell',
  'shell_command',
  'terminal_run',
  'start_process',
]);

function disclosureState() {
  if (typeof window === 'undefined') return null;
  if (!(window.__toolActivityDisclosureState instanceof Map)) window.__toolActivityDisclosureState = new Map();
  return window.__toolActivityDisclosureState;
}

export function setToolActivityDisclosureState(key, open) {
  const state = disclosureState();
  if (state && key) {
    const normalized = String(key);
    state.delete(normalized);
    state.set(normalized, open === true);
    while (state.size > 500) state.delete(state.keys().next().value);
  }
}

export function installToolActivityExpansionPersistence(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof window === 'undefined' || window.__toolActivityExpansionPersistenceInstalled) return;
  window.__toolActivityExpansionPersistenceInstalled = true;
  root.addEventListener('toggle', (event) => {
    const details = event.target;
    const key = details?.dataset?.toolDisclosureKey;
    if (key) setToolActivityDisclosureState(key, details.open === true);
  }, true);
}

function cleanTerminalText(value) {
  return String(value ?? '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[^\t\n\u0020-\u007e\u00a0-\uffff]/g, '');
}

function boundTerminalText(value) {
  const text = cleanTerminalText(value);
  if (text.length <= COMMAND_TERMINAL_MAX_CHARS) return text;
  return text.slice(-COMMAND_TERMINAL_MAX_CHARS);
}

function resultFirstLine(value, max = 140) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const first = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || raw;
  return compact(first.replace(/^ERROR:\s*/i, ''), max);
}

function resultCount(value, keys) {
  const raw = String(value ?? '').trim();
  if (!raw || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    for (const key of keys) {
      const count = Number(parsed?.[key]);
      if (Number.isFinite(count) && count >= 0) return count;
    }
  } catch {}
  return null;
}

function textLineCount(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return 0;
  const lines = text.split('\n');
  return Math.max(0, lines.length - (lines[lines.length - 1] === '' ? 1 : 0));
}

function lineRangeCount(startRaw, endRaw) {
  const start = Math.floor(Number(startRaw));
  if (!Number.isFinite(start) || start < 1) return null;
  const endValue = endRaw == null || endRaw === '' ? start : Math.floor(Number(endRaw));
  if (!Number.isFinite(endValue) || endValue < start) return null;
  return endValue - start + 1;
}

function resultLineRangeCount(value, verb) {
  const raw = String(value ?? '');
  const match = raw.match(new RegExp(`${verb}\\s+lines?\\s+(\\d+)(?:-(\\d+))?`, 'i'));
  if (!match) return null;
  return lineRangeCount(match[1], match[2] || match[1]);
}

function stringArg(args, keys) {
  const source = args && typeof args === 'object' ? args : {};
  for (const key of keys) {
    if (typeof source[key] === 'string') return source[key];
  }
  return null;
}

function textLineDelta(beforeRaw, afterRaw) {
  const normalizeLines = (value) => {
    const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!text) return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const before = normalizeLines(beforeRaw);
  const after = normalizeLines(afterRaw);
  if (before.length * after.length > 2_000_000) return null;

  // A line-level LCS gives the smallest honest add/remove counts. In
  // particular, two replacements on one physical line are +1/-1, while the
  // same replacements on two lines are +2/-2.
  let previous = new Uint32Array(after.length + 1);
  for (const beforeLine of before) {
    const current = new Uint32Array(after.length + 1);
    for (let index = 1; index <= after.length; index += 1) {
      current[index] = beforeLine === after[index - 1]
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  const unchanged = previous[after.length];
  return { added: after.length - unchanged, removed: before.length - unchanged };
}

function textPair(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidates = [parsed, parsed.data, parsed.diff, parsed.change].filter((item) => item && typeof item === 'object');
  for (const candidate of candidates) {
    const before = stringArg(candidate, ['before', 'beforeText', 'before_text', 'oldText', 'old_text', 'old_content', 'oldContent']);
    const after = stringArg(candidate, ['after', 'afterText', 'after_text', 'newText', 'new_text', 'new_content', 'newContent', 'updatedText', 'updated_text']);
    if (before !== null && after !== null) return { before, after };
  }
  return null;
}

function replacementOccurrenceCount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/(?:^|[\s(])([0-9]+)\s+occurrences?\b/i);
  if (match) return Number(match[1]);
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      for (const source of [parsed, parsed?.data]) {
        for (const key of ['replacements', 'replacement_count', 'occurrences']) {
          const count = Number(source?.[key]);
          if (Number.isFinite(count) && count >= 0) return count;
        }
      }
    } catch {}
  }
  return null;
}

function patchLineDelta(value) {
  const raw = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return null;
  let added = 0;
  let removed = 0;
  let sawHunk = false;
  let inHunk = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      sawHunk = true;
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('\\ No newline')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return sawHunk ? { added, removed } : null;
}

function editOperationName(actionRaw, args = {}) {
  let action = normalizeAction(actionRaw);
  if (action === 'workspace_edit' || action === 'dev_source_edit') {
    action = normalizeAction(args.action || args.operation || args.mode || args.op);
  }
  if (action === 'patchset' || action === 'apply_workspace_patchset' || action === 'apply_dev_source_patchset') return 'patchset';
  if (action === 'apply_patch' || action === 'patch_file') return 'apply_patch';
  if (action === 'create' || /create_file/.test(action)) return 'create';
  if (/replace_lines/.test(action)) return 'replace_lines';
  if (/insert_after/.test(action)) return 'insert_after';
  if (/delete_lines/.test(action)) return 'delete_lines';
  if (/find_replace/.test(action) || action === 'edit_file') return 'find_replace';
  if (action === 'write' || /^write(?:_|$)/.test(action)) return 'write';
  return action;
}

function editOperationDelta(actionRaw, argsRaw = {}, resultRaw = '') {
  const args = parseArgs(argsRaw);
  const operation = editOperationName(actionRaw, args);
  if (operation === 'apply_patch') return patchLineDelta(args.patch);
  if (operation === 'create') {
    const content = stringArg(args, ['content', 'new_content', 'newContent']);
    return content == null ? null : { added: textLineCount(content), removed: 0 };
  }
  if (operation === 'insert_after') {
    const content = stringArg(args, ['content', 'new_content', 'newContent']);
    return content == null ? null : { added: textLineCount(content), removed: 0 };
  }
  if (operation === 'delete_lines') {
    const removed = resultLineRangeCount(resultRaw, 'deleted')
      ?? lineRangeCount(args.start_line ?? args.startLine, args.end_line ?? args.endLine);
    return removed == null ? null : { added: 0, removed };
  }
  if (operation === 'replace_lines') {
    const content = stringArg(args, ['new_content', 'newContent', 'content']);
    const removed = resultLineRangeCount(resultRaw, 'replaced')
      ?? lineRangeCount(args.start_line ?? args.startLine, args.end_line ?? args.endLine);
    return content == null || removed == null ? null : { added: textLineCount(content), removed };
  }
  if (operation === 'find_replace') {
    const oldText = stringArg(args, ['find', 'old_str', 'old_text', 'oldText']);
    const newText = stringArg(args, ['replace', 'new_str', 'new_text', 'newText']);
    if (oldText == null || !oldText || newText == null) return null;
    const replaceAll = args.replace_all === true || args.replaceAll === true;
    const occurrences = replaceAll ? replacementOccurrenceCount(resultRaw) : 1;
    if (!Number.isFinite(occurrences) || occurrences < 1) return null;
    const beforeAfter = textPair(args) || textPair(resultRaw);
    if (beforeAfter) return textLineDelta(beforeAfter.before, beforeAfter.after);
    if (replaceAll && occurrences > 1) return null;
    return {
      added: textLineCount(newText) * occurrences,
      removed: textLineCount(oldText) * occurrences,
    };
  }
  if (operation === 'patchset') {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!edits.length) return null;
    let added = 0;
    let removed = 0;
    for (const rawEdit of edits) {
      const edit = rawEdit && typeof rawEdit === 'object' ? rawEdit : {};
      const delta = editOperationDelta(edit.op || edit.action || edit.type, edit, '');
      if (!delta) return null;
      added += delta.added;
      removed += delta.removed;
    }
    return { added, removed };
  }
  // Full-file overwrites and deletes do not carry enough before-state in the
  // activity payload to calculate an honest diff. Omit stats instead of lying.
  return null;
}

export function toolActivityEditStats(activity = {}) {
  if (activity.kind !== 'result' || activity.ok === false) return null;
  const delta = editOperationDelta(activity.action, activity.args, activity.result);
  if (!delta) return null;
  return {
    added: Math.max(0, Math.floor(Number(delta.added) || 0)),
    removed: Math.max(0, Math.floor(Number(delta.removed) || 0)),
  };
}

function normalizeAction(value) {
  return String(value || '').trim().toLowerCase();
}

function actionFromPayload(payload = {}) {
  return normalizeAction(payload.action || payload.toolName || payload.name || payload.activity?.action);
}

function callIdFromPayload(payload = {}, { allowGenericId = true } = {}) {
  return compact(
    payload.callId
      || payload.call_id
      || payload.toolCallId
      || payload.tool_call_id
      || (allowGenericId ? payload.id : ''),
    180,
  );
}

function actionArgs(payload = {}) {
  return parseArgs(payload.args || payload.params || payload.input || payload.arguments || payload.activity?.args);
}

function targetFromArgs(args = {}) {
  const path = firstValue(args, ['file', 'filename', 'path', 'source', 'target', 'to_path', 'from_path', 'workspacePath']);
  if (path) return pathLabel(path);
  return firstValue(args, ['title', 'window', 'windowTitle', 'app', 'url', 'href', 'query', 'q', 'pattern', 'text', 'label', 'selector', 'ref', 'name', 'id'], 90);
}

function describeTool(actionRaw, argsRaw = {}) {
  const action = normalizeAction(actionRaw);
  const args = parseArgs(argsRaw);
  const subAction = normalizeAction(args.action || args.operation || args.mode);
  const target = targetFromArgs(args);
  const fileTarget = pathLabel(firstValue(args, ['file', 'filename', 'path', 'source', 'target', 'to_path', 'from_path', 'workspacePath'], 180));
  const command = firstValue(args, ['command', 'cmd', 'script'], 150);
  const search = firstValue(args, ['pattern', 'query', 'q', 'search'], 90);
  const url = firstValue(args, ['url', 'href', 'targetUrl'], 100);
  const textTarget = firstValue(args, ['label', 'text', 'selector', 'ref', 'ariaLabel'], 72);
  const windowTarget = firstValue(args, ['window', 'windowTitle', 'title', 'app', 'name'], 72);
  const coords = Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
    ? `${Math.round(Number(args.x))}, ${Math.round(Number(args.y))}`
    : '';
  const make = (key, noun, preparing, running, success, options = {}) => ({
    key,
    noun,
    preparing,
    running,
    success,
    target: compact(options.target ?? target, 100),
    family: options.family || 'tool',
    countNoun: options.countNoun || noun.toLowerCase(),
  });

  if (action === 'context_compaction') return make('context.compact', 'context compaction', 'Preparing context compaction…', 'Compacting context', 'Compacted context', { family: 'system', target: '' });
  if (action === 'declare_plan') return make('plan.declare', 'plan', 'Preparing plan…', 'Creating plan', 'Created plan', { family: 'plan', target: '' });
  if (['complete_plan_step', 'step_complete', 'bg_plan_advance'].includes(action)) return make('plan.step', 'plan step', 'Preparing plan update…', 'Updating plan', 'Updated plan', { family: 'plan', target: '' });
  if (action === 'write_note') return make('note.write', 'note', 'Preparing note…', 'Writing note', 'Saved note', { family: 'memory', target: firstValue(args, ['tag', 'title'], 72) });
  if (action === 'skill_list') return make('skill.search', 'skill search', 'Preparing skill search…', 'Searching skills', 'Searched skills', { family: 'skill', target: search });
  if (/^(?:voice_)?skill_(?:read|resource_read)$/.test(action)) return make('skill.read', 'skill', 'Preparing skill…', 'Reading skill', 'Loaded skill', { family: 'skill', target: firstValue(args, ['id', 'skill_id', 'name', 'path', 'resource_path'], 90) });
  if (action === 'skill_resource_list') return make('skill.list', 'skill resources', 'Preparing skill resources…', 'Listing skill resources', 'Listed skill resources', { family: 'skill' });

  if (action === 'workspace_read' || action === 'dev_source_read' || action === 'source_read') {
    const isSearch = /search|grep|find/.test(subAction);
    const isList = /list|tree/.test(subAction);
    const isStats = /stats|stat/.test(subAction);
    if (isSearch) return make('file.search', 'source search', 'Preparing source search…', search ? `Searching source for ${quote(search)}` : 'Searching source', 'Searched source', { family: 'file', target: search || fileTarget, countNoun: 'source search' });
    if (isList) return make('file.list', 'file listing', 'Preparing file listing…', fileTarget ? `Listing files in ${fileTarget}` : 'Listing files', 'Listed files', { family: 'file', target: fileTarget, countNoun: 'file listing' });
    if (isStats) return make('file.stats', 'file check', 'Preparing file check…', fileTarget ? `Checking ${fileTarget}` : 'Checking file', 'Checked file', { family: 'file', target: fileTarget, countNoun: 'file check' });
    return make('file.read', 'file read', 'Preparing file read…', fileTarget ? `Reading ${fileTarget}` : 'Reading file', fileTarget ? `Read ${fileTarget}` : 'Read file', { family: 'file', target: fileTarget, countNoun: 'file read' });
  }
  if (['read_file', 'file_read'].includes(action)) return make('file.read', 'file read', 'Preparing file read…', fileTarget ? `Reading ${fileTarget}` : 'Reading file', fileTarget ? `Read ${fileTarget}` : 'Read file', { family: 'file', target: fileTarget, countNoun: 'file read' });
  if (/^(?:grep_file|grep_files|search_files|find_files)$/.test(action)) return make('file.search', 'file search', 'Preparing file search…', search ? `Searching files for ${quote(search)}` : 'Searching files', 'Searched files', { family: 'file', target: search || fileTarget, countNoun: 'file search' });
  if (/^(?:list_directory|list_files)$/.test(action)) return make('file.list', 'file listing', 'Preparing file listing…', fileTarget ? `Listing ${fileTarget}` : 'Listing files', 'Listed files', { family: 'file', target: fileTarget, countNoun: 'file listing' });
  if (action === 'workspace_edit' || action === 'dev_source_edit' || /^(?:apply_patch|apply_workspace_patchset|apply_dev_source_patchset|replace_lines|insert_after|delete_lines|find_replace|write_file|edit_file|create_file|patch_file|replace_file|delete_file)$/.test(action)) {
    const targetText = fileTarget ? `Editing ${fileTarget}` : 'Editing files';
    return make('file.edit', 'file edit', 'Preparing file edit…', targetText, fileTarget ? `Updated ${fileTarget}` : 'Updated files', { family: 'file', target: fileTarget, countNoun: 'file edit' });
  }

  if (TERMINAL_COMMAND_ACTIONS.has(action)) {
    return make('command.run', 'command', 'Preparing command…', command ? `Running command · ${compact(command, 110)}` : 'Running command', command ? `Ran command · ${compact(command, 110)}` : 'Ran command', { family: 'command', target: command, countNoun: 'command' });
  }

  if (action.startsWith('desktop_')) {
    const name = action.slice('desktop_'.length);
    if (name.includes('click')) return make('desktop.click', 'desktop click', 'Preparing desktop click…', `Clicking desktop${windowTarget ? ` · ${windowTarget}` : ''}${coords ? ` · (${coords})` : ''}`, 'Clicked desktop', { family: 'desktop', target: windowTarget || coords, countNoun: 'desktop click' });
    if (name.includes('screenshot') || name === 'screen') return make('desktop.screenshot', 'desktop capture', 'Preparing desktop capture…', windowTarget ? `Capturing ${windowTarget}` : 'Capturing desktop', windowTarget ? `Captured ${windowTarget}` : 'Captured desktop', { family: 'desktop', target: windowTarget, countNoun: 'desktop capture' });
    if (name.includes('focus')) return make('desktop.focus', 'window focus', 'Preparing window focus…', windowTarget ? `Focusing ${windowTarget}` : 'Focusing desktop window', windowTarget ? `Focused ${windowTarget}` : 'Focused desktop window', { family: 'desktop', target: windowTarget, countNoun: 'window focus' });
    if (name.includes('type')) return make('desktop.type', 'desktop typing', 'Preparing desktop typing…', firstValue(args, ['text', 'value'], 60) ? `Typing ${quote(firstValue(args, ['text', 'value'], 60))}` : 'Typing on desktop', 'Typed on desktop', { family: 'desktop', target: windowTarget, countNoun: 'desktop typing action' });
    if (name.includes('scroll')) return make('desktop.scroll', 'desktop scroll', 'Preparing desktop scroll…', 'Scrolling desktop', 'Scrolled desktop', { family: 'desktop', target: windowTarget, countNoun: 'desktop scroll' });
    return make(`desktop.${name}`, 'desktop action', 'Preparing desktop action…', `${titleCase(name)} on desktop`, `${titleCase(name)} completed`, { family: 'desktop', target, countNoun: 'desktop action' });
  }

  if (action.startsWith('browser_')) {
    const name = action.slice('browser_'.length);
    if (name.includes('click')) return make('browser.click', 'browser click', 'Preparing browser click…', textTarget ? `Clicking ${quote(textTarget)} in browser` : 'Clicking in browser', textTarget ? `Clicked ${quote(textTarget)}` : 'Clicked in browser', { family: 'browser', target: textTarget, countNoun: 'browser click' });
    if (['open', 'navigate', 'goto'].includes(name)) return make('browser.open', 'page open', 'Preparing page…', url ? `Opening ${compact(url, 90)}` : 'Opening page', url ? `Opened ${compact(url, 90)}` : 'Opened page', { family: 'browser', target: url, countNoun: 'page open' });
    if (name.includes('type') || name === 'fill') return make('browser.type', 'browser typing', 'Preparing browser input…', firstValue(args, ['text', 'value'], 60) ? `Typing ${quote(firstValue(args, ['text', 'value'], 60))} in browser` : 'Typing in browser', 'Entered text in browser', { family: 'browser', target: textTarget, countNoun: 'browser input' });
    if (name.includes('snapshot') || name.includes('screenshot')) return make('browser.capture', 'browser capture', 'Preparing browser capture…', 'Capturing browser', 'Captured browser', { family: 'browser', target: url, countNoun: 'browser capture' });
    if (name.includes('scroll')) return make('browser.scroll', 'browser scroll', 'Preparing browser scroll…', 'Scrolling browser', 'Scrolled browser', { family: 'browser', target: url, countNoun: 'browser scroll' });
    if (name.includes('extract') || name.includes('read')) return make('browser.read', 'page read', 'Preparing page read…', 'Reading page', 'Read page', { family: 'browser', target: url, countNoun: 'page read' });
    return make(`browser.${name}`, 'browser action', 'Preparing browser action…', `${titleCase(name)} in browser`, `${titleCase(name)} completed`, { family: 'browser', target, countNoun: 'browser action' });
  }

  if (action === 'web_search') return make('web.search', 'web search', 'Preparing web search…', search ? `Searching the web for ${quote(search)}` : 'Searching the web', 'Searched the web', { family: 'web', target: search, countNoun: 'web search' });
  if (action === 'web_fetch') return make('web.fetch', 'web fetch', 'Preparing page fetch…', url ? `Fetching ${compact(url, 90)}` : 'Fetching page', url ? `Fetched ${compact(url, 90)}` : 'Fetched page', { family: 'web', target: url, countNoun: 'page fetch' });
  if (/^(?:present_visual|render_visual|generate_visual|interactive_visual)$/.test(action)) {
    const renderer = firstValue(args, ['renderer', 'format', 'type'], 40);
    return make('presentation.visual', 'interactive visual', 'Preparing interactive visual…', renderer ? `Generating interactive visual · ${renderer}` : 'Generating interactive visual', 'Rendered interactive visual', { family: 'presentation', target: renderer, countNoun: 'interactive visual' });
  }
  if (/^(?:generate_image|image_gen|imagegen)$/.test(action)) return make('media.image', 'image generation', 'Preparing image generation…', 'Generating image', 'Generated image', { family: 'media', target: firstValue(args, ['prompt'], 80), countNoun: 'image generation' });
  if (/^(?:generate_video|video_gen)$/.test(action)) return make('media.video', 'video generation', 'Preparing video generation…', 'Generating video', 'Generated video', { family: 'media', target: firstValue(args, ['prompt'], 80), countNoun: 'video generation' });

  const friendly = titleCase(action || 'tool');
  return make(`tool.${action || 'unknown'}`, friendly.toLowerCase(), `Preparing ${friendly.toLowerCase()}…`, target ? `${friendly} · ${target}` : friendly, `${friendly} completed`, { target, countNoun: friendly.toLowerCase() });
}

function failureLabel(description, result) {
  if (description.key === 'command.run') {
    return description.target ? `Command failed · ${description.target}` : 'Command failed';
  }
  const reason = resultFirstLine(result, 110);
  const base = `${description.noun.charAt(0).toUpperCase()}${description.noun.slice(1)} failed`;
  return reason ? `${base} · ${reason}` : base;
}

function successLabel(description, result) {
  const found = resultCount(result, ['returned_count', 'match_count', 'count', 'total']);
  if (description.key === 'file.search' && found != null) return `Found ${found} match${found === 1 ? '' : 'es'}`;
  return description.success;
}

function activityText(activity = {}) {
  const description = describeTool(activity.action, activity.args);
  if (activity.kind === 'result') {
    const label = activity.ok === false ? failureLabel(description, activity.result) : successLabel(description, activity.result);
    const duration = durationLabel(activity.durationMs);
    return duration ? `${label} · ${duration}` : label;
  }
  if (activity.status === 'preparing') return description.preparing;
  return description.running;
}

function makeActivity(payload, phase, previous = null) {
  const args = actionArgs(payload);
  const action = actionFromPayload(payload) || previous?.action || '';
  const callId = callIdFromPayload(payload) || previous?.callId || '';
  const now = Date.now();
  const durationMs = Number(payload.durationMs ?? payload.elapsedMs ?? payload.elapsed_ms ?? previous?.durationMs);
  const errorValue = payload.error;
  const errorText = typeof errorValue === 'string'
    ? errorValue
    : errorValue && typeof errorValue === 'object' ? (errorValue.message || errorValue.error || '') : '';
  const result = payload.result ?? payload.output ?? errorText ?? previous?.result ?? '';
  const hasStructuredError = errorValue === true
    || (typeof errorValue === 'string' && errorValue.trim().length > 0)
    || (errorValue && typeof errorValue === 'object');
  const ok = payload.ok === false || payload.success === false || hasStructuredError ? false : true;
  const description = describeTool(action, Object.keys(args).length ? args : previous?.args || {});
  const extra = payload.extra && typeof payload.extra === 'object' ? payload.extra : {};
  const incomingTerminal = payload.terminal && typeof payload.terminal === 'object' ? payload.terminal : null;
  const runId = compact(payload.runId || payload.run_id || extra.runId || extra.run_id || incomingTerminal?.runId || previous?.terminal?.runId, 180);
  const terminal = previous?.terminal || incomingTerminal || (runId ? {
    runId,
    state: phase === 'result' && normalizeAction(args.action) !== 'start' ? 'exited' : 'running',
    output: '',
    sequence: 0,
  } : undefined);
  return {
    ...(previous || {}),
    kind: phase === 'result' ? 'result' : 'operation',
    callId,
    action,
    key: description.key,
    family: description.family,
    countNoun: description.countNoun,
    args: Object.keys(args).length ? args : previous?.args || {},
    target: description.target,
    status: phase === 'prepare' ? 'preparing' : phase === 'result' ? (ok ? 'succeeded' : 'failed') : 'running',
    ok: phase === 'result' ? ok : undefined,
    progress: phase === 'progress' ? compact(payload.message || payload.progress || payload.status, 180) : previous?.progress || '',
    result: phase === 'result' ? String(result || '') : previous?.result || '',
    durationMs: Number.isFinite(durationMs) ? durationMs : previous?.durationMs,
    startedAt: previous?.startedAt || Number(payload.at || payload.timestamp || now),
    updatedAt: now,
    technicalName: action,
    activityId: previous?.activityId || payload.activityId || '',
    ...(terminal ? { terminal } : {}),
  };
}

function matchingOperation(entries, payload, phase) {
  const callId = callIdFromPayload(payload);
  const action = actionFromPayload(payload);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const activity = entries[index]?.activity;
    if (!activity || activity.kind !== 'operation' || activity.resultAttached) continue;
    if (callId && activity.callId && callId === activity.callId) return entries[index];
    if (action && activity.action === action && ['preparing', 'running'].includes(activity.status)) return entries[index];
    if (phase === 'call' && activity.status === 'preparing' && action && describeTool(action).key === activity.key) return entries[index];
  }
  return null;
}

export function applyToolActivityEvent(entriesInput, phaseRaw, payload = {}) {
  const entries = Array.isArray(entriesInput) ? entriesInput : [];
  const phase = String(phaseRaw || '').toLowerCase();
  if (!['prepare', 'prepared', 'call', 'progress', 'result'].includes(phase)) return null;
  let operationEntry = matchingOperation(entries, payload, phase);

  if (phase === 'prepared') {
    if (!operationEntry) return null;
    const args = actionArgs(payload);
    if (Object.keys(args).length) operationEntry.activity.args = args;
    return operationEntry;
  }

  if (phase !== 'result') {
    if (!operationEntry) {
      const activity = makeActivity(payload, phase === 'prepare' ? 'prepare' : 'call');
      operationEntry = {
        id: `tool_activity_${activity.callId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`,
        type: 'tool',
        activity,
        text: '',
        ts: new Date().toLocaleTimeString(),
      };
      operationEntry.activity.activityId = operationEntry.id;
      operationEntry.text = activityText(activity);
      entries.push(operationEntry);
    } else {
      operationEntry.activity = makeActivity(payload, phase === 'prepare' ? 'prepare' : phase, operationEntry.activity);
      operationEntry.text = activityText(operationEntry.activity);
    }
    return operationEntry;
  }

  if (!operationEntry) {
    const operation = makeActivity(payload, 'call');
    operationEntry = {
      id: `tool_activity_${operation.callId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`,
      type: 'tool',
      activity: operation,
      text: activityText(operation),
      ts: new Date().toLocaleTimeString(),
    };
    operationEntry.activity.activityId = operationEntry.id;
    entries.push(operationEntry);
  }
  operationEntry.activity.resultAttached = true;
  operationEntry.activity.status = 'called';
  operationEntry.activity.progress = '';
  operationEntry.text = activityText(operationEntry.activity);

  const resultActivity = makeActivity(payload, 'result', operationEntry.activity);
  resultActivity.kind = 'result';
  const existingResult = entries.find((entry) => entry?.activity?.kind === 'result'
    && resultActivity.callId && entry.activity.callId === resultActivity.callId);
  if (existingResult) {
    existingResult.activity = resultActivity;
    existingResult.type = resultActivity.ok ? 'result' : 'error';
    existingResult.text = activityText(resultActivity);
    return existingResult;
  }
  const resultEntry = {
    id: `tool_result_${resultActivity.callId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`,
    type: resultActivity.ok ? 'result' : 'error',
    activity: resultActivity,
    text: activityText(resultActivity),
    ts: new Date().toLocaleTimeString(),
  };
  const operationIndex = entries.indexOf(operationEntry);
  if (operationIndex >= 0) entries.splice(operationIndex + 1, 0, resultEntry);
  else entries.push(resultEntry);
  return resultEntry;
}

export function applyCommandProcessEvent(entriesInput, eventTypeRaw, payload = {}) {
  const entries = Array.isArray(entriesInput) ? entriesInput : [];
  const run = payload.run && typeof payload.run === 'object' ? payload.run : {};
  const eventType = String(eventTypeRaw || payload.type || '').trim().toLowerCase();
  const runId = compact(run.runId || payload.runId, 180);
  const callId = compact(run.toolCallId || payload.toolCallId || payload.tool_call_id, 180);
  const command = compact(run.command || payload.command, 500);
  const candidates = entries.filter((entry) => entry?.activity?.family === 'command');
  let operationEntry = candidates.find((entry) => runId && entry.activity?.terminal?.runId === runId)
    || candidates.find((entry) => callId && entry.activity?.callId === callId)
    || [...candidates].reverse().find((entry) => entry.activity?.kind === 'operation'
      && (!entry.activity.terminal?.runId || (command && entry.activity.args?.command === command)));
  if (!operationEntry) return null;

  const terminal = operationEntry.activity.terminal || {
    runId,
    state: 'starting',
    output: '',
    sequence: 0,
  };
  terminal.runId = runId || terminal.runId || '';
  terminal.command = command || terminal.command || firstValue(operationEntry.activity.args, ['command', 'cmd', 'script'], 500);
  terminal.cwd = compact(run.cwd || terminal.cwd, 300);
  terminal.state = String(run.state || terminal.state || (eventType === 'process_run_exited' ? 'exited' : 'running'));
  terminal.exitCode = run.exitCode ?? terminal.exitCode;
  terminal.durationMs = run.durationMs ?? terminal.durationMs;

  if (eventType === 'process_run_output') {
    const sequence = Number(payload.sequence ?? run.outputSeq ?? 0);
    if (!sequence || sequence > Number(terminal.sequence || 0)) {
      terminal.output = boundTerminalText(`${terminal.output || ''}${payload.chunk || ''}`);
      terminal.sequence = sequence || Number(terminal.sequence || 0) + 1;
      terminal.lastStream = String(payload.stream || 'stdout');
    }
  } else if (!terminal.output && run.outputPreview) {
    terminal.output = boundTerminalText(run.outputPreview);
    terminal.sequence = Number(run.outputSeq || terminal.sequence || 0);
  }
  if (eventType === 'process_run_exited' || terminal.state === 'exited') terminal.completed = true;
  operationEntry.activity.terminal = terminal;
  for (const entry of candidates) {
    if (entry === operationEntry) continue;
    const sameCall = callId && entry.activity?.callId === callId;
    const sameRun = runId && entry.activity?.terminal?.runId === runId;
    if (sameCall || sameRun) entry.activity.terminal = terminal;
  }
  return terminal;
}

function legacyPayload(entry = {}) {
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const nested = extra.extra && typeof extra.extra === 'object' ? extra.extra : {};
  const text = String(entry.text || entry.content || entry.message || '').trim();
  return {
    ...nested,
    ...extra,
    action: extra.action || extra.toolName || entry.action || entry.toolName || '',
    args: extra.args || entry.args || {},
    result: entry.type === 'result' || entry.type === 'error' ? text : extra.result,
    error: entry.type === 'error' || extra.error === true,
    tool_call_id: extra.tool_call_id || extra.toolCallId || entry.tool_call_id || '',
    durationMs: extra.durationMs ?? extra.elapsedMs ?? entry.durationMs,
  };
}

export function coalesceToolActivityEntries(entriesInput) {
  const source = Array.isArray(entriesInput) ? entriesInput : [];
  const out = [];
  for (const original of source) {
    if (!original || typeof original !== 'object') continue;
    if (original.activity) {
      const phase = original.activity.kind === 'result'
        ? 'result'
        : original.activity.status === 'preparing' ? 'prepare' : 'call';
      applyToolActivityEvent(out, phase, { ...original.activity, error: original.activity.ok === false });
      if (phase === 'call') {
        const current = out[out.length - 1];
        if (current?.activity) current.activity.progress = original.activity.progress || '';
      }
      continue;
    }
    const type = String(original.type || '').toLowerCase();
    const text = String(original.text || original.content || '').replace(/\s+/g, ' ').trim();
    const payload = legacyPayload(original);
    const event = String(original.extra?.event || original.event || '').toLowerCase();
    const action = actionFromPayload(payload);
    if (type === 'tool' && /^Prepared\b/i.test(text)) {
      applyToolActivityEvent(out, 'prepared', payload);
      continue;
    }
    if (type === 'tool' && /^Preparing\b/i.test(text)) {
      applyToolActivityEvent(out, event === 'tool_call' && action ? 'call' : 'prepare', {
        ...payload,
        action: action || text.replace(/^Preparing\s+/i, '').replace(/\.{3}$/, '').replace(/\s+/g, '_'),
      });
      continue;
    }
    if ((type === 'tool' || type === 'skill') && action) {
      applyToolActivityEvent(out, 'call', payload);
      continue;
    }
    if ((type === 'result' || type === 'error') && action) {
      applyToolActivityEvent(out, 'result', payload);
      continue;
    }
    if (type === 'result' || type === 'error') {
      // Older persisted traces sometimes contain a result body without the
      // tool name. Attach it to the most recent unfinished operation instead
      // of creating a second anonymous raw result card.
      const priorOperation = [...out].reverse().find((entry) => (
        entry?.activity?.kind === 'operation' && entry.activity.resultAttached !== true
      ));
      if (priorOperation?.activity?.action) {
        applyToolActivityEvent(out, 'result', {
          ...payload,
          action: priorOperation.activity.action,
          args: priorOperation.activity.args,
          callId: priorOperation.activity.callId,
        });
        continue;
      }
    }
    if ((event === 'tool_progress' || type === 'progress') && action) {
      applyToolActivityEvent(out, 'progress', { ...payload, message: text });
      continue;
    }
    out.push({ ...original });
  }
  return out;
}

export function toolActivitySummary(entriesInput, { live = false } = {}) {
  const entries = coalesceToolActivityEntries(entriesInput);
  const operations = entries.filter((entry) => entry?.activity?.kind === 'operation').map((entry) => entry.activity);
  const results = entries.filter((entry) => entry?.activity?.kind === 'result').map((entry) => entry.activity);
  if (!operations.length) return '';
  if (live) {
    const current = operations[operations.length - 1];
    const text = activityText(current);
    return current.progress ? `${text} · ${current.progress}` : text;
  }
  const failed = results.filter((activity) => activity.ok === false);
  const succeeded = results.filter((activity) => activity.ok !== false);
  const groups = new Map();
  for (const activity of succeeded) {
    const key = activity.countNoun || activity.key || activity.action || 'tool';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  }
  const parts = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (list.length === 1) parts.push(activityText(first).replace(/\s+·\s+\d+(?:\.\d+)?\s*(?:ms|s)$/i, ''));
    else if (first.family === 'command') parts.push(`Ran ${list.length} commands`);
    else parts.push(`${list.length} ${first.countNoun || 'tool calls'}${/s$/i.test(first.countNoun || '') ? '' : 's'}`);
  }
  if (failed.length === 1) parts.push(activityText(failed[0]).replace(/\s+·\s+\d+(?:\.\d+)?\s*(?:ms|s)$/i, ''));
  else if (failed.length > 1) parts.push(`${failed.length} operations failed`);
  if (!parts.length) return `${operations.length} tool call${operations.length === 1 ? '' : 's'}`;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} · ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} · ${parts[parts.length - 1]}`;
}

export function toolActivityDetailItems(_activity = {}) {
  // Kept as a compatibility export for integrations that imported the helper;
  // the user-facing stream intentionally has no technical detail section.
  return [];
}

export function renderToolActivityEntry(entry, escapeHtml) {
  const activity = entry?.activity;
  if (!activity) return '';
  const esc = typeof escapeHtml === 'function'
    ? escapeHtml
    : (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const label = String(entry.text || activityText(activity));
  const editStats = toolActivityEditStats(activity);
  const durationMatch = editStats ? label.match(/(\s+·\s+\d+(?:\.\d+)?\s*(?:ms|s))$/i) : null;
  const labelBase = durationMatch ? label.slice(0, -durationMatch[1].length) : label;
  const editStatsHtml = editStats
    ? ` <span class="tool-activity-edit-delta" data-added-lines="${editStats.added}" data-removed-lines="${editStats.removed}"><span class="tool-activity-edit-added" style="color:var(--ok,#4ade80)">+${editStats.added}</span> <span class="tool-activity-edit-removed" style="color:var(--err,#f87171)">−${editStats.removed}</span></span>`
    : '';
  const labelHtml = `${esc(labelBase)}${editStatsHtml}${durationMatch ? esc(durationMatch[1]) : ''}`;
  const state = activity.kind === 'result' ? (activity.ok === false ? 'failed' : 'succeeded') : activity.status || 'running';
  const activityKey = activity.callId || activity.activityId || entry?.id || `${activity.action || 'tool'}_${activity.kind || 'operation'}`;
  const terminal = activity.family === 'command' ? activity.terminal : null;
  const terminalActive = terminal && !terminal.completed && !['exited'].includes(String(terminal.state || '').toLowerCase());
  const showTerminal = terminal && ((activity.kind === 'operation' && !activity.resultAttached) || activity.kind === 'result');
  const terminalOutput = String(terminal?.output || '').trim();
  const terminalDisclosureKey = `terminal:${terminal?.runId || activityKey}`;
  const storedTerminalDisclosure = disclosureState()?.get(terminalDisclosureKey);
  const terminalOpen = storedTerminalDisclosure === true || (storedTerminalDisclosure == null && terminalActive);
  const terminalHtml = showTerminal ? `<details class="tool-command-terminal${terminalActive ? ' is-live' : ' is-complete'}" data-tool-disclosure-key="${esc(terminalDisclosureKey)}" data-command-run-id="${esc(terminal.runId || '')}"${terminalOpen ? ' open' : ''}>
    <summary><span>${terminalActive ? 'Live terminal' : 'Terminal output'}</span><em>${terminalActive ? 'streaming' : 'completed'}</em><i aria-hidden="true">›</i></summary>
    <pre data-command-terminal-output="${esc(terminal.runId || '')}" data-terminal-sequence="${esc(terminal.sequence || 0)}">${esc(terminalOutput || (terminalActive ? 'Waiting for output…' : 'Open to load output…'))}</pre>
  </details>` : '';
  return `<div class="tool-activity-wrap" data-activity-key="${esc(activityKey)}">
  <div class="tool-activity-entry" data-kind="${esc(activity.kind || 'operation')}" data-status="${esc(state)}">
    <div class="tool-activity-entry-summary"><span class="tool-activity-label">${labelHtml}</span></div>
  </div>
  ${terminalHtml}
  </div>`;
}

export function appendCommandTerminalChunkToDom(runIdRaw, chunkRaw, sequenceRaw = 0) {
  if (typeof document === 'undefined') return;
  const runId = String(runIdRaw || '').trim();
  const chunk = cleanTerminalText(chunkRaw);
  if (!runId || !chunk) return;
  document.querySelectorAll('[data-command-terminal-output]').forEach((element) => {
    if (String(element.getAttribute('data-command-terminal-output') || '') !== runId) return;
    const sequence = Number(sequenceRaw || 0);
    const previousSequence = Number(element.getAttribute('data-terminal-sequence') || 0);
    if (sequence && sequence <= previousSequence) return;
    const wasNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    const current = /^(Waiting for output…|Open to load output…)$/.test(element.textContent || '') ? '' : element.textContent || '';
    element.textContent = boundTerminalText(`${current}${chunk}`);
    element.setAttribute('data-terminal-sequence', String(sequence || previousSequence + 1));
    if (wasNearBottom) element.scrollTop = element.scrollHeight;
  });
}
