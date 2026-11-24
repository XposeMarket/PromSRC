import assert from 'node:assert/strict';
import { inHouseOpenProfileOptions } from '../src/gateway/browser/inhouse-sessions';
import { inHouseProfilePreferences } from '../src/gateway/browser/state';
import { runInTrace } from '../src/gateway/observability/turn-trace';
const id = 'mobile_fixture_chat';
const route = (sid: string, mode: string, owner: boolean, target = sid) => runInTrace(
  { sessionId: sid, executionMode: mode, personalReferenceAccess: owner }, () => inHouseOpenProfileOptions(target));
assert.deepEqual(route(id,'interactive',true), {useDesktopProfile:true});
assert.ok('profile' in inHouseOpenProfileOptions(id));
assert.ok('profile' in route(id,'interactive',true,'other_chat'));
assert.ok('profile' in route(id,'interactive',false));
for (const [sid, mode] of [['auto_job','scheduled'], ['heartbeat_main','heartbeat'],[id,'background']]) {
  assert.ok('profile' in route(sid,mode,false));
  assert.ok('profile' in route(sid,mode,true));
}
for (const sid of ['background_fixture','subagent_chat_fixture','task_fixture','team_fixture','chat::detached','x_scrape_fixture']) assert.ok('profile' in route(sid,'interactive',true));
inHouseProfilePreferences.set(id,'main');
assert.deepEqual(route(id,'interactive',true), {profile:'main'});
console.log('PASS: only a matching interactive owner turn inherits the selection; absent, scheduled, heartbeat, cross-session and agent turns do not.');process.exit(0);
