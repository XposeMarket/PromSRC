const assert = require('node:assert/strict');
const {openConnectionPhoneHandoff} = require('../dist/connections/oauth-phone-handoff.js');
(async()=>{
 const attempt={id:'conn_attempt_test',serviceId:'x',serviceName:'X',state:'awaiting_oauth',plan:{strategy:{adapter:'connector-oauth'}},requiredUserAction:{type:'oauth',desktopRequired:true,authorizationUrl:'https://x.com/i/oauth2/authorize?state=fixture',expiresAt:new Date(Date.now()+60000).toISOString()}};
 let count=0; const open=async(s,u)=>{count++;assert.equal(s,'connection_oauth_conn_attempt_test');assert.equal(u,attempt.requiredUserAction.authorizationUrl);return 'Browser opened';};
 assert.deepEqual(await openConnectionPhoneHandoff(attempt,open),{sessionId:'connection_oauth_conn_attempt_test',site:'X'});
 for(const patch of [{state:'awaiting_approval'},{state:'cancelled'},{state:'connected'},{plan:{strategy:{adapter:'api-key'}}},...[
 {type:'secure-input'},{authorizationUrl:'http://localhost:32466'},{authorizationUrl:'https://user:pass@x.com/'},{preferSystemBrowser:true},{desktopRequired:false},{expiresAt:new Date(0).toISOString()},{expiresAt:'bad'}].map(p=>({requiredUserAction:{...attempt.requiredUserAction,...p}}))]) {
  await assert.rejects(()=>openConnectionPhoneHandoff({...attempt,...patch},open),/OAUTH_HANDOFF_UNAVAILABLE/);
 }
 await assert.rejects(()=>openConnectionPhoneHandoff(undefined,open),/OAUTH_HANDOFF_UNAVAILABLE/);
 assert.equal(count,1);
 await assert.rejects(()=>openConnectionPhoneHandoff(attempt,async()=> 'ERROR: unavailable'),/OAUTH_HANDOFF_BROWSER_UNAVAILABLE/);
 console.log('PASS phone OAuth handoff: bound URL/session, approved pending connector only, expiry, system-browser, invalid URLs, terminal/cancel, bridge failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
