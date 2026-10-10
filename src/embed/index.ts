/**
 * Prometheus embedding API.
 *
 * Runs the real Prometheus agent loop (context assembly, tool surface,
 * dispatch policy, approvals, tool execution, loop control, compaction)
 * inside your own Node process: no HTTP gateway, no Electron, no UI.
 *
 *   const { createPrometheusRuntime } = require('prometheus/embed');
 *   const rt = await createPrometheusRuntime({ dataDir: '/tmp/prom', provider: myProvider });
 *   rt.registerTool({ name: 'lookup_order', description: '…', parameters: {…}, readOnly: true,
 *                     execute: async (args) => `order ${args.id}: shipped` });
 *   const run = await rt.runTurn('Where is order 42?', { onEvent: (e) => console.log(e.type) });
 *   console.log(run.text);
 *   await rt.close();
 *
 * What you control: the model (any LLMProvider, or the provider configured in
 * dataDir), extra tools, the approval decision for gated tools, the tool
 * allowlist, and cancellation. What you do not control: the dispatch policy.
 * Embedded tools pass through the same offered-surface, allowlist and
 * approval checks as built-in tools (see SECURITY.md).
 *
 * One runtime per process. The runtime binds module-level singletons
 * (config dir, approval queue, provider factory) the first time it starts.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LLMProvider } from '../providers/LLMProvider';
import type { PrometheusToolExecutionResult } from '../extensions/runtime-api';

export type { LLMProvider, ChatMessage, ChatOptions, ChatResult, ToolCall } from '../providers/LLMProvider';

export const EMBED_API_VERSION = 1 as const;

export interface EmbeddedTool {
  name: string;
  description: string;
  /** JSON schema for the arguments object. */
  parameters: Record<string, any>;
  /**
   * Declare side effects. Omitted metadata fails closed: an undeclared tool
   * is treated as unknown-risk and needs approval.
   */
  readOnly?: boolean;
  localWrite?: boolean;
  externalWrite?: boolean;
  destructive?: boolean;
  execute(args: any): Promise<string | { result: string; error?: boolean }> | string | { result: string; error?: boolean };
}

export interface PendingApproval {
  id: string;
  toolName: string;
  sessionId: string;
  action?: string;
  args?: unknown;
}

export interface RuntimeEvent {
  type: string;
  data: any;
}

export interface CreateRuntimeOptions {
  /** Directory for config, sessions and runtime state. Created if missing. Default: a fresh temp dir. */
  dataDir?: string;
  /** Agent workspace (files the agent may read/write). Default: <dataDir>/workspace. */
  workspaceDir?: string;
  /**
   * Model provider. Omit to use the provider configured in
   * <dataDir>/.prometheus/config.json (llm.provider + credentials).
   */
  provider?: LLMProvider;
  /**
   * Decide gated tool calls (shell outside the workspace, external writes,
   * undeclared tools…). Return true to allow. Default: deny everything.
   */
  approve?: (approval: PendingApproval) => boolean | Promise<boolean>;
  /** Print runtime logs. Default false. */
  verbose?: boolean;
}

export interface RunTurnOptions {
  /** Reuse a session id to continue a conversation. Default: a new session. */
  sessionId?: string;
  /** Stream events: token, thinking, tool_call, tool_result, done, … */
  onEvent?: (event: RuntimeEvent) => void;
  /** Cancel the turn. */
  signal?: AbortSignal;
  /** Restrict the agent to exactly these tool names (enforced at dispatch). */
  allowedTools?: string[];
  /** Tool categories to activate up front, e.g. ['workspace_write']. */
  categories?: string[];
  /** Hard ceiling for the turn. Default 10 minutes. */
  timeoutMs?: number;
}

export interface TurnResult {
  sessionId: string;
  text: string;
  toolResults: Array<{ name: string; result: string; error: boolean }>;
  aborted: boolean;
  timedOut: boolean;
  elapsedMs: number;
}

