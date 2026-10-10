/**
 * Replay harness: drives the real handleChat turn loop headless against a
 * scripted model. No gateway HTTP server, Electron, browser, network or real
 * provider is involved; everything lives under a throwaway data dir.
 *
 *   const h = await bootReplayHarness();
 *   const run = await h.runTurn({ message: 'hi', script: [{ text: 'hello' }] });
 *   assert.equal(run.result.text, 'hello');
 *
 * Boot once per process (importing chat.router costs a few seconds), then run
 * many scenarios with fresh session ids. Approvals raised by the policy layer
 * are resolved by the scenario's `approvals` policy; abort is driven by
 * `abortAfterMs`. Every model request, SSE event and approval is recorded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScriptedProvider, type ScriptStep, type ScriptedProviderOptions } from './scripted-provider';

export type ApprovalPolicy = 'approve' | 'deny' | 'leave_pending' | ((record: any) => boolean | 'leave_pending');

export interface StubToolResult {
  result: string;
  error?: boolean;
}

/** A stub returns the tool result, or throws to simulate a crashing tool. */
export type ToolStub = (args: any, callIndex: number) => StubToolResult | Promise<StubToolResult>;

/**
 * Tools with real side effects outside the throwaway data dir. They are
 * blocked unless a scenario stubs them, so a replay can never touch the real
 * desktop, browser, shell, network, accounts or the live gateway.
 */
const SIDE_EFFECT_TOOL = /^(desktop_|browser_|run_command$|start_process$|workspace_run$|workspace_edit$|workspace_git$|workspace_safety$|delivery_send$|connector_|x_|tool_call$|gateway_|web_search$|web_fetch$|shopping_|chatgpt_sandbox$|clone_repo$|background_ops$|timer$|update_heartbeat$|set_current_model$|media_|creative_|show_ui_card$|request_browser_login$|request_final_action_approval$)/;

export interface ReplayTurnInput {
  message: string;
  script: ScriptStep[];
  providerOptions?: ScriptedProviderOptions;
  sessionId?: string;
  executionMode?: string;
  approvals?: ApprovalPolicy;
  /**
   * Stubbed tools. A stub replaces execution entirely (it runs before policy,
   * so stubbed tools skip approval). Side-effect tools without a stub are
   * blocked with an error result and recorded in `blockedTools`.
   */
  tools?: Record<string, ToolStub>;
  /** Abort the turn this many ms after it starts. */
  abortAfterMs?: number;
  /** Hard ceiling; the harness aborts and marks timedOut when exceeded. */
  timeoutMs?: number;
}

export interface ReplayApproval {
  id: string;
  toolName: string;
  decision: 'approved' | 'denied' | 'pending';
}

export interface ReplayTurnRun {
  sessionId: string;
  result: any;
  error: Error | null;
  events: Array<{ event: string; data: any; at: number }>;
  provider: ScriptedProvider;
  approvals: ReplayApproval[];
  elapsedMs: number;
  timedOut: boolean;
  aborted: boolean;
  /** Names of tools the runtime actually reported executing, in order. */
  toolNames: string[];
  /** Every tool name that reached executeTool (dispatch), in order. */
  dispatched: string[];
  /** Side-effect tools that reached dispatch without a stub and were blocked. */
  blockedTools: string[];
  /** Terminal SSE events that carry the final answer. */
  finalEvents: number;
  eventNames(): string[];
}

export interface ReplayHarness {
  root: string;
  workspace: string;
  runTurn(input: ReplayTurnInput): Promise<ReplayTurnRun>;
  shutdown(): void;
}

let sessionSeq = 0;

