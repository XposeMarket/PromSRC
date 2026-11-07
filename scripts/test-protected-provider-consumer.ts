// Synthetic-only test: protected connection credential -> ordinary provider vault key.
// Uses a temp config dir and fake config deps; never reads real config or real secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecureInputService } from '../src/connections/secure-input-service';
import { registerOpenAiCompatibleProvider } from '../src/connections/runtime';
import { getVault } from '../src/security/vault';

const SECRET = 'sk-synthetic-test-0000';
const serviceId = 'synthetic-provider';
const attemptId = 'attempt-synthetic-1';

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-provider-'));
  try {
    const svc = new SecureInputService(dir, undefined, () => true);
    const session = svc.create({ serviceId, attemptId, fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }] as any });
    const { credentialRef, fieldsReceived } = svc.submit(session.id, { api_key: SECRET });
    assert.deepEqual(fieldsReceived, ['api_key']);
    const originalKey = credentialRef.replace(/^vault:/, '');
    assert.ok(originalKey.startsWith('connection.credentials.'));

    // Probe consumer path still reads the envelope.
    const envelope = svc.readForConsumer(credentialRef, serviceId, attemptId);
    assert.equal(JSON.parse(String(envelope)).api_key, SECRET);
    // Generic resolution of the original ref is denied.
    assert.equal(getVault(dir).get(originalKey, 'config:resolve'), null);

    // Copy is owner-bound and fails closed for another attempt.
    assert.throws(() => svc.copyScalarFieldForProvider(credentialRef, serviceId, 'other-attempt', 'api_key', `llm.provider-key.${serviceId}`));
    // Copy target must be the ordinary provider namespace.
    assert.throws(() => svc.copyScalarFieldForProvider(credentialRef, serviceId, attemptId, 'api_key', 'connection.credentials.x'));

    const updates: Array<Record<string, any>> = [];
    const cfgStore: any = { llm: { providers: {} } };
    const deps = {
      readConfig: () => cfgStore,
      updateConfig: (patch: Record<string, unknown>) => { updates.push(patch); },
      copyCredential: (reference: string, sid: string, aid: string, field: string, targetKey: string) => svc.copyScalarFieldForProvider(reference, sid, aid, field, targetKey),
    };
    const context: any = { attempt: { serviceId, id: attemptId, serviceName: 'Synthetic', plan: { strategy: { adapter: 'custom-http' } } }, credentialRef };
    // Adapter verification: wrong adapter is refused.
    assert.throws(() => registerOpenAiCompatibleProvider(context, { baseUrl: 'https://synthetic.invalid/v1' }, deps), /openai-compatible-model/);
    assert.equal(updates.length, 0);

    // Genuine register path with the correct adapter.
    context.attempt.plan.strategy.adapter = 'openai-compatible-model';
    const result = registerOpenAiCompatibleProvider(context, { baseUrl: 'https://synthetic.invalid/v1', model: 'synthetic-model', discoveredModels: ['synthetic-model'] }, deps);
    assert.equal(result.providerId, serviceId);
    const written = updates.at(-1)!.llm.providers[serviceId];
    assert.equal(written.api_key, `vault:llm.provider-key.${serviceId}`);
    assert.ok(!String(written.api_key).includes('connection.credentials'));

    // Original ref still denied; copied ref resolves through the ordinary config path.
    assert.equal(getVault(dir).get(originalKey, 'config:resolve'), null);
    const resolved = getVault(dir).get(`llm.provider-key.${serviceId}`, 'config:resolve');
    assert.equal(resolved?.expose(), SECRET);
    console.log('PASS protected-provider-consumer: original ref denied, copied provider key resolves, wrong adapter and wrong attempt refused.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error('FAIL', error); process.exit(1); });
