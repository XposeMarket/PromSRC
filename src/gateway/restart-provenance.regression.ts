import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  describeTurnAbortCause,
  describeRestartProvenance,
  buildPreRestartWorkDigest,
} from './routes/chat.router';

// 1. Abort cause: a gateway restart must never be recorded as a user cancel.
assert.match(describeTurnAbortCause({ aborted: true, reason: 'gateway_restart' }), /^Gateway restart interrupted/);
assert.match(describeTurnAbortCause({ aborted: true, reason: 'main_chat_owner_watchdog_timeout' }), /^Gateway watchdog interrupted/);
assert.match(describeTurnAbortCause({ aborted: true, reason: 'SIGTERM shutdown' }), /not a user cancellation/);
assert.equal(describeTurnAbortCause({ aborted: true }), 'User cancelled the active turn.');
assert.equal(describeTurnAbortCause({ aborted: true, reason: 'user_stop' }), 'User cancelled the active turn.');

// 2. Provenance: planned (own gateway_restart) vs unplanned drop vs watchdog.
const now = Date.now();
const planned = describeRestartProvenance({ checkpoint: { toolName: 'gateway_restart' }, interruptReason: 'gateway_restart', interruptedAt: now - 9000 });
assert.match(planned, /PLANNED\. You \(Prometheus, in this chat\) started this restart yourself by calling gateway_restart/);
assert.match(planned, /down for about 9s/);
const crash = describeRestartProvenance({ checkpoint: { toolName: 'workspace_run' }, interruptReason: 'gateway_restart', interruptedAt: now - 4000 });
assert.match(crash, /UNPLANNED/);
assert.doesNotMatch(crash, /started this restart yourself/);
const watchdog = describeRestartProvenance({ checkpoint: { toolName: 'background_ops' }, interruptReason: 'main_chat_owner_watchdog_timeout' });
assert.match(watchdog, /UNPLANNED\. The gateway watchdog interrupted/);

// 3. Digest carries completed results, skips Preparing noise, stays bounded.
const digest = buildPreRestartWorkDigest({
  checkpoint: {
    narrationTail: 'Merged #401, restarting now.',
    processEntries: [
      { type: 'info', content: 'Processing...' },
      { type: 'tool', content: 'Preparing connector_github_merge_pr', extra: { toolName: 'connector_github_merge_pr' } },
      { type: 'result', content: 'Pull request merged: c38389347', extra: { toolName: 'connector_github_merge_pr' } },
      { type: 'error', content: 'push exited 1 (stderr progress)', extra: { toolName: 'workspace_run' } },
    ],
  },
});
assert.match(digest, /result connector_github_merge_pr: Pull request merged: c38389347/);
assert.match(digest, /error workspace_run/);
assert.doesNotMatch(digest, /Preparing/);
assert.match(digest, /Last thing you told the user before the restart: "Merged #401, restarting now\."/);
const many = Array.from({ length: 400 }, (_, i) => ({ type: 'result', content: `step ${i} ${'x'.repeat(200)}` }));
const bounded = buildPreRestartWorkDigest({ checkpoint: { processEntries: many } }, 3000);
assert.ok(bounded.length < 3400, `digest must stay bounded, got ${bounded.length}`);
assert.match(bounded, /step 399/, 'newest step must survive truncation');
assert.match(bounded, /earlier step\(s\) omitted/);
assert.equal(buildPreRestartWorkDigest({ checkpoint: {} }), '');
// Runtime-checkpoint entries store the payload in `text`, not `content`.
const textShaped = buildPreRestartWorkDigest({
  checkpoint: { processEntries: [{ type: 'result', text: 'Note saved [task] -> intraday-notes', extra: { toolName: 'write_note' } }] },
});
assert.match(textShaped, /result write_note: Note saved/, 'text-shaped checkpoint entries must be digested');

// 4. Real ledger smoke (skipped when the file is absent, e.g. CI).
const ledger = 'C:/Users/rafel/AppData/Roaming/Prometheus/.prometheus/runtimes/active-runtimes.json.bak';
if (existsSync(ledger)) {
  const parsed = JSON.parse(readFileSync(ledger, 'utf8'));
  const list: any[] = Array.isArray(parsed.runtimes) ? parsed.runtimes : Object.values(parsed.runtimes || {});
  const sample = list.find((r) => r?.kind === 'main_chat' && Array.isArray(r?.checkpoint?.processEntries) && r.checkpoint.processEntries.length > 20);
  if (sample) {
    const real = buildPreRestartWorkDigest(sample);
    console.log(`real-ledger digest: ${real.length} chars, ${(real.match(/\n- /g) || []).length} steps`);
    console.log(real.split('\n').slice(0, 4).join('\n'));
  }
}

console.log('restart-provenance regression: ok');