export async function bootReplayHarness(options: { quiet?: boolean } = {}): Promise<ReplayHarness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-replay-'));
  const workspace = path.join(root, 'workspace');
  const skillsDir = path.join(root, 'skills');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  // Keep model calls in-process so the scripted provider is the one called.
  process.env.PROMETHEUS_MODEL_CALL_WORKERS = '0';

  const restoreConsole = options.quiet === false ? () => undefined : silenceConsole();
  // Load through require, never native import(). Under tsx a dynamic import()
  // of a .ts file goes through the ESM loader and yields a second module graph
  // with its own singletons (approval queue, provider factory, sessions), so a
  // scenario would talk to different instances than the runtime. The compiled
  // gateway (tsc -> CommonJS) has a single graph; require matches that.
  const factory = require('../../providers/factory') as typeof import('../../providers/factory');
  const router: any = require('../../gateway/routes/chat.router');
  const { SkillsManager } = require('../../gateway/skills-runtime/skills-manager') as typeof import('../../gateway/skills-runtime/skills-manager');
  const { getApprovalQueue } = require('../../gateway/verification-flow') as typeof import('../../gateway/verification-flow');
  const executor = require('../../gateway/agents-runtime/subagent-executor') as typeof import('../../gateway/agents-runtime/subagent-executor');
  router.initChatRouter({
    skillsManager: new SkillsManager(skillsDir),
    telegramChannel: null,
    cronScheduler: null,
  });
  restoreConsole();

  async function runTurn(input: ReplayTurnInput): Promise<ReplayTurnRun> {
    sessionSeq += 1;
    const sessionId = input.sessionId || `replay_${Date.now().toString(36)}_${sessionSeq}`;
    const provider = new ScriptedProvider(input.script, input.providerOptions);
    factory.setProviderOverrideForTesting(provider);
    const dispatched: string[] = [];
    const blockedTools: string[] = [];
    const stubCalls = new Map<string, number>();
    executor.setToolExecutionOverrideForTesting(async (name, args, toolSessionId) => {
      if (toolSessionId !== sessionId) return null;
      dispatched.push(name);
      const stub = input.tools?.[name];
      if (stub) {
        const index = stubCalls.get(name) ?? 0;
        stubCalls.set(name, index + 1);
        const out = await stub(args, index);
        return { name, args, result: out.result, error: out.error === true };
      }
      if (SIDE_EFFECT_TOOL.test(name)) {
        blockedTools.push(name);
        return { name, args, result: `[replay] ${name} is blocked in the replay harness (no stub provided).`, error: true };
      }
      return null;
    });
    const events: ReplayTurnRun['events'] = [];
    const approvals: ReplayApproval[] = [];
    const seenApprovals = new Set<string>();
    const startedAt = Date.now();
    const controller = new AbortController();
    const abortSignal: { aborted: boolean; signal?: AbortSignal } = { aborted: false, signal: controller.signal };
    const abort = () => {
      abortSignal.aborted = true;
      controller.abort();
    };
    let aborted = false;
    let timedOut = false;
    const timers: NodeJS.Timeout[] = [];
    if (typeof input.abortAfterMs === 'number') {
      timers.push(setTimeout(() => { aborted = true; abort(); }, input.abortAfterMs));
    }
    const policy = input.approvals ?? 'approve';
    const queue = getApprovalQueue();
    const approvalPoll = setInterval(() => {
      for (const record of queue.listPending()) {
        if (record.sessionId !== sessionId || seenApprovals.has(record.id)) continue;
        seenApprovals.add(record.id);
        const decision = typeof policy === 'function' ? policy(record) : policy;
        if (decision === 'leave_pending') {
          approvals.push({ id: record.id, toolName: record.toolName, decision: 'pending' });
          continue;
        }
        const approved = decision === true || decision === 'approve';
        approvals.push({ id: record.id, toolName: record.toolName, decision: approved ? 'approved' : 'denied' });
        queue.resolve(record.id, approved, 'replay-harness');
      }
    }, 10);

    const timeoutMs = input.timeoutMs ?? 60_000;
    let result: any = null;
    let error: Error | null = null;
    const restoreConsole = silenceConsole();
    try {
      const turn = router.handleChat(
        input.message,
        sessionId,
        (event: string, data: any) => events.push({ event, data, at: Date.now() - startedAt }),
        undefined,
        abortSignal,
        undefined,
        undefined,
        input.executionMode || 'interactive',
      );
      const ceiling = new Promise<'timeout'>((resolve) => {
        timers.push(setTimeout(() => resolve('timeout'), timeoutMs));
      });
      const outcome = await Promise.race([turn, ceiling]);
      if (outcome === 'timeout') {
        timedOut = true;
        abort();
        result = await Promise.race([turn.catch(() => null), new Promise((r) => setTimeout(() => r(null), 5_000))]);
      } else {
        result = outcome;
      }
    } catch (err: any) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      restoreConsole();
      clearInterval(approvalPoll);
      timers.forEach(clearTimeout);
      factory.setProviderOverrideForTesting(null);
      executor.setToolExecutionOverrideForTesting(null);
    }

    const toolNames = Array.isArray(result?.toolResults)
      ? result.toolResults.map((entry: any) => String(entry?.name || ''))
      : [];
    return {
      sessionId,
      result,
      error,
      events,
      provider,
      approvals,
      elapsedMs: Date.now() - startedAt,
      timedOut,
      aborted,
      toolNames,
      dispatched,
      blockedTools,
      finalEvents: events.filter((entry) => entry.event === 'final_response_start').length,
      eventNames: () => events.map((entry) => entry.event),
    };
  }

  return {
    root,
    workspace,
    runTurn,
    shutdown() {
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch {}
    },
  };
}

function silenceConsole(): () => void {
  if (process.env.REPLAY_VERBOSE === '1') return () => undefined;
  const original = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
  console.log = () => undefined;
  console.info = () => undefined;
  console.warn = () => undefined;
  console.debug = () => undefined;
  return () => Object.assign(console, original);
}
