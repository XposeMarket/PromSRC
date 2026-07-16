import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const router = read('src/gateway/routes/chat.router.ts');
const executor = read('src/gateway/agents-runtime/subagent-executor.ts');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');

assert.match(
  router,
  /function buildCapturedScreenshotPreviewPayload\([\s\S]*?source: 'desktop' \| 'browser'/,
  'screenshot previews must be built independently of model vision injection',
);
assert.match(
  router,
  /sendSSE\('vision_injected', \{[\s\S]{0,220}?source: 'desktop',[\s\S]{0,220}?preview,[\s\S]{0,120}?injected: !!visionMessage/,
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
assert.match(router, /const executedToolName = String\(toolResult\?\.name \|\| toolName/, 'unified browser and desktop wrappers must use their executed screenshot identity');
assert.match(router, /function buildMediaAnalysisPreviewPayloads\([\s\S]*?\['analyze_image', 'analyze_video'\]/, 'image and video analysis tools must build visual preview payloads');
assert.match(router, /analysisPreviews\.forEach\([\s\S]{0,500}?source: 'media_analysis'/, 'analysis visuals must emit after their tool result through the shared vision stream');
assert.match(router, /contact_sheets[\s\S]{0,500}?sample_frames/, 'video previews must prefer contact sheets and fall back to sampled frames');
assert.match(router, /\/api\/canvas\/inline\?path=/, 'analysis previews must use bounded same-origin media URLs instead of embedding large sheets in stream history');
assert.match(executor, /case 'analyze_image':[\s\S]{0,900}?data: toolResult\.success === true \? toolResult\.data : undefined/, 'analyze_image must preserve structured visual artifacts for preview emission');
assert.match(executor, /case 'analyze_video':[\s\S]{0,1200}?data: toolResult\.success === true \? toolResult\.data : undefined/, 'analyze_video must preserve contact-sheet and frame metadata for preview emission');

assert.match(mobile, /case 'vision_injected':[\s\S]{0,180}?_appendMobileVisionTrace\(aiTurn, evt\)/, 'mobile live streams must append screenshot previews');
assert.match(mobile, /liveTraceEntries: Array\.isArray\(msg\.liveTraceEntries\)[\s\S]{0,100}?msg\.liveTraceEntries/, 'mobile session history must retain screenshot trace entries');
assert.match(desktop, /liveTraceEntries: Array\.isArray\(streamState\.liveTraceEntries\) \? streamState\.liveTraceEntries\.slice\(\) : undefined/, 'desktop completed turns must retain screenshot trace entries');
assert.match(desktop, /groups\.push\(\{ kind: 'vision', entries: \[entry\] \}\)/, 'desktop screenshots must break out of collapsible tool groups');
assert.match(desktop, /class="live-turn-vision-break"/, 'desktop must render a standalone screenshot timeline card');
assert.match(mobile, /groups\.push\(\{ kind: 'vision', entries: \[entry\] \}\)/, 'mobile screenshots must break out of collapsible tool groups');
assert.match(mobile, /class="pm-trace-vision-break"/, 'mobile must render a standalone screenshot timeline card');
assert.match(desktop, /isRenderableLiveTraceImageSource[\s\S]{0,180}?api\\\/canvas\\\/inline/, 'desktop must accept same-origin analysis preview URLs');
assert.match(mobile, /_isRenderableMobileTraceImageSource[\s\S]{0,180}?api\\\/canvas\\\/inline/, 'mobile must accept same-origin analysis preview URLs');
assert.match(desktop, /isRenderableLiveTraceImageSource[\s\S]{0,320}?desktop-screenshot-preview/, 'desktop must accept wrapper screenshot preview URLs');
assert.match(mobile, /_isRenderableMobileTraceImageSource[\s\S]{0,320}?desktop-screenshot-preview/, 'mobile must accept wrapper screenshot preview URLs');
assert.match(router, /desktop-screenshot-preview\/:sessionId\/:screenshotId/, 'gateway must expose exact desktop packet previews');
assert.doesNotMatch(router, /sendSSE\('info', \{ message: `Vision screenshot injected \(desktop\)/, 'desktop injection status noise must stay hidden');
assert.match(desktop, /isVisionInjectionStatusText\(normalizedText\)/, 'desktop recovery must hide legacy injection status rows');
assert.match(mobile, /_isMobileVisionInjectionStatusText\(normalizedText\)/, 'mobile recovery must hide legacy injection status rows');

console.log('[tool-stream-screenshot-previews] desktop/mobile live and recovery contracts passed');
