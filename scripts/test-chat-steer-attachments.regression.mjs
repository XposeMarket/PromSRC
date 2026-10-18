import assert from 'node:assert/strict';
import fs from 'node:fs';

const steer = fs.readFileSync('src/gateway/routes/chat/steer.ts', 'utf8');
const page = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const steerEvents = await import('../web-ui/src/features/chat/runtime/chat-steer-events.js');

assert.match(steer, /\{ attachments: steerAttachments \}/, 'durable steer history must retain runtime image attachments');
assert.match(steer, /attachments: steerAttachments,/, 'chat_steer events must retain image payloads');
assert.match(steer, /attachmentPreviews: steerAttachmentPreviews,/, 'chat_steer events must retain preview metadata');
assert.match(page, /steerAttachmentsToPreviews/, 'desktop must adapt steer image payloads into normal message previews');
assert.match(page, /appendChatSteerWorkflowSplitRuntime/, 'desktop must delegate remote steer splits to the helper');
assert.match(page, /wsEventBus\.on\('chat_steer'/, 'desktop must consume remote steer events');
assert.match(page, /steerAttachmentsToPreviews/, 'optimistic and remote steer rows must render attachment previews normally');
assert.match(page, /: steerAttachmentsToPreviews\(msg\.attachments\)/, 'rehydrated steer history must render image payloads through the normal attachment renderer');
assert.match(page, /appendRemoteChatSteer\(event, appendChatSteerWorkflowSplit\)/, 'desktop consumes active-session remote steer events');
console.log('PASS chat steer attachments: durable history, events, and desktop normal-message rendering');

// Exercise the desktop fallback used by optimistic splits and reloaded history.
const previews = steerEvents.steerAttachmentsToPreviews([{ name: 'photo.png', mimeType: 'image/png', base64: 'aGVsbG8=' }]);
assert.equal(previews.length, 1);
assert.equal(previews[0].dataUrl, 'data:image/png;base64,aGVsbG8=');
assert.equal(previews[0].kind, 'image');
assert.equal(steerEvents.steerAttachmentsToPreviews(null).length, 0);
const activeEvent = { sessionId: 'active-session', clientSteerId: 'mobile_1', displayMessage: 'Use this image' };
const calls = [];
assert.equal(steerEvents.appendRemoteChatSteer(activeEvent, (...args) => { calls.push(args); return true; }), true,
  'remote steer is appended even for the actively viewed session');
assert.deepEqual(calls[0], ['active-session', 'Use this image', activeEvent]);
assert.equal(steerEvents.findChatSteerRow([{ role: 'user', clientSteerId: 'mobile_1' }], activeEvent)?.clientSteerId, 'mobile_1',
  'local origin echo dedupes by durable client steer identity');
console.log('PASS desktop steer image fallback, active-session append, and remote history dedupe');
