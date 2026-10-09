/**
 * Replay scenarios for the shared turn loop (handleChat).
 *
 * kind 'contract'  : current behaviour we rely on. Must pass; CI fails if not.
 * kind 'known_gap' : the intended behaviour, written down before the fix. It is
 *                    expected to fail today (reported as XFAIL). When a fix
 *                    lands and it starts passing, the runner fails loudly so
 *                    the scenario gets promoted to 'contract' in the same PR.
 *
 * Every scenario runs the real runtime: prompt/context assembly, tool surface,
 * policy + approval queue, executeTool, loop detector, abort handling. Only
 * the model (ScriptedProvider) and side-effect tools (stubs) are fake.
 */
import assert from 'node:assert/strict';
import type { ReplayTurnInput, ReplayTurnRun } from './harness';
import { lastToolResultText, toolMessagesIn } from './scripted-provider';

export interface ReplayScenario {
  id: string;
  kind: 'contract' | 'known_gap';
  /** What the runtime must do, in one sentence. */
  contract: string;
  input: ReplayTurnInput;
  check(run: ReplayTurnRun): void;
}

const resultsOf = (run: ReplayTurnRun) => (Array.isArray(run.result?.toolResults) ? run.result.toolResults : []);

export const scenarios: ReplayScenario[] = [
  {
    id: 'text-answer',
    kind: 'contract',
    contract: 'A plain answer takes one model call, streams once and ends with exactly one final response.',
    input: { message: 'Say hello', script: [{ text: 'Hello Raul.' }] },
    check(run) {
      assert.equal(run.error, null);
      assert.equal(run.result?.text, 'Hello Raul.');
      assert.equal(run.provider.requests.length, 1);
      assert.equal(run.finalEvents, 1, 'exactly one final_response_start');
      assert.deepEqual(run.dispatched, []);
      assert.ok(run.provider.requests[0].toolNames.length > 0, 'model is offered a tool surface');
    },
  },
  {
    id: 'tool-round-trip',
    kind: 'contract',
    contract: 'A tool call executes once and its result goes back to the model under the same tool_call_id.',
    input: {
      message: 'List coding skills',
      script: [{ toolCalls: [{ id: 'call_rt', name: 'skill_list', args: { query: 'coding' } }] }, { text: 'Listed.' }],
    },
    check(run) {
      assert.equal(run.result?.text, 'Listed.');
      assert.deepEqual(run.dispatched, ['skill_list']);
      assert.equal(run.provider.requests.length, 2);
      const fed = toolMessagesIn(run.provider.requests[1]);
      assert.equal(fed.length, 1);
      assert.equal(fed[0].tool_call_id, 'call_rt');
      assert.match(lastToolResultText(run.provider.requests[1]), /totalInstalled/);
      assert.equal(run.finalEvents, 1);
    },
  },
  {
    id: 'parallel-tool-results-paired',
    kind: 'contract',
    contract: 'Two tool calls in one step both execute and each result is paired with its own tool_call_id.',
    input: {
      message: 'Fetch and list',
      tools: { web_fetch: (args) => ({ result: `body of ${args.url}` }) },
      script: [
        { toolCalls: [
          { id: 'call_a', name: 'web_fetch', args: { url: 'https://a.test' } },
          { id: 'call_b', name: 'skill_list', args: { query: 'x' } },
        ] },
        { text: 'Both done.' },
      ],
    },
    check(run) {
      assert.deepEqual([...run.dispatched].sort(), ['skill_list', 'web_fetch']);
      const fed = toolMessagesIn(run.provider.requests[1]);
      const byId = new Map(fed.map((m) => [m.tool_call_id, String(m.content)]));
      assert.match(byId.get('call_a') || '', /body of https:\/\/a\.test/);
      assert.match(byId.get('call_b') || '', /totalInstalled/);
      assert.equal(run.result?.text, 'Both done.');
    },
  },
  {
    id: 'tool-crash-is-reported',
    kind: 'contract',
    contract: 'A tool that throws becomes an error result the model can see; the turn continues.',
    input: {
      message: 'Fetch it',
      tools: { web_fetch: () => { throw new Error('socket exploded'); } },
      script: [{ toolCalls: [{ name: 'web_fetch', args: { url: 'https://example.com' } }] }, { text: 'Handled the failure.' }],
    },
    check(run) {
      const [first] = resultsOf(run);
      assert.equal(first?.error, true);
      assert.match(String(first?.result), /socket exploded/);
      assert.match(lastToolResultText(run.provider.requests[1]), /socket exploded/);
      assert.equal(run.result?.text, 'Handled the failure.');
    },
  },
  {
    id: 'approval-granted-executes',
    kind: 'contract',
    contract: 'A commit-tier tool waits for approval and runs once it is approved.',
    input: {
      message: 'Write a note',
      approvals: 'approve',
      script: [{ toolCalls: [{ name: 'write_note', args: { content: 'replay approved note' } }] }, { text: 'Noted.' }],
    },
    check(run) {
      assert.deepEqual(run.approvals.map((a) => `${a.toolName}:${a.decision}`), ['write_note:approved']);
      const [first] = resultsOf(run);
      assert.equal(first?.error, false);
      assert.match(String(first?.result), /Note saved/);
    },
  },
  {
    id: 'approval-denied-blocks',
    kind: 'contract',
    contract: 'A denied approval stops the tool and tells the model it was denied.',
    input: {
      message: 'Write a note',
      approvals: 'deny',
      script: [{ toolCalls: [{ name: 'write_note', args: { content: 'replay denied note' } }] }, { text: 'Understood.' }],
    },
    check(run) {
      assert.deepEqual(run.approvals.map((a) => `${a.toolName}:${a.decision}`), ['write_note:denied']);
      const [first] = resultsOf(run);
      assert.equal(first?.error, true);
      assert.match(String(first?.result), /denied/i);
      assert.match(lastToolResultText(run.provider.requests[1]), /denied/i);
    },
  },
  {
    id: 'abort-during-generation',
    kind: 'contract',
    contract: 'Stopping a turn while the model is generating ends it promptly with no final answer.',
    input: { message: 'Write a long essay', abortAfterMs: 300, timeoutMs: 15_000, script: [{ text: 'never sent', delayMs: 20_000 }] },
    check(run) {
      assert.equal(run.aborted, true);
      assert.equal(run.timedOut, false);
      assert.ok(run.elapsedMs < 3_000, `turn ended ${run.elapsedMs}ms after start`);
      assert.equal(run.finalEvents, 0);
      assert.notEqual(run.result?.text, 'never sent');
    },
  },
  {
    id: 'abort-during-tool-stops-loop',
    kind: 'contract',
    contract: 'Stopping a turn while a tool runs never sends another model request.',
    input: {
      message: 'Fetch slowly',
      abortAfterMs: 300,
      timeoutMs: 15_000,
      tools: { web_fetch: async () => { await new Promise((r) => setTimeout(r, 1_500)); return { result: 'page body' }; } },
      script: [{ toolCalls: [{ name: 'web_fetch', args: { url: 'https://example.com' } }] }, { text: 'should never be requested' }],
    },
    check(run) {
      assert.equal(run.aborted, true);
      assert.equal(run.timedOut, false);
      assert.equal(run.provider.requests.length, 1, 'no model call after the abort');
      assert.equal(run.finalEvents, 0);
    },
  },
  {
    id: 'provider-error-is-not-success',
    kind: 'contract',
    contract: 'A provider failure surfaces as an error, never as a successful answer.',
    input: { message: 'Say hi', script: [{ throw: 'ECONNRESET socket hang up' }, { text: 'Hi (should not appear).' }] },
    check(run) {
      assert.match(String(run.result?.text ?? run.error?.message ?? ''), /ECONNRESET/);
      assert.notEqual(run.result?.text, 'Hi (should not appear).');
      assert.equal(run.finalEvents, 0);
    },
  },
  {
    id: 'loop-detector-blocks-repeats',
    kind: 'contract',
    contract: 'Identical repeated tool calls stop executing after a handful and the model is told why.',
    input: {
      message: 'Keep listing',
      script: Array.from({ length: 12 }, () => ({ toolCalls: [{ name: 'skill_list', args: { query: 'loop' } }] })),
      providerOptions: { onExhausted: 'final_text', exhaustedText: 'Stopping.' },
    },
    check(run) {
      const results = resultsOf(run);
      const executed = results.filter((r: any) => !r.error).length;
      assert.ok(executed <= 6, `identical call executed ${executed} times`);
      assert.ok(results.some((r: any) => /Loop detector/.test(String(r.result))), 'model saw a loop-detector message');
    },
  },
  {
    id: 'harness-blocks-unstubbed-side-effects',
    kind: 'contract',
    contract: 'Replay safety: a side-effect tool with no stub is blocked and never touches the machine.',
    input: { message: 'Run a command', script: [{ toolCalls: [{ name: 'run_command', args: { command: 'echo hi' } }] }, { text: 'Ok.' }] },
    check(run) {
      assert.deepEqual(run.blockedTools, ['run_command']);
      assert.match(String(resultsOf(run)[0]?.result), /blocked in the replay harness/);
    },
  },

  // ── Known gaps: intended behaviour, expected to fail until fixed ──────────
  {
    id: 'unknown-tool-needs-no-approval',
    kind: 'known_gap',
    contract: 'A tool that does not exist fails immediately; the user is never asked to approve it.',
    input: {
      message: 'Do it',
      approvals: 'approve',
      timeoutMs: 8_000,
      script: [{ toolCalls: [{ name: 'definitely_not_a_tool', args: {} }] }, { text: 'Recovered.' }],
    },
    check(run) {
      // Today an approval card is raised for the nonexistent tool first; with
      // nobody to approve it the turn hangs until the user answers.
      assert.deepEqual(run.approvals, [], 'no approval for a nonexistent tool');
      assert.match(String(resultsOf(run)[0]?.result), /Unknown tool/);
    },
  },
  {
    id: 'tool-outside-surface-is-refused',
    kind: 'known_gap',
    contract: 'The runtime only executes tools that were offered to the model this turn.',
    input: {
      message: 'Take a screenshot',
      // Stubbed so that, if it is dispatched, it "succeeds" harmlessly.
      tools: { desktop_screenshot: () => ({ result: 'captured (stub)' }) },
      script: [{ toolCalls: [{ name: 'desktop_screenshot', args: {} }] }, { text: 'Ok.' }],
    },
    check(run) {
      assert.ok(!run.provider.requests[0].toolNames.includes('desktop_screenshot'), 'precondition: not offered');
      // Today it is dispatched and executes anyway (a real screenshot without the harness stub).
      assert.ok(!run.dispatched.includes('desktop_screenshot'), 'un-offered tool reached executeTool');
    },
  },
  {
    id: 'abort-releases-pending-approval',
    kind: 'known_gap',
    contract: 'Stopping a turn that is waiting on an approval ends it promptly.',
    input: {
      message: 'Write a note',
      approvals: 'leave_pending',
      abortAfterMs: 500,
      timeoutMs: 6_000,
      script: [{ toolCalls: [{ name: 'write_note', args: { content: 'pending note' } }] }, { text: 'after' }],
    },
    check(run) {
      assert.equal(run.aborted, true);
      assert.equal(run.timedOut, false, 'turn kept waiting on the approval after Stop');
      assert.ok(run.elapsedMs < 3_000, `turn ended ${run.elapsedMs}ms after start`);
    },
  },
  {
    id: 'runaway-turn-has-a-ceiling',
    kind: 'known_gap',
    contract: 'A model that keeps repeating a blocked call is stopped by the runtime, not by running out of script.',
    input: {
      message: 'Keep listing',
      script: Array.from({ length: 60 }, () => ({ toolCalls: [{ name: 'skill_list', args: { query: 'loop' } }] })),
      providerOptions: { onExhausted: 'throw' },
      timeoutMs: 30_000,
    },
    check(run) {
      assert.ok(run.provider.requests.length <= 30, `turn made ${run.provider.requests.length} model calls`);
      assert.equal(run.error, null);
    },
  },
  {
    id: 'malformed-tool-args-are-reported',
    kind: 'known_gap',
    contract: 'Truncated/invalid tool-call JSON is reported to the model instead of running the tool with {}.',
    input: {
      message: 'List skills',
      script: [{ toolCalls: [{ name: 'skill_list', rawArguments: '{"query": "cod' }] }, { text: 'Retried.' }],
    },
    check(run) {
      const reported = /invalid|malformed|parse|json/i.test(lastToolResultText(run.provider.requests[1] || run.provider.requests[0]));
      assert.ok(reported || !run.dispatched.includes('skill_list'), 'tool ran with dropped arguments and the model was not told');
    },
  },
];
