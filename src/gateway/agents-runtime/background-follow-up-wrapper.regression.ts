import assert from 'node:assert/strict';
import { normalizeBackgroundOpsWrapperTool as normalize } from './wrapper-normalizers';
const args = {background_id:'bg_review',message:'Still an issue?'};
assert.deepEqual(normalize('background_ops',{action:'follow_up',...args}),{name:'background_follow_up',args});
assert.equal(normalize('background_ops',{action:'steer',...args})?.name,'background_steer');
console.log('PASS follow-up is distinct from live steering');
