// A turn that spans one or more gateway restarts must finish as ONE turn: the
// final assistant message has to carry the pre-restart trace, the pre-restart
// file changes, and the original start time. Before this fix the final message
// only held the last resumed run ("Worked for 8s", no trace, no diff), and the
// per-restart checkpoint rows that held the earlier work did not survive warm
// handoff, so everything before the last restart vanished when the turn ended.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDurableChatTraceFromProcessEntries } from './durable-chat-trace';
import { synthesizeToolResultsFromProcessEntries } from './file-change-summary';

const router = readFileSync(path.join(__dirname, 'routes', 'chat.router.ts'), 'utf8');

// 1. Finalize path merges seeded pre-restart entries into the durable trace.
assert.match(router, /durableToolStreamTrace = \[\.\.\.preTrace, \.\.\.\(durableToolStreamTrace \|\| \[\]\)\]/,
  'final message trace must prepend the pre-restart trace');
// 2. Finalize path feeds pre-restart tool results into the end-of-turn diff.
assert.match(router, /\[\.\.\.preRestartToolResults, \.\.\.\(\(result\.toolResults/,
  'end-of-turn file changes must include pre-restart tool results');
// 3. Work duration spans from the root turn start, not the last resume.
assert.match(router, /workStartedAt: turnWorkStartedAt,/, 'final message must use the root turn start');
assert.doesNotMatch(router, /content: result\.text,\s*timestamp: Date\.now\(\),\s*workStartedAt: turnTiming\.startedAt/,
  'final message must not use the resumed-run start');
// 4. Resume carries the root start forward across chained restarts.
assert.match(router, /rootStartedAt: Number\(recoveryData\.rootStartedAt \|\| 0\) \|\|/,
  'rootStartedAt must chain from the prior runtime recovery data');

// 5. The seeded entries actually convert into a non-empty trace + tool results.
const seeded = [
  { ts: '07:00:01', type: 'tool', actor: 'Prom', content: 'workspace_run', extra: { preRestart: true, toolName: 'workspace_run', args: { command: 'git status' } } },
  { ts: '07:00:02', type: 'result', actor: 'Prom', content: 'clean', extra: { preRestart: true, toolName: 'workspace_run' } },
  { ts: '07:00:03', type: 'think', actor: 'Prom', content: 'Checking the checkout before restart.', extra: { preRestart: true, source: 'agent_thought', visibility: 'user', reasoningKind: 'full_thought' } },
];
const trace = buildDurableChatTraceFromProcessEntries(seeded) || [];
assert.ok(trace.length > 0, 'pre-restart process entries must produce durable trace entries');
assert.ok(Array.isArray(synthesizeToolResultsFromProcessEntries(seeded)), 'pre-restart entries must synthesize tool results');

console.log('restart-span-final-message regression: ok');
