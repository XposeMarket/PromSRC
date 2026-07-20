import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');

assert.match(mobile, /const workerClientRequestId = String\(options\.clientRequestId \|\| ''\)\.trim\(\) \|\| _newMobileClientRequestId\(targetSessionId\)/);
assert.match(mobile, /_voiceWorkerLocalTurn: true,\s*_clientRequestId: workerClientRequestId,/s);
assert.match(mobile, /streamChat\(\{ message: finalText, sessionId: targetSessionId, callerContext, clientRequestId: workerClientRequestId \}/);
assert.match(mobile, /clientRequestId: workerClientRequestId,\s*\};\s*__pmChat\.busy = true;/s);
assert.match(mobile, /String\(msg\._clientRequestId \|\| ''\)\.trim\(\) === candidateRequestId/);
assert.match(mobile, /String\(msg\.messageKind \|\| ''\)\.trim\(\) === 'voice_foreground_worker'/);
assert.match(mobile, /if \(\(msgRequestId \|\| previousRequestId\) && \(!msgRequestId \|\| msgRequestId !== previousRequestId\)\) continue/);
assert.match(mobile, /function _mergeMobileThreadLocalArtifacts[\s\S]*insertForegroundWorkerAfterHandoff[\s\S]*next\.splice\(anchorIndex \+ 1, 0, candidate\)/);
assert.match(mobile, /if \(handoffIndex >= 0\) activeThread\.splice\(handoffIndex \+ 1, 0, aiTurn\)/);
assert.match(mobile, /candidate\._voiceWorkerLocalTurn === true && _isMobileVoiceAgentAssistantTurn\(msg\)/);
assert.match(mobile, /const backgroundTasks = workerTasks\.slice\(1\)/);
assert.match(mobile, /if \(backgroundTasks\.length\) \{\s*dispatchResult = await mobileGatewayFetch\('\/api\/voice-agent\/dispatch-workers'/s);

// Desktop already sends voice foreground work through the normal chat turn,
// which creates and remembers a stable request id before POST /api/chat.
assert.match(desktop, /const clientRequestId = String\(options\.clientRequestId \|\| ''\)\.trim\(\) \|\| newChatClientRequestId\(thisSessionId\)/);
assert.match(desktop, /rememberLocalMainChatRequest\(thisSessionId, clientRequestId\)/);
assert.match(desktop, /clientRequestId, attachments:/);

console.log('voice foreground chat stream contract checks passed');
