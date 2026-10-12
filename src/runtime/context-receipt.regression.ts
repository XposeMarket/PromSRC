import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildRuntimePromptManifest, captureRuntimePromptManifest } from './prompt-manifest';
import { buildContextReceipt, captureContextReceipt, readContextReceipts, configureContextReceipts, scrubContextText } from './context-receipt';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-receipt-test-'));
try {
 const input: any = { callType: 'chat', provider: 'test', model: 'test', sessionId: 'session/../safe', messages: [
  { role: 'system', content: '[USER]\nname\n[SOUL]\nstyle\n[MEMORY]\npassword=supersecret\n[AUTO_RECALL]\nrecall\n[ATOMIC_MEMORY]\natom\n[BRAIN_ACTIVE_CONTEXT — temporary, relevance-selected, and expiry-bound]\nbrain\n[TODAY_NOTES — 2026-10-11]\nnotes\n[SKILLS]\nskill\n[END]\n' },
  { role: 'system', content: '[SKILLS]\nskill\n[END]\n' },
  { role: 'assistant', content: '<thinking>neverretainthis</thinking>' },
  { role: 'tool', content: 'neverretainthis' },
  { role: 'user', content: [{ type: 'text', text: 'api_key="quoted secret" Bearer TOKEN123' }, { type: 'image', data: 'neverretainthis' }] }
 ] };
 assert(!scrubContextText('token="sensitive" https://username:credential@example.test/').includes('sensitive'));
 assert(!scrubContextText('https://username:credential@example.test/').includes('credential'));
 const manifest = buildRuntimePromptManifest(input); const receipt = buildContextReceipt(input, manifest);
 const joined = buildContextReceipt({ ...input, context: { gatewayTurnId: 'turn-test', originalUserRequest: 'original request' } }, manifest);
 assert.equal(joined.gatewayTurnId, 'turn-test'); assert.equal((joined.userInput as any).text, 'original request'); assert.equal(joined.providerBoundUserInput.source, 'latest_provider_bound_user_text');
 assert.equal(receipt.manifestId, manifest.id); assert.equal(receipt.attemptId, manifest.id);
 assert.equal(receipt.phase, 'assembled_provider_boundary'); assert.equal(receipt.responseOutcome, 'unavailable');
 for (const name of ['USER','SOUL','MEMORY','AUTO_RECALL','ATOMIC_MEMORY','BRAIN_ACTIVE_CONTEXT','TODAY_NOTES','SKILLS']) assert(receipt.sections.some(s => s.name === name), name);
 assert(receipt.sections.some(s => s.name === 'SKILLS' && s.duplicate));
 const json = JSON.stringify(receipt); for (const secret of ['supersecret','quoted secret','TOKEN123','neverretainthis']) assert(!json.includes(secret), secret);
 assert.notEqual((receipt.userInput as any).rawOriginalHash, (receipt.userInput as any).redactedFullHash);
 const huge = buildContextReceipt({ ...input, messages: [{ role: 'user', content: 'a '.repeat(100000) }] }, manifest);
 assert.equal((huge.userInput as any).truncated, true); assert((huge.userInput as any).storedChars <= 48000);
 assert.equal(captureContextReceipt(input, manifest, root).persisted, true);
 assert.equal(readContextReceipts({ id: manifest.id }, root).records.length, 1);
 assert.throws(() => readContextReceipts({ id: '../settings' }, root));
 const dir = path.join(root,'audit','context-receipts');
 const broken = buildRuntimePromptManifest(input); fs.writeFileSync(path.join(dir, broken.id+'.json'), '{broken');
 const legacy = buildRuntimePromptManifest(input); fs.writeFileSync(path.join(dir, legacy.id+'.json'), JSON.stringify({ version: 0 }));
 assert.equal(readContextReceipts({}, root).skipped, 2);
 configureContextReceipts({ enabled: false }, root); assert.equal(captureContextReceipt(input, manifest, root).reason, 'disabled');
 configureContextReceipts({ enabled: true, reset: true }, root); assert.equal(readContextReceipts({}, root).records.length, 0);
 const blocker = path.join(root,'blocker'); fs.writeFileSync(blocker, 'file'); assert.equal(captureContextReceipt(input, manifest, blocker).persisted, false);
 const pemHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const pemFooter = ['-----END ', 'PRIVATE KEY-----'].join('');
  assert(!scrubContextText(`${pemHeader}\nsecret\n${pemFooter}`).includes('secret'));
 // Exercise the actual manifest capture linkage, but disabled in a temporary runtime workspace.
 process.env.PROMETHEUS_WORKSPACE_DIR = root;
 configureContextReceipts({ enabled: false }, root);
 const linked = captureRuntimePromptManifest(input); assert.equal(linked.contextReceipt?.id, linked.id);
 console.log('PASS context-receipt: markers, duplicates, redaction, bounds, malformed/legacy, traversal, disable/reset, IO failure, manifest linkage');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// The real atomic-memory formatter's marker is MEMORY_REFERENCE.
const markerInput: any = { callType: 'chat', provider: 'test', model: 'test', messages: [{ role: 'system', content: '[MEMORY_REFERENCE]\natomic facts\n[END]\n' }, { role: 'user', content: 'request' }] };
assert(buildContextReceipt(markerInput, buildRuntimePromptManifest(markerInput)).sections.some(s => s.name === 'MEMORY_REFERENCE'));
