import { execFile } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { findOnPath, resolveFromCandidates, type ResolvedCommand } from '../executable';
import type { ExternalAgentAdapter, ExternalAgentCapabilities, ExternalTurnInput, ExternalTurnResult, ExternalAgentVerifyResult } from '../types';

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
          const answer = await input.requestUser({ kind: questions ? 'question' : name === 'Bash' ? 'command' : 'permissions',
            title: questions ? 'Claude Code has a question' : `Claude Code: ${name}`,
            detail: { cwd: input.cwd, ...(name === 'Bash' ? { command: String(args.command || '') } : { reason: detailText }), ...(questions ? { questions } : {}) },
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
          if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const tool = event.content_block; tools.add(tool.id);
            input.emit({ type: 'item_started', itemId: tool.id, kind: 'other', title: tool.name });
          }
        }
        if (message.type === 'assistant') {
          for (const block of message.message?.content || []) {
            if (block.type === 'text') resultText += block.text;
            if (block.type === 'tool_use' && !tools.has(block.id)) { tools.add(block.id); input.emit({ type: 'item_started', itemId: block.id, kind: 'other', title: block.name }); }
          }
        }
        if (message.type === 'user') for (const block of message.message?.content || []) {
          if (block.type === 'tool_result') input.emit({ type: 'item_completed', itemId: block.tool_use_id, kind: 'other', ok: !block.is_error, summary: block.is_error ? 'Tool failed' : 'Completed in Claude Code' });
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
