import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retrieveMemoryAtoms } from '../gateway/memory-index/memory-atoms';
import { retrieveHybridMemoryAtoms } from '../gateway/memory-index/memory-atoms-hybrid';
import { captureContextReceipt, readContextReceipt, recordContextReceiptOutcome, reviewContextReceipt, configureContextReceipts } from './context-receipt';
import { buildRuntimePromptManifest } from './prompt-manifest';
import { boundRetrievalTrace } from './retrieval-provenance';

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-provenance-'));
 try {
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '## Projects\n- [2026-10-11] Nebulax provenance records retrieval decisions.\n- [2026-10-11] Bananas grow in tropical climates.\n');
  const atoms = retrieveMemoryAtoms(root, 'Nebulax provenance retrieval decisions');
  assert.ok(atoms.retrieval?.candidates.some(c => c.selected));
  assert.ok(atoms.retrieval?.candidates.some(c => !c.selected && c.reason !== ''));
  const hybrid = await retrieveHybridMemoryAtoms(root, 'Nebulax provenance retrieval decisions', { disableSemantic: true });
  assert.ok(hybrid.retrieval?.candidates.some(c => c.selected));
  const input: any = { sessionId: 'session', provider: 'test', model: 'test', messages: [{role:'system',content:'unlabelled policy\n[MEMORY]\nNebulax context'},{role:'user',content:'assembled request'}], context:{ gatewayTurnId:'turn', originalUserRequest:'original request', retrieval:[atoms.retrieval,hybrid.retrieval] } };
  const manifest = buildRuntimePromptManifest(input);
  assert.equal(captureContextReceipt(input, manifest, root).persisted, true);
  const before = readContextReceipt(manifest.id, root);
  assert.ok(before.sectionInventory.some((s: any)=>s.name==='unlabelled_prefix'));
  assert.ok(before.sectionInventory.some((s: any)=>s.name==='MEMORY' && s.redactedFullHash));
  assert.equal(before.outcome.state, 'unavailable');
  assert.equal(before.userInput.text, 'original request');
  assert.equal(recordContextReceiptOutcome({sessionId:'other',gatewayTurnId:'turn',status:'completed'},root).joined,0);
  for (const status of ['completed','cancelled','failed'] as const) {
   assert.equal(recordContextReceiptOutcome({sessionId:'session',gatewayTurnId:'turn',status,response:'token=secret-value'},root).joined,1);
   assert.equal(readContextReceipt(manifest.id, root).outcome.status,status);
  }
  assert.equal(reviewContextReceipt(manifest.id,{relevance:'redundant',reason:'duplicate evidence'},root).saved,true);
  assert.equal(readContextReceipt(manifest.id,root).review.relevance,'redundant');
  assert.equal(readContextReceipt(manifest.id,root).outcome.efficacy,'unknown_without_review_or_measurement');
  assert.throws(()=>reviewContextReceipt(manifest.id,{relevance:'invalid' as any,reason:''},root));
  const trace=boundRetrievalTrace({source:'auto',state:'available',thresholds:{},candidateCount:200,truncated:false,candidates:Array.from({length:200},()=>({sourceId:'token=secret-value',source:'auto',selected:false,reason:'token=secret-value',matchedTerms:['token=secret-value']}))});
  assert.equal(trace.truncated,true); assert.ok(!JSON.stringify(trace).includes('secret-value'));
  configureContextReceipts({enabled:false},root); assert.equal(recordContextReceiptOutcome({sessionId:'session',gatewayTurnId:'turn',status:'completed'},root).joined,0);
  configureContextReceipts({enabled:true},root);
  console.log('retrieval provenance regression PASS');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
