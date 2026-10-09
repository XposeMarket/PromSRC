import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Voice foreground worker logic was split from mobile-pages.js across these mobile modules.
const mobile = [
  'web-ui/src/mobile/mobile-pages.js',
  'web-ui/src/mobile/mobile-voice-page.js',
  'web-ui/src/mobile/mobile-chat-page-runtime.js',
  'web-ui/src/mobile/mobile-voice-realtime-runtime.js',
]
  .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n');
// Desktop send path moved from pages/ChatPage.js into the desktop send runtime.
const desktop = ['web-ui/src/pages/ChatPage.js', 'web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js']
  .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'))
  .join('\n');

// The worker request id now comes from context._newMobileClientRequestId in mobile-voice-page.js.
assert.match(mobile, /const workerClientRequestId = String\(options\.clientRequestId \|\| ''\)\.trim\(\) \|\| (?:context\.)?_newMobileClientRequestId\(targetSessionId\)/);
assert.match(mobile, /_voiceWorkerLocalTurn: true,\s*_clientRequestId: workerClientRequestId,/s);
assert.match(mobile, /streamChat\(\{ message: finalText, sessionId: targetSessionId, callerContext, clientRequestId: workerClientRequestId \}/);
assert.match(mobile, /clientRequestId: workerClientRequestId,\s*\};\s*(?:context\.)?__pmChat\.busy = true;/s);
assert.match(mobile, /String\(msg\._clientRequestId \|\| ''\)\.trim\(\) === candidateRequestId/);
assert.match(mobile, /\['voice_foreground_worker', 'internal_watch_review'\]\.includes\(String\(msg\.messageKind \|\| ''\)\.trim\(\)\)/);
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
