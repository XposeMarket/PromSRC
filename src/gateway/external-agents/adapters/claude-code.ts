import { execFile } from 'child_process';
import { claudeToolToNative, toolResultText } from '../native-tool-map';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { findOnPath, resolveFromCandidates, type ResolvedCommand } from '../executable';
import { claudeFileTouch } from '../file-touches';
import type { ExternalAgentAdapter, ExternalAgentCapabilities, ExternalTurnInput, ExternalTurnResult, ExternalAgentVerifyResult } from '../types';

export interface ClaudeRequestCard {
  kind: 'command' | 'permissions';
  title: string;
  detail: { cwd: string; command?: string; reason?: string; files?: string[]; preview?: string };
}
const PREVIEW_LIMIT = 2000;
function textOf(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function rawText(value: unknown): string { return typeof value === 'string' ? value : (JSON.stringify(value) ?? ''); }
function editBlock(oldText: string, newText: string): string {
  return [...oldText.split('\n').map((line) => `- ${line}`), ...newText.split('\n').map((line) => `+ ${line}`)].join('\n');
}
function capPreview(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  return `${text.slice(0, PREVIEW_LIMIT)}\n… (showing the first 2,000 of ${text.length.toLocaleString('en-US')} characters)`;
}
const REASON_LINE_LIMIT = 400;
/** Builds the user-facing permission card for one Claude Code tool request. Never echoes raw JSON. */
export function claudeRequestCard(name: string, args: Record<string, unknown>, cwd: string): ClaudeRequestCard {
  const detail: ClaudeRequestCard['detail'] = { cwd };
  const reasons: string[] = [];
  const shown = new Set<string>();
  const show = (...keys: string[]) => { for (const key of keys) shown.add(key); };
  const replaceAll = () => {
    if (typeof args.replace_all !== 'boolean') return;
    show('replace_all');
    if (args.replace_all) reasons.push('Replaces all occurrences.');
  };
  let kind: ClaudeRequestCard['kind'] = 'permissions';
  let title = `Claude Code wants to use ${name}`;
  const filePath = textOf(args.file_path);
  if (name === 'Bash' || name === 'PowerShell') {
    kind = 'command';
    title = 'Claude Code wants to run a command';
    show('command', 'description');
    detail.command = String(args.command || '');
    const description = textOf(args.description);
    if (description !== undefined) reasons.push(description);
  } else if (name === 'Write') {
    title = 'Claude Code wants to write a file';
    show('file_path', 'content');
    if (filePath !== undefined) detail.files = [filePath];
    detail.preview = rawText(args.content);
  } else if (name === 'Edit') {
    title = 'Claude Code wants to edit a file';
    show('file_path', 'old_string', 'new_string');
    if (filePath !== undefined) detail.files = [filePath];
    detail.preview = editBlock(rawText(args.old_string), rawText(args.new_string));
    replaceAll();
  } else if (name === 'MultiEdit') {
    title = 'Claude Code wants to edit a file';
    show('file_path', 'edits');
    if (filePath !== undefined) detail.files = [filePath];
    const edits: unknown[] = Array.isArray(args.edits) ? args.edits : [];
    detail.preview = edits.map((item) => {
      const edit: Record<string, unknown> = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      const block = editBlock(rawText(edit.old_string), rawText(edit.new_string));
      // replace_all belongs to each edit: say it next to the edit it widens, with any other per-edit option.
      const notes = [
        ...(edit.replace_all === true ? ['(replaces all occurrences)'] : []),
        ...Object.keys(edit).filter((key) => !['old_string', 'new_string', 'replace_all'].includes(key)).map((key) => `(${key}: ${JSON.stringify(edit[key])})`),
      ];
      return notes.length ? `${notes.join('\n')}\n${block}` : block;
    }).join('\n\n');
    replaceAll();
  } else if (name === 'NotebookEdit') {
    const mode = textOf(args.edit_mode);
    if (mode === 'replace' || mode === 'insert' || mode === 'delete') show('edit_mode');
    const operation = mode ?? 'replace';
    title = `Claude Code wants to ${operation === 'delete' ? 'delete a notebook cell' : operation === 'insert' ? 'insert a notebook cell' : 'edit a notebook cell'}`;
    show('notebook_path');
    const notebookPath = textOf(args.notebook_path);
    if (notebookPath !== undefined) detail.files = [notebookPath];
    const cellId = textOf(args.cell_id);
    if (cellId !== undefined) { show('cell_id'); reasons.push(`Cell id: ${cellId}`); }
    const cellType = textOf(args.cell_type);
    if (cellType !== undefined) { show('cell_type'); reasons.push(`Cell type: ${cellType}`); }
    if (operation !== 'delete') {
      show('new_source');
      detail.preview = rawText(args.new_source);
    }
  } else if (['Read', 'Glob', 'Grep', 'LS'].includes(name)) {
    title = 'Claude Code wants to read files';
    show('file_path', 'path', 'pattern');
    const target = filePath ?? textOf(args.path);
    if (target !== undefined) detail.files = [target];
    const pattern = textOf(args.pattern);
    if (pattern !== undefined) reasons.push(`Pattern: ${pattern}`);
  } else if (name === 'WebFetch') {
    title = 'Claude Code wants to open a web page';
    show('url');
    const url = textOf(args.url);
    if (url !== undefined) reasons.push(url);
  } else if (name === 'WebSearch') {
    title = 'Claude Code wants to search the web';
    show('query');
    const query = textOf(args.query);
    if (query !== undefined) reasons.push(query);
  } else {
    for (const key of Object.keys(args)) show(key);
    detail.preview = Object.entries(args).map(([key, value]) => `${key}: ${rawText(value)}`).join('\n');
  }
  // Any argument the card does not show is listed in plain text, never dropped silently.
  const leftover = Object.keys(args).filter((key) => !shown.has(key));
  if (leftover.length) {
    const line = `Other arguments: ${leftover.map((key) => `${key}: ${JSON.stringify(args[key]) ?? 'undefined'}`).join('; ')}`;
    reasons.push(line.length > REASON_LINE_LIMIT ? `${line.slice(0, REASON_LINE_LIMIT - 3)}...` : line);
  }
  if (reasons.length) detail.reason = reasons.join('\n');
  if (detail.preview !== undefined) detail.preview = capPreview(detail.preview);
  return { kind, title, detail };
}

// Use native import at runtime: the SDK is ESM, while the gateway is CommonJS.
const importDriver = new Function('return import("@prometheus/claude-driver")') as () => Promise<{ createQuery: (input: any) => any }>;
const CAPS: ExternalAgentCapabilities = { resume: true, interrupt: true, approvals: true, images: false, modelList: true };
interface Options {
  resolve?: () => ResolvedCommand | null;
  status?: (command: ResolvedCommand) => Promise<boolean>;
  query?: (input: any) => any;
}
function resolveClaude(): ResolvedCommand | null {
  const home = os.homedir();
  const configured = process.env.PROMETHEUS_CLAUDE_BIN;
  return resolveFromCandidates([
    ...(configured ? [configured] : []),
    path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    ...findOnPath('claude'),
  ]);
}
function ownAuthStatus(command: ResolvedCommand): Promise<boolean> {
  return new Promise((resolve) => execFile(command.command, [...command.args, 'auth', 'status', '--json'],
    { windowsHide: true, shell: false, timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error) return resolve(false);
      try { resolve(JSON.parse(stdout).loggedIn === true); } catch { resolve(false); }
    }));
}
function executable(command: ResolvedCommand): string {
  // SDK executes cli.js via its own Node transport; never pass a Windows shell shim.
  return command.args.find((arg) => /\.(?:c?js|mjs)$/i.test(arg)) || command.command;
}

