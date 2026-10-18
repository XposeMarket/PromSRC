import assert from 'node:assert/strict';
import fs from 'node:fs';

const steer = fs.readFileSync('src/gateway/routes/chat/steer.ts', 'utf8');
const page = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');

assert.match(steer, /\{ attachments: steerAttachments \}/, 'durable steer history must retain runtime image attachments');
assert.match(steer, /attachments: steerAttachments,/, 'chat_steer events must retain image payloads');
assert.match(steer, /attachmentPreviews: steerAttachmentPreviews,/, 'chat_steer events must retain preview metadata');
assert.match(page, /function steerAttachmentsToPreviews\(attachments\)/, 'desktop must adapt steer image payloads into normal message previews');
assert.match(page, /attachmentPreviews = Array\.isArray\(data\?\.attachmentPreviews\)/, 'desktop must prefer supplied previews and fall back to image payloads');
assert.match(page, /wsEventBus\.on\('chat_steer'/, 'desktop must consume remote steer events');
assert.match(page, /attachmentPreviews: attachmentPreviews\.length \? attachmentPreviews : undefined/, 'optimistic and remote steer rows must render attachment previews normally');
assert.match(page, /: steerAttachmentsToPreviews\(msg\.attachments\)/, 'rehydrated steer history must render image payloads through the normal attachment renderer');
console.log('PASS chat steer attachments: durable history, events, and desktop normal-message rendering');

// Exercise the desktop fallback used by optimistic splits and reloaded history.
const adapterSource = page.slice(page.indexOf('function steerAttachmentsToPreviews('), page.indexOf('\nfunction appendChatSteerWorkflowSplit('));
const { default: vm } = await import('node:vm');
const context = vm.createContext({});
vm.runInContext(adapterSource, context);
const previews = context.steerAttachmentsToPreviews([{ name: 'photo.png', mimeType: 'image/png', base64: 'aGVsbG8=' }]);
assert.equal(previews.length, 1);
assert.equal(previews[0].dataUrl, 'data:image/png;base64,aGVsbG8=');
assert.equal(previews[0].kind, 'image');
assert.equal(context.steerAttachmentsToPreviews(null).length, 0);
assert.match(page, /const existingSteer = sess\.history\.find/, 'desktop remote echo must dedupe against reloaded history');
console.log('PASS desktop steer image fallback behavior and remote history dedupe');
