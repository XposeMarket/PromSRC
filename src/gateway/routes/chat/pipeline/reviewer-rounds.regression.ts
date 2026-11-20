import assert from 'node:assert/strict';
import { pendingReviewerRounds } from './reviewer-rounds';
const row=(name:string,payload:Record<string,unknown>,args:{action?:string}={})=>({name,args,result:JSON.stringify(payload),error:false});
const rows=[row('background_spawn',{id:'a',timeoutMs:100}),row('background_ops',{id:'b',queued:true,newExecution:true},{action:'follow_up'}),row('background_steer',{id:'c',queued:true}),row('background_follow_up',{id:'d',queued:false}),row('background_follow_up',{id:'b',queued:true,newExecution:true}),row('background_ops',{id:'e',state:'completed'},{action:'status'})];
assert.deepEqual(pendingReviewerRounds(rows,new Set()),[{id:'a',timeoutMs:100},{id:'b',timeoutMs:undefined}]);
assert.deepEqual(pendingReviewerRounds(rows,new Set(['a'])),[{id:'b',timeoutMs:undefined}]);
console.log('PASS same-turn rounds are independently eligible for synthesis; retries and live steers do not double-join');