export class ClaudeCodeAdapter implements ExternalAgentAdapter {
  readonly id = 'claude-code' as const;
  readonly name = 'Claude Code';
  readonly tile = 'Cc';
  readonly capabilities = CAPS;
  private active = new Map<string, { close: () => void }>();
  constructor(private options: Options = {}) {}
  private resolve() { return (this.options.resolve || resolveClaude)(); }
  async detect() { const command = this.resolve(); return { found: !!command, ...(command ? { executable: command.source } : {}) }; }
  async verify(): Promise<ExternalAgentVerifyResult> {
    const command = this.resolve();
    if (!command) return { status: 'not_installed', statusText: 'Claude Code is not installed on this computer.', capabilities: CAPS };
    try {
      if (!(await (this.options.status || ownAuthStatus)(command))) return { status: 'signed_out', statusText: 'Sign in using Claude Code, then Check again.', capabilities: CAPS };
      if (!this.options.query) await importDriver();
      return { status: 'ready', statusText: 'Connected to your Claude Code installation', capabilities: CAPS };
    } catch { return { status: 'error', statusText: 'The Claude Code driver could not load. Check the installation and try again.', capabilities: CAPS }; }
  }
  isRunning() { return this.active.size > 0; }
  async shutdown() { for (const turn of this.active.values()) turn.close(); this.active.clear(); }
  async listModels(context: { cwd: string }) {
    const command = this.resolve();
    if (!command) throw new Error('Claude Code is not installed.');
    const query = this.options.query || (await importDriver()).createQuery;
    const lifetime = new AbortController();
    async function* idle(): AsyncGenerator<never> { if (!lifetime.signal.aborted) await new Promise<void>(resolve => lifetime.signal.addEventListener('abort', () => resolve(), { once: true })); }
    const runtime = query({ prompt: idle(), options: { cwd: context.cwd, pathToClaudeCodeExecutable: executable(command), systemPrompt: { type: 'preset', preset: 'claude_code' }, canUseTool: async () => ({ behavior: 'deny', message: 'Model discovery only.' }) } });
    const key = `models-${crypto.randomUUID()}`;
    const close = () => { lifetime.abort(); runtime.close(); };
    this.active.set(key, { close });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const models = await Promise.race([runtime.supportedModels(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { close(); reject(new Error('Claude model discovery timed out.')); }, 15000); })]);
      return { models: models.map((m: { value: string; displayName: string; supportedEffortLevels?: string[] }) => ({ id: m.value, label: m.displayName, efforts: m.supportedEffortLevels })) };
    } finally { clearTimeout(timer); close(); this.active.delete(key); }
  }
  async runTurn(input: ExternalTurnInput): Promise<ExternalTurnResult> {
    let sessionId = input.upstreamSessionId || crypto.randomUUID();
    const lifetime = new AbortController();
    let runtime: any;
    let text = '';
    let resultText = '';
    let model: string | undefined;
    let failed = false;
    let completed = false;
    let upstreamMissing = false;
    let errorText = '';
    const tools = new Set<string>();
    // File edits by tool call, reported for the end-of-turn file card once the tool succeeds.
    const edits = new Map<string, NonNullable<ReturnType<typeof claudeFileTouch>>>();
    const close = () => { lifetime.abort(); try { runtime?.close(); } catch { /* already closed */ } };
    const stop = () => { lifetime.abort(); void runtime?.interrupt?.().catch(() => {}); close(); };
    if (this.active.has(input.sessionId)) return { upstreamSessionId: sessionId, status: 'failed', finalText: '', error: 'Claude Code is already working in this chat.' };
    try {
      const command = this.resolve();
      if (!command) throw new Error('Claude Code is not installed.');
      const query = this.options.query || (await importDriver()).createQuery;
      if (input.signal.aborted) return { upstreamSessionId: sessionId, status: 'interrupted', finalText: '' };
      // A first session ID is allocated before query creation, so a crash can never silently fork.
      input.onSessionBound?.(sessionId);
      if (input.signal.aborted) return { upstreamSessionId: sessionId, status: 'interrupted', finalText: '' };
      input.emit({ type: 'state', phase: input.upstreamSessionId ? 'resuming' : 'starting' });
      const canUseTool = async (name: string, args: Record<string, any>, options: { signal?: AbortSignal }) => {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        lifetime.signal.addEventListener('abort', onAbort, { once: true });
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (lifetime.signal.aborted || options.signal?.aborted) abort.abort();
        try {
          const detailText = JSON.stringify(args);
          if (detailText.length > 24000) return { behavior: 'deny', message: 'Request is too large to display safely. Review it in Claude Code.' };
          const questions = name === 'AskUserQuestion' && Array.isArray(args.questions) ? args.questions.map((q: any, i: number) => ({
            id: String(i), prompt: String(q.question || ''), multi: !!q.multiSelect,
            options: (q.options || []).map((o: any) => ({ id: String(o.label), label: String(o.label) })),
          })) : undefined;
          const card = claudeRequestCard(name, args, input.cwd);
          const answer = await input.requestUser({ kind: questions ? 'question' : card.kind,
            title: questions ? 'Claude Code has a question' : card.title,
            detail: questions ? { cwd: input.cwd, questions } : card.detail,
            options: questions ? [{ id: 'answer', label: 'Send answer', kind: 'answer' }, { id: 'deny', label: 'Cancel', kind: 'deny' }] : [{ id: 'allow', label: 'Allow once', kind: 'allow_once' }, { id: 'deny', label: 'Deny', kind: 'deny' }],
          }, { signal: abort.signal, cancelResponse: { optionId: 'deny' } });
          if (abort.signal.aborted || !['allow', 'answer'].includes(answer.optionId)) return { behavior: 'deny', message: 'Denied by the user or the turn ended.' };
          const answers = questions ? Object.fromEntries(questions.map((q: any) => [q.prompt, (answer.answers?.[q.id] || []).join(', ')])) : undefined;
          return { behavior: 'allow', updatedInput: answers ? { ...args, answers } : args };
        } finally {
          lifetime.signal.removeEventListener('abort', onAbort);
          options.signal?.removeEventListener('abort', onAbort);
        }
      };
      // Streaming input keeps the SDK's interactive permission/control channel open.
      async function* prompt() {
        yield { type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: input.text }] } };
        // Do not close stdin while permission/control replies may still be needed.
        if (!lifetime.signal.aborted) await new Promise<void>((resolve) => lifetime.signal.addEventListener('abort', () => resolve(), { once: true }));
      }
      runtime = query({ prompt: prompt(), options: {
        pathToClaudeCodeExecutable: executable(command), cwd: input.cwd,
        ...(input.upstreamSessionId ? { resume: sessionId } : { sessionId }),
        includePartialMessages: true, canUseTool,
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort as any } : {}),
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        // Select the CLI's own prompt, never Prometheus instructions or an SDK-empty prompt.
        // SDK 0.3.326 loads all filesystem settings when omitted, exactly like the CLI.
        // Only an explicit user model selection overrides the CLI model. No tools, MCP, permission mode or settings override.
      } });
      this.active.set(input.sessionId, { close });
      input.signal.addEventListener('abort', stop, { once: true });
      if (input.signal.aborted) stop();
      for await (const message of runtime) {
        if (input.signal.aborted) break;
        if (message.session_id && message.session_id !== sessionId) throw new Error('Claude Code returned a different session identity.');
        if (message.type === 'system' && message.subtype === 'init') { model = message.model; input.emit({ type: 'state', phase: 'running' }); }
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') { text += event.delta.text; input.emit({ type: 'text_delta', text: event.delta.text }); }
          if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') input.emit({ type: 'reasoning_delta', text: event.delta.thinking });
          // Tool rows start from the full assistant block below: content_block_start
          // carries an empty input, so the row would lose its command/file label.
        }
        if (message.type === 'assistant') {
          for (const block of message.message?.content || []) {
            if (block.type === 'tool_use') { const touch = claudeFileTouch(block.name, block.input); if (touch) edits.set(block.id, touch); }
            if (block.type === 'text') resultText += block.text;
            if (block.type === 'tool_use' && !tools.has(block.id)) { tools.add(block.id); input.emit({ type: 'item_started', itemId: block.id, kind: block.name === 'Bash' || block.name === 'PowerShell' ? 'command' : 'other', title: block.name, native: claudeToolToNative(block.name, block.input) }); }
          }
        }
        if (message.type === 'user') for (const block of message.message?.content || []) {
          const touch = block.type === 'tool_result' && !block.is_error ? edits.get(block.tool_use_id) : undefined;
          if (touch) { edits.delete(block.tool_use_id); input.emit({ type: 'file_change', files: [touch] }); }
        }
        if (message.type === 'user') for (const block of message.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          if (!tools.has(block.tool_use_id)) { tools.add(block.tool_use_id); input.emit({ type: 'item_started', itemId: block.tool_use_id, kind: 'other', title: 'Tool', native: { name: '', args: {} } }); }
          input.emit({ type: 'item_completed', itemId: block.tool_use_id, kind: 'other', ok: !block.is_error, summary: block.is_error ? 'Tool failed' : 'Done', output: toolResultText(block.content) });
        }
        if (message.type === 'result') {
          completed = true; failed = message.is_error || message.subtype !== 'success';
          if (typeof message.result === 'string') resultText = message.result;
          upstreamMissing = failed && !!input.upstreamSessionId && /session.*(?:not found|does not exist)|no conversation/i.test((message.errors || []).map(String).join(' '));
          errorText = failed ? 'Claude Code could not complete this turn. Check its session and account status.' : '';
          break;
        }
      }
      return { upstreamSessionId: sessionId, status: input.signal.aborted ? 'interrupted' : failed || !completed ? 'failed' : 'completed', finalText: resultText || text, ...(upstreamMissing ? { upstreamMissing: true } : {}), ...(model ? { model } : {}), ...((errorText || !completed) && !input.signal.aborted ? { error: errorText || 'Claude Code stopped before completing the turn.' } : {}) };
    } catch (error: any) {
      const missing = !!input.upstreamSessionId && /session.*(?:not found|does not exist)|no conversation/i.test(String(error?.message));
      return { upstreamSessionId: sessionId, status: input.signal.aborted ? 'interrupted' : 'failed', finalText: resultText || text, error: missing ? 'Claude Code could not find the original session.' : 'Claude Code could not complete the turn. Check its installation and account status.', ...(missing ? { upstreamMissing: true } : {}) };
    } finally { input.signal.removeEventListener('abort', stop); close(); this.active.delete(input.sessionId); }
  }
}