export interface PrometheusRuntime {
  readonly dataDir: string;
  readonly workspaceDir: string;
  runTurn(message: string, options?: RunTurnOptions): Promise<TurnResult>;
  /** Register an extra tool. It is offered under the external_apps category. */
  registerTool(tool: EmbeddedTool): void;
  unregisterTool(name: string): boolean;
  /** Release timers and handles so the process can exit. */
  close(): Promise<void>;
}

const EMBED_EXTENSION_ID = 'embedded-host';
let activeRuntime: PrometheusRuntime | null = null;

function quietConsole(verbose: boolean): () => void {
  if (verbose) return () => undefined;
  const original = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
  console.log = () => undefined;
  console.info = () => undefined;
  console.warn = () => undefined;
  console.debug = () => undefined;
  return () => Object.assign(console, original);
}

export async function createPrometheusRuntime(options: CreateRuntimeOptions = {}): Promise<PrometheusRuntime> {
  if (activeRuntime) throw new Error('A Prometheus runtime is already active in this process. Call close() first.');

  const dataDir = path.resolve(options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-embed-')));
  const workspaceDir = path.resolve(options.workspaceDir || path.join(dataDir, 'workspace'));
  const skillsDir = path.join(dataDir, 'skills');
  for (const dir of [dataDir, workspaceDir, skillsDir]) fs.mkdirSync(dir, { recursive: true });

  // These must be set before any config module loads (config dir is resolved at import time).
  process.env.PROMETHEUS_DATA_DIR = dataDir;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspaceDir;
  process.env.PROMETHEUS_MODEL_CALL_WORKERS = process.env.PROMETHEUS_MODEL_CALL_WORKERS || '0';
  if (options.provider && process.env.NODE_ENV === 'production') {
    // The provider override is a deliberate embedder choice, not a test hook.
    process.env.PROMETHEUS_ALLOW_PROVIDER_OVERRIDE = '1';
  }

  const verbose = options.verbose === true;
  const restore = quietConsole(verbose);
  let factory: typeof import('../providers/factory');
  let router: any;
  let approvals: typeof import('../gateway/verification-flow');
  let registryApi: typeof import('../extensions/runtime-registry');
  let sessions: typeof import('../gateway/session');
  try {
    factory = require('../providers/factory');
    router = require('../gateway/routes/chat.router');
    const { SkillsManager } = require('../gateway/skills-runtime/skills-manager') as typeof import('../gateway/skills-runtime/skills-manager');
    approvals = require('../gateway/verification-flow');
    registryApi = require('../extensions/runtime-registry');
    sessions = require('../gateway/session');
    router.initChatRouter({ skillsManager: new SkillsManager(skillsDir), telegramChannel: null, cronScheduler: null });
  } finally {
    restore();
  }
  if (options.provider) factory.setProviderOverrideForTesting(options.provider);

  const registry = registryApi.getExtensionRuntimeRegistry();
  const embeddedToolNames = new Set<string>();
  const approve = options.approve || (() => false);
  let sessionSeq = 0;
  let closed = false;

  const runtime: PrometheusRuntime = {
    dataDir,
    workspaceDir,

    registerTool(tool: EmbeddedTool) {
      if (closed) throw new Error('runtime is closed');
      const name = String(tool?.name || '').trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(name)) throw new Error(`Invalid tool name "${name}"`);
      const declared = [tool.readOnly, tool.localWrite, tool.externalWrite, tool.destructive].some((v) => v !== undefined);
      registry.registerTool(EMBED_EXTENSION_ID, {
        name,
        description: String(tool.description || ''),
        parameters: tool.parameters || { type: 'object', properties: {} },
        sideEffects: {
          readOnly: tool.readOnly === true,
          localWrite: tool.localWrite === true,
          externalWrite: tool.externalWrite === true,
          destructive: tool.destructive === true,
          credentialUse: false,
          known: declared,
        },
        async execute(args: any): Promise<PrometheusToolExecutionResult> {
          try {
            const out = await tool.execute(args);
            if (typeof out === 'string') return { result: out, error: false };
            return { result: String(out?.result ?? ''), error: out?.error === true };
          } catch (err: any) {
            return { result: `${name} failed: ${err?.message || err}`, error: true };
          }
        },
      });
      embeddedToolNames.add(name);
    },

    unregisterTool(name: string) {
      embeddedToolNames.delete(name);
      return registry.unregisterTool(name, EMBED_EXTENSION_ID);
    },

    async runTurn(message: string, turnOptions: RunTurnOptions = {}): Promise<TurnResult> {
      if (closed) throw new Error('runtime is closed');
      sessionSeq += 1;
      const sessionId = turnOptions.sessionId || `embed_${Date.now().toString(36)}_${sessionSeq}`;
      const categories = new Set(turnOptions.categories || []);
      if (embeddedToolNames.size) categories.add('external_apps');
      for (const category of categories) sessions.activateToolCategory(sessionId, category);

      const controller = new AbortController();
      const abortSignal: { aborted: boolean; signal?: AbortSignal } = { aborted: false, signal: controller.signal };
      const abort = () => { abortSignal.aborted = true; controller.abort(); };
      if (turnOptions.signal) {
        if (turnOptions.signal.aborted) abort();
        else turnOptions.signal.addEventListener('abort', abort, { once: true });
      }

      const queue = approvals.getApprovalQueue();
      const handled = new Set<string>();
      const approvalPoll = setInterval(() => {
        for (const record of queue.listPending()) {
          if (record.sessionId !== sessionId || handled.has(record.id)) continue;
          handled.add(record.id);
          Promise.resolve(approve({ id: record.id, toolName: record.toolName, sessionId, action: record.action, args: record.toolArgs }))
            .then((ok) => queue.resolve(record.id, ok === true, 'embed-host'))
            .catch(() => queue.resolve(record.id, false, 'embed-host'));
        }
      }, 25);

      const startedAt = Date.now();
      let timedOut = false;
      const timeoutMs = Math.max(1_000, Number(turnOptions.timeoutMs) || 10 * 60_000);
      const ceiling = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
      const restoreConsole = quietConsole(verbose);
      try {
        const sendSSE = (type: string, data: any) => {
          try { turnOptions.onEvent?.({ type, data }); } catch { /* host callback errors never break the turn */ }
        };
        const result = await router.handleChat(
          message,
          sessionId,
          sendSSE,
          undefined,
          abortSignal,
          undefined,
          undefined,
          'interactive',
          turnOptions.allowedTools && turnOptions.allowedTools.length ? turnOptions.allowedTools : undefined,
        );
        const toolResults = Array.isArray(result?.toolResults)
          ? result.toolResults.map((r: any) => ({ name: String(r?.name || ''), result: String(r?.result ?? ''), error: r?.error === true }))
          : [];
        return {
          sessionId,
          text: String(result?.text || ''),
          toolResults,
          aborted: abortSignal.aborted && !timedOut,
          timedOut,
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        restoreConsole();
        clearInterval(approvalPoll);
        clearTimeout(ceiling);
        turnOptions.signal?.removeEventListener('abort', abort);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const name of embeddedToolNames) registry.unregisterTool(name, EMBED_EXTENSION_ID);
      embeddedToolNames.clear();
      if (options.provider) factory.setProviderOverrideForTesting(null);
      try {
        const live = require('../gateway/live-runtime-registry') as typeof import('../gateway/live-runtime-registry');
        await live.flushLiveRuntimePersistence();
      } catch { /* best effort */ }
      try {
        const session = require('../gateway/session') as any;
        if (typeof session.flushAllSessions === 'function') await session.flushAllSessions();
      } catch { /* best effort */ }
      activeRuntime = null;
    },
  };

  activeRuntime = runtime;
  return runtime;
}
