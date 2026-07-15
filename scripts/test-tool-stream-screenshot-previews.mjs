import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const router = read('src/gateway/routes/chat.router.ts');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');

assert.match(
  router,
  /function buildCapturedScreenshotPreviewPayload\([\s\S]*?source: 'desktop' \| 'browser'/,
  'screenshot previews must be built independently of model vision injection',
);
assert.match(
  router,
  /sendSSE\('vision_injected', \{ source: 'desktop', tool: toolName, preview, injected: !!visionMessage \}\)/,
  'desktop captures must emit a tool-stream preview even when model vision injection is unavailable',
);
assert.match(
  router,
  /sendSSE\('vision_injected', \{ source: 'browser', tool: toolName, preview, injected: !!visionMessage \}\)/,
  'browser captures must emit a tool-stream preview even when model vision injection is unavailable',
);
assert.match(
  router,
  /sendSSE\('tool_result', \{[\s\S]{0,280}?synthetic: true,[\s\S]{0,120}?await maybeAppendVisionScreenshotForTool\(autoToolName/,
  'automatic desktop screenshot previews must follow their tool result',
);
assert.match(router, /broadcastVoiceAgentToolEvent\(sessionId, 'tool_result',[\s\S]{0,260}?emitLastVoiceScreenshotPreview\(sessionId, action\)/, 'voice screenshot previews must follow their tool result');
assert.match(router, /function buildDurableToolStreamTrace\([\s\S]*?frame\.type === 'vision_injected'/, 'gateway history must retain screenshot-bearing tool traces');
assert.match(router, /liveTraceEntries: durableToolStreamTrace/, 'completed assistant history must include the durable screenshot trace');

assert.match(mobile, /case 'vision_injected':[\s\S]{0,180}?_appendMobileVisionTrace\(aiTurn, evt\)/, 'mobile live streams must append screenshot previews');
assert.match(mobile, /liveTraceEntries: Array\.isArray\(msg\.liveTraceEntries\)[\s\S]{0,100}?msg\.liveTraceEntries/, 'mobile session history must retain screenshot trace entries');
assert.match(desktop, /liveTraceEntries: Array\.isArray\(streamState\.liveTraceEntries\) \? streamState\.liveTraceEntries\.slice\(\) : undefined/, 'desktop completed turns must retain screenshot trace entries');
assert.match(desktop, /live-turn-collapsed-vision-previews/, 'desktop collapsed tool groups must keep screenshot previews visible');
assert.match(mobile, /pm-trace-collapsed-vision-previews/, 'mobile collapsed tool groups must keep screenshot previews visible');

console.log('[tool-stream-screenshot-previews] desktop/mobile live and recovery contracts passed');
