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
    console.log(`operation-ledger: ${checks}/${checks} passed`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
