/**
 * Map a harness's own tool call onto the native Prometheus tool name + args, so
 * the existing chat stream (desktop tool-activity.js and the mobile renderer)
 * labels it exactly like a Prometheus tool: "Running command · npm test",
 * "Read src/app.ts", "Searching files for 'foo'", "Updated README.md"...
 *
 * Display only. Nothing here runs a Prometheus tool; the harness already ran it.
 */

export interface NativeToolCall {
  /** Native Prometheus tool name the UI already knows how to label. */
  name: string;
  args: Record<string, unknown>;
}

const str = (value: unknown, max = 2000): string => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const pick = (input: any, keys: string[], max = 2000): string => {
  if (!input || typeof input !== 'object') return '';
  for (const key of keys) {
    const value = str(input[key], max).trim();
    if (value) return value;
  }
  return '';
};

const snake = (name: string): string => String(name || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

function commandCall(command: string): NativeToolCall {
  return { name: 'run_command', args: command ? { command } : {} };
}

/** A tool with no native equivalent: shown as a neutral step with its own label. */
function stepCall(label: string): NativeToolCall {
  return { name: '', args: label ? { title: label } : {} };
}

/** Claude Code built-in tools (and mcp__server__tool) from the Agent SDK. */
export function claudeToolToNative(name: string, input: any): NativeToolCall {
  const filePath = pick(input, ['file_path', 'notebook_path', 'path']);
  switch (name) {
    case 'Bash':
    case 'BashOutput':
    case 'PowerShell':
      return commandCall(pick(input, ['command']));
    case 'Read':
      return { name: 'read_file', args: filePath ? { path: filePath } : {} };
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { name: 'edit_file', args: filePath ? { path: filePath } : {} };
    case 'Glob':
      return { name: 'find_files', args: { pattern: pick(input, ['pattern']), ...(filePath ? { path: filePath } : {}) } };
    case 'Grep':
      return { name: 'grep_files', args: { pattern: pick(input, ['pattern']), ...(filePath ? { path: filePath } : {}) } };
    case 'LS':
      return { name: 'list_directory', args: filePath ? { path: filePath } : {} };
    case 'WebFetch':
      return { name: 'web_fetch', args: { url: pick(input, ['url']) } };
    case 'WebSearch':
      return { name: 'web_search', args: { query: pick(input, ['query']) } };
    case 'TodoWrite':
      return { name: 'complete_plan_step', args: {} };
    case 'Task':
    case 'Agent':
      return { name: 'background_spawn', args: { prompt: pick(input, ['description', 'prompt'], 200) } };
    default:
      if (/^mcp__/.test(name)) return { name, args: input && typeof input === 'object' ? input : {} };
      return { name: snake(name) || 'tool', args: {} };
  }
}

/** ACP tool_call (Hermes, OpenClaw, Cursor). Uses the protocol's tool kind + locations. */
export function acpToolToNative(update: any): NativeToolCall {
  const raw = update?.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {};
  const title = str(update?.title, 300).trim();
  const location = Array.isArray(update?.locations) ? str(update.locations[0]?.path, 1000) : '';
  const filePath = location || pick(raw, ['path', 'file_path', 'file', 'filename', 'target']);
  switch (String(update?.kind || '')) {
    case 'execute':
      return commandCall(pick(raw, ['command', 'cmd', 'script']) || title);
    case 'read':
      return { name: 'read_file', args: filePath ? { path: filePath } : {} };
    case 'edit':
    case 'delete':
    case 'move':
      return { name: 'edit_file', args: filePath ? { path: filePath } : {} };
    case 'search': {
      const pattern = pick(raw, ['pattern', 'query', 'regex', 'q']);
      return { name: 'search_files', args: { ...(pattern ? { pattern } : {}), ...(filePath ? { path: filePath } : {}) } };
    }
    case 'fetch': {
      const url = pick(raw, ['url', 'href']);
      if (url) return { name: 'web_fetch', args: { url } };
      return { name: 'web_search', args: { query: pick(raw, ['query', 'q']) || title } };
    }
    default:
      return stepCall(title);
  }
}

/** Codex app-server thread items. */
export function codexItemToNative(type: string, item: any): NativeToolCall {
  switch (type) {
    case 'commandExecution':
      return commandCall(str(item?.command));
    case 'fileChange': {
      const files = (Array.isArray(item?.changes) ? item.changes : []).map((change: any) => str(change?.path, 1000)).filter(Boolean);
      return { name: 'edit_file', args: files.length === 1 ? { path: files[0] } : {} };
    }
    case 'mcpToolCall':
    case 'dynamicToolCall': {
      const server = snake(str(item?.server || item?.namespace, 80));
      const tool = snake(str(item?.tool, 80));
      return server && tool ? { name: `mcp__${server}__${tool}`, args: {} } : stepCall(tool || 'Tool');
    }
    case 'webSearch':
      return { name: 'web_search', args: { query: str(item?.query, 300) } };
    case 'plan':
      return { name: 'complete_plan_step', args: {} };
    default:
      return stepCall('');
  }
}

/** Text of a tool's result for the expandable row (same place native output shows). */
export function toolResultText(content: unknown, max = 4000): string {
  if (typeof content === 'string') return str(content, max);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const text = block?.type === 'text' ? block.text
      : block?.type === 'content' && block.content?.type === 'text' ? block.content.text
        : block?.type === 'diff' ? `Edited ${str(block.path, 400)}` : '';
    if (text) parts.push(String(text));
  }
  return str(parts.join('\n').trim(), max);
}
