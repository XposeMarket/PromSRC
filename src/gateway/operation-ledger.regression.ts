import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OperationLedger, operationIdempotencyKey, isExternalSideEffect } from './operation-ledger';

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-ledger-'));
  let checks = 0;
  const check = (fn: () => void) => { fn(); checks++; };
  try {
    let now = Date.now();
    const file = path.join(dir, 'ledger.jsonl');
    const ledger = new OperationLedger(file, () => now);
    const input = { sessionId: 'session-a', toolName: 'connector_gmail_send_email', args: { to: 'test@example.invalid', body: 'hello' } };
    const id = ledger.beginOperation(input);
    check(() => assert.equal(ledger.findOpenOperations()[0].opId, id));
    ledger.commitOperation(id, 'sent');
    check(() => assert.equal(ledger.findOpenOperations().length, 0));
    let dispatches = 0;
    const dispatch = async () => { dispatches++; return { result: 'sent', error: false }; };
    const deduped = await ledger.execute(input, dispatch);
    check(() => assert.match(String(deduped.result), /Already executed.*not repeating/));
    check(() => assert.equal(dispatches, 0));
    now += 24 * 60 * 60 * 1000 + 1;
    await ledger.execute(input, dispatch);
    check(() => assert.equal(dispatches, 1));
    const crashedInput = { ...input, args: { ...input.args, body: 'crashed' } };
    const crashId = ledger.beginOperation(crashedInput);
    const restarted = new OperationLedger(file, () => now + 1);
    const held = await restarted.execute(crashedInput, dispatch);
    check(() => assert.match(String(held.result), /Outcome uncertain after crash.*held for review/));
    check(() => assert.equal(dispatches, 1));
    check(() => assert.equal(restarted.markInterruptedOperations(now + 1).find(r => r.opId === crashId)?.status, 'uncertain'));
    await restarted.execute(crashedInput, dispatch, true);
    check(() => assert.equal(dispatches, 2));
    // Explicit known failure is retryable; transport errors are not, because outcome may be uncertain.
    const failedInput = { ...input, args: { body: 'failed' } };
    const failedId = restarted.beginOperation(failedInput);
    restarted.failOperation(failedId, 'definitively rejected');
    check(() => assert.equal(restarted.refusal(failedInput), undefined));
    const errorInput = { ...input, args: { body: 'timeout' } };
    await restarted.execute(errorInput, async () => ({ result: 'timeout', error: true }));
    check(() => assert.match(restarted.refusal(errorInput)!, /Outcome uncertain/));
    check(() => assert.equal(operationIdempotencyKey('s', 't', { b: 2, a: 1 }), operationIdempotencyKey('s', 't', { a: 1, b: 2, force_reexecute: true, final_action_approval_id: 'new' })));
    check(() => assert.notEqual(operationIdempotencyKey('s', 't', { body: 'a' }), operationIdempotencyKey('s', 't', { body: 'b' })));
    // Parallel calls share a synchronous check/intent boundary.
    const concurrentInput = { ...input, args: { body: 'concurrent' } };
    await Promise.all([restarted.execute(concurrentInput, dispatch), restarted.execute(concurrentInput, dispatch)]);
    check(() => assert.equal(dispatches, 3));
    const writes: Array<[string, any]> = [
      ['connector_gmail', { action: 'send_email' }], ['connector_gmail_send_email', {}],
      ...['create_pr', 'merge_pr', 'comment', 'create_issue', 'update_issue', 'update_pr', 'close_pr', 'create_repo'].flatMap(action => [[ 'connector_github', { action } ], [`connector_github_${action}`, {}]] as Array<[string, any]>),
      ['connector_github_api_request', { method: 'POST' }], ['connector_other_api_request', { method: 'DELETE' }],
      ['connector_other', { action: 'api_request', method: 'PATCH' }],
      ...['create_post', 'delete_post', 'repost', 'like'].map(action => ['x_posts', { action }] as [string, any]),
      ...['x_api_create_post', 'x_api_delete_post', 'x_api_repost', 'x_api_like_post', 'x_api_send_dm'].map(name => [name, {}] as [string, any]),
      ['x_dm', { action: 'send' }], ['vercel_ops', { action: 'create_deployment' }],
      ['vercel_ops', { action: 'delete_project' }], ['vercel_ops', { action: 'api_request', method: 'PUT' }],
      ['connector_vercel_create_deployment', {}], ['connector_vercel_delete_deployment', {}],
    ];
    for (const [name, args] of writes) check(() => assert.equal(isExternalSideEffect(name, args), true, name));
    for (const [name, args] of [['connector_gmail', { action: 'list_emails' }], ['connector_github_get_pr', {}], ['connector_other_api_request', { method: 'GET' }], ['connector_other_api_request', {}], ['x_posts', { action: 'get_post' }], ['x_dm', { action: 'get_events' }], ['vercel_ops', { action: 'list_deployments' }], ['timer', { action: 'create' }], ['workspace_edit', { action: 'write' }]] as Array<[string, any]>) check(() => assert.equal(isExternalSideEffect(name, args), false, name));
    check(() => assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).every(line => JSON.parse(line).opId), true));
    // --- Crash durability: torn tail must be repaired on disk before anything appends after it. ---
    // Sequence from the 2026-10-15 review: intent -> torn commit -> reload -> recovery write -> second reload.
    const tornFile = path.join(dir, 'torn.jsonl');
    const t0 = Date.now() - 60_000;
    const first = new OperationLedger(tornFile, () => t0);
    const tornInput = { ...input, args: { body: 'torn-commit' } };
    const tornId = first.beginOperation(tornInput);
    const fullCommit = JSON.stringify({ opId: tornId, sessionId: 'session-a', toolName: input.toolName, idempotencyKey: 'k', status: 'committed', at: new Date(t0).toISOString() });
    fs.appendFileSync(tornFile, fullCommit.slice(0, 37)); // crash mid-append: partial commit, no newline
    const reload1 = new OperationLedger(tornFile, () => t0 + 1000);
    check(() => assert.equal(reload1.findOpenOperations()[0]?.opId, tornId, 'valid intent preserved; torn commit ignored'));
    check(() => assert.equal(fs.readFileSync(tornFile, 'utf8').endsWith('\n'), true, 'torn fragment truncated off before any append'));
    check(() => assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('torn.jsonl.torn-')).length, 1, 'fragment quarantined, not silently lost'));
    const uncertain = reload1.markInterruptedOperations(t0 + 1000); // recovery write appends "uncertain"
    check(() => assert.equal(uncertain.find(r => r.opId === tornId)?.status, 'uncertain'));
    let reload2!: OperationLedger;
    check(() => assert.doesNotThrow(() => { reload2 = new OperationLedger(tornFile, () => t0 + 2000); }, 'second restart parses the ledger'));
    check(() => assert.equal(reload2.findOpenOperations().find(r => r.opId === tornId)?.status, 'uncertain'));
    check(() => assert.match(reload2.refusal(tornInput)!, /Outcome uncertain/, 'uncertain op still blocks a blind retry'));
    check(() => assert.equal(fs.readFileSync(tornFile, 'utf8').split('\n').filter(Boolean).every(line => !!JSON.parse(line).opId), true));

    // A complete final record that only lost its newline is kept, and the newline is restored.
    const nlFile = path.join(dir, 'no-newline.jsonl');
    const nl = new OperationLedger(nlFile, () => t0);
    const nlId = nl.beginOperation({ ...input, args: { body: 'nl' } });
    const commitLine = JSON.stringify({ ...nl.findOpenOperations()[0], status: 'committed', resultSummary: 'sent', at: new Date(t0).toISOString() });
    fs.appendFileSync(nlFile, commitLine); // fsync of the trailing "\n" never happened
    const nlReload = new OperationLedger(nlFile, () => t0 + 1000);
    check(() => assert.equal(nlReload.findOpenOperations().length, 0, 'complete record without newline is not discarded'));
    check(() => assert.match(nlReload.refusal({ ...input, args: { body: 'nl' } })!, new RegExp(`Already executed \\(op ${nlId}\\)`)));
    nlReload.beginOperation({ ...input, args: { body: 'after-nl' } });
    check(() => assert.equal(new OperationLedger(nlFile).findOpenOperations().length, 1, 'next append lands on its own line'));
    check(() => assert.equal(fs.readdirSync(dir).some(f => f.startsWith('no-newline.jsonl.torn-')), false));

    // Corruption before the final line still fails closed (an intent is never silently dropped).
    const midFile = path.join(dir, 'mid.jsonl');
    fs.writeFileSync(midFile, `{"opId":"a","idempotencyKey":"k","status":"intent","at":"x"}\n{"opId":"b",garbage\n{"opId":"c","idempotencyKey":"k","status":"intent","at":"x"}\n`);
    check(() => assert.throws(() => new OperationLedger(midFile)));

    // startup.ts isolates ledger recovery so a damaged ledger cannot skip runtime recovery.
    const startupSrc = fs.readFileSync(path.join(__dirname, 'core', 'startup.ts'), 'utf8');
    const ledgerAt = startupSrc.indexOf('recoverOperationLedger()');
    const runtimeAt = startupSrc.indexOf('recoverInterruptedRuntimes({');
    check(() => assert.ok(ledgerAt > 0 && runtimeAt > ledgerAt, 'ledger recovery precedes runtime recovery'));
    check(() => assert.match(startupSrc.slice(ledgerAt, runtimeAt), /\}\s*catch\s*\(/, 'ledger recovery has its own catch before runtime recovery'));
    console.log(`operation-ledger: ${checks}/${checks} passed`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
