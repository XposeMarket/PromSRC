import assert from 'node:assert/strict';
import { inHouseOpenProfileOptions } from '../src/gateway/browser/inhouse-sessions';
import { inHouseProfilePreferences } from '../src/gateway/browser/state';
assert.deepEqual(inHouseOpenProfileOptions('mobile_fixture_chat'),{useDesktopProfile:true});
inHouseProfilePreferences.set('mobile_fixture_chat','main');
assert.deepEqual(inHouseOpenProfileOptions('mobile_fixture_chat'),{profile:'main'});
assert.deepEqual(inHouseOpenProfileOptions('mobile_fixture_next'),{useDesktopProfile:true});
for(const id of ['background_fixture','subagent_chat_fixture','task_fixture','team_fixture','chat::detached','x_scrape_fixture']) assert.ok('profile' in inHouseOpenProfileOptions(id),id);
console.log('PASS: fresh personal chat uses selection; explicit main and non-personal sessions do not inherit it.');process.exit(0);
