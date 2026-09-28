import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  WebhookEndpointStore,
  extractWebhookEventMeta,
  hmacSha256Hex,
  parseWebhookBody,
  publicEndpointView,
  verifyWebhookRequest,
} from './webhook-endpoints';
import { buildTriggerRuleFromInput } from './trigger-rule-input';
import { TriggerEngine } from './trigger-engine';
import { JsonTriggerStore } from './trigger-store';
import { webhookTriggerEvent } from './trigger-adapters';

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-webhooks-'));
  const store = new WebhookEndpointStore(path.join(dir, 'endpoints.json'));

  // Endpoint lifecycle + validation
  const ep = store.create({ id: 'github-promsrc', kind: 'github', name: 'PromSRC' });
  assert.ok(ep.secret.length >= 24);
  assert.throws(() => store.create({ id: 'github-promsrc' }), /already exists/);
  assert.throws(() => store.create({ id: 'Bad Id!' }), /endpoint_id/);
  assert.equal(new WebhookEndpointStore(path.join(dir, 'endpoints.json')).get('github-promsrc')?.secret, ep.secret, 'persists');

  // Masked by default, revealed on request
  const masked = publicEndpointView(ep, { baseUrl: 'https://h.example' });
  assert.notEqual(masked.secret, ep.secret);
  assert.equal(masked.token_url, undefined);
  const revealed = publicEndpointView(ep, { reveal: true, baseUrl: 'https://h.example' });
  assert.equal(revealed.token_url, `https://h.example/triggers/hook/github-promsrc/${ep.secret}`);

  // Auth methods
  const body = Buffer.from(JSON.stringify({ action: 'opened', pull_request: { number: 7, title: 'Add triggers', base: { ref: 'main' } } }));
  const sig = `sha256=${hmacSha256Hex(ep.secret, body)}`;
  assert.deepEqual(verifyWebhookRequest(ep, { headers: { 'x-hub-signature-256': sig }, rawBody: body }), { ok: true, method: 'github_hmac' });
  assert.equal(verifyWebhookRequest(ep, { headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody: body }).ok, false);
  assert.equal(verifyWebhookRequest(ep, { headers: { 'x-hub-signature-256': sig }, rawBody: Buffer.from(body.toString() + ' ') }).ok, false, 'tampered body fails');
  assert.deepEqual(verifyWebhookRequest(ep, { pathToken: ep.secret, headers: {}, rawBody: body }), { ok: true, method: 'path_token' });
  assert.equal(verifyWebhookRequest(ep, { pathToken: 'nope', headers: {}, rawBody: body }).ok, false);
  assert.deepEqual(verifyWebhookRequest(ep, { headers: { authorization: `Bearer ${ep.secret}` }, rawBody: body }), { ok: true, method: 'header_token' });
  assert.equal(verifyWebhookRequest(ep, { headers: {}, rawBody: body }).ok, false, 'no credentials rejected');

  // GitHub envelope -> "<event>.<action>"
  const parsed = parseWebhookBody(body, 'application/json');
  const meta = extractWebhookEventMeta(ep, { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-1' }, parsed as any);
  assert.equal(meta.eventType, 'pull_request.opened');
  assert.equal(meta.deliveryId, 'd-1');
  assert.equal(meta.subject, 'Add triggers');
  const form = parseWebhookBody(Buffer.from(`payload=${encodeURIComponent(body.toString())}`), 'application/x-www-form-urlencoded');
  assert.equal((form as any).pull_request.number, 7, 'github form payload');

  // Rule input: friendly fields + shorthand condition paths
  const rule = buildTriggerRuleFromInput({
    name: 'Review new PRs', endpoint_ids: ['github-promsrc'], event_types: ['pull_request.opened'],
    conditions: [{ field: 'pull_request.base.ref', operator: 'equals', value: 'main' }],
    action_kind: 'notify', prompt: 'PR #{{payload.pull_request.number}}: {{subject}}', report_session: 's1',
  }, null);
  assert.equal(rule.id, 'review-new-prs');
  assert.deepEqual(rule.matcher.sources, ['webhook']);
  assert.equal(rule.matcher.conditions?.[0].field, 'payload.pull_request.base.ref');
  assert.throws(() => buildTriggerRuleFromInput({ name: 'x', action_kind: 'notify' }, null), /at least one/);
  assert.throws(() => buildTriggerRuleFromInput({ name: 'x', event_types: ['a'], action_kind: 'team' }, null), /target_id/);

  // Engine: match, template render, dedupe on redelivery, condition filter
  const ts = new JsonTriggerStore(path.join(dir, 'rules.json'));
  ts.upsertRule(rule);
  const executed: string[] = [];
  const engine = new TriggerEngine({ rules: () => ts.listRules(), reservationStore: ts, executor: { execute: async (ctx) => { executed.push(String(ctx.renderedPrompt)); return { ok: true, status: 'completed' }; } } });
  const ev = webhookTriggerEvent({ provider: 'github-promsrc', deliveryId: 'd-1', eventType: 'pull_request.opened', payload: parsed });
  ev.subject = meta.subject;
  const first = await engine.dispatch(ev);
  assert.deepEqual(first.matchedRuleIds, ['review-new-prs']);
  assert.deepEqual(executed, ['PR #7: Add triggers']);
  const again = await engine.dispatch(webhookTriggerEvent({ provider: 'github-promsrc', deliveryId: 'd-1', eventType: 'pull_request.opened', payload: parsed }));
  assert.equal(again.runs[0].skipReason, 'duplicate_event', 'redelivery deduped');
  const otherBranch = await engine.dispatch(webhookTriggerEvent({ provider: 'github-promsrc', deliveryId: 'd-2', eventType: 'pull_request.opened', payload: { pull_request: { number: 8, base: { ref: 'dev' } } } }));
  assert.deepEqual(otherBranch.matchedRuleIds, [], 'condition filters base branch');
  const otherEndpoint = await engine.dispatch(webhookTriggerEvent({ provider: 'someone-else', deliveryId: 'd-3', eventType: 'pull_request.opened', payload: parsed }));
  assert.deepEqual(otherEndpoint.matchedRuleIds, [], 'endpoint scoping');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS webhook endpoints + trigger rules (auth, envelope, rule input, dedupe, conditions)');
}

main().catch((error) => { console.error(error); process.exit(1); });
