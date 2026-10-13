import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const src=fs.readFileSync('src/gateway/needs-you-collect.ts','utf8');
assert.match(src,/import \{ listTaskSummaries \}/);
assert.doesNotMatch(src,/\blistTasks\(/,'poll must never load historical full tasks');
// Execute the actual collector with isolated stores. Historical task reads
// deliberately throw: collection must use summaries and preserve routing fields.
const esbuild=await import('esbuild');
const transformed=esbuild.transformSync(src,{loader:'ts',format:'cjs'}).code;
const tasks=[{id:'paused',status:'awaiting_user_input',pauseReason:'awaiting_user_input',title:'Input needed',sessionId:'chat',originatingSessionId:'origin',startedAt:1,pendingClarificationQuestion:'Choose a branch'}];
let summaries=0,fullReads=0;
const stores={
 './needs-you':{buildNeedsYouItems:x=>x.tasks},
 './prometheus-questions':{getPrometheusQuestionQueue:()=>({listAll:()=>[]}),serializePrometheusQuestionForClient:x=>x},
 './verification-flow':{getApprovalQueue:()=>({listAll:()=>[]})},
 './proposals/proposal-store':{listProposals:()=>[]},
 './threads/thread-supervision':{listThreadSupervisions:()=>[]},
 './tasks/task-store':{listTaskSummaries:filter=>{summaries++;assert(filter.status.includes('awaiting_user_input'));return tasks},listTasks:()=>{fullReads++;throw new Error('historical task read')}},
 './teams/managed-teams':{listManagedTeams:()=>[]},
 './video-pending-approvals':{listVideoApprovalsAcrossWorkspaces:()=>[]},
 '../config/config':{getConfig:()=>({getWorkspacePath:()=>'/isolated'})}
};
const context={module:{exports:{}},require:id=>{assert(id in stores,'Unexpected dependency '+id);return stores[id]}};
vm.createContext(context);vm.runInContext(transformed,context);
const t=performance.now();for(let i=0;i<1000;i++){const out=context.module.exports.collectNeedsYouItems();assert.equal(out[0].originatingSessionId,'origin');assert.equal(out[0].pendingClarificationQuestion,'Choose a branch')}
const elapsed=performance.now()-t;assert.equal(fullReads,0);assert.equal(summaries,1000);assert(elapsed<1000,'collector regression budget 1ms/call');
console.log(`PASS: 1000 collector calls ${elapsed.toFixed(2)}ms, zero historical task reads, routing/question fields preserved`);
