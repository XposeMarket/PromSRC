import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const types = read('src/image-generation/types.ts');
const registry = read('src/image-generation/registry.ts');
const utils = read('src/image-generation/utils.ts');
const openai = read('src/image-generation/providers/openai.ts');
const codex = read('src/image-generation/providers/openai-codex.ts');
const xai = read('src/image-generation/providers/xai.ts');
const tool = read('src/tools/generate-image.ts');
const router = read('src/gateway/routes/chat.router.ts');
const executor = read('src/gateway/agents-runtime/subagent-executor.ts');
const webMedia = read('src/gateway/agents-runtime/capabilities/web-media-executor.ts');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const defs = read('src/gateway/tools/defs/file-web-memory.ts');
const skill = read('workspace/skills/imagegen/SKILL.md');
const previewHelpers = await import(pathToFileURL(path.join(root, 'dist/gateway/generated-image-preview.js')).href);

const partialA = {
  path: path.join(root, '.prometheus', 'cache', 'images', 'partial-a.png'),
  cache_path: path.join(root, '.prometheus', 'cache', 'images', 'partial-a.png'),
  mime_type: 'image/png',
  file_name: 'partial-a.png',
  generation_id: 'ig_A',
  partial_index: 0,
  partial: true,
};
const partialB = {
  path: path.join(root, '.prometheus', 'cache', 'images', 'partial-b.png'),
  cache_path: path.join(root, '.prometheus', 'cache', 'images', 'partial-b.png'),
  mime_type: 'image/png',
  file_name: 'partial-b.png',
  generation_id: 'ig_B',
  partial_index: 0,
  partial: true,
};
const finalA = {
  path: path.join(root, 'workspace', 'generated', 'images', 'final-a.png'),
  rel_path: 'generated/images/final-a.png',
  cache_path: path.join(root, '.prometheus', 'cache', 'images', 'final-a.png'),
  mime_type: 'image/png',
  file_name: 'final-a.png',
  generation_id: 'ig_A',
};
const partialPreviewA = previewHelpers.buildGeneratedImagePreviewPayload(partialA);
const partialPreviewB = previewHelpers.buildGeneratedImagePreviewPayload(partialB);
const finalPreviewA = previewHelpers.buildGeneratedImagePreviewPayload(finalA);
assert.ok(partialPreviewA, 'cache-only partial must produce a preview payload');
assert.match(partialPreviewA.dataUrl, /^\/api\/canvas\/generated-image-preview\?cache=partial-a\.png$/, 'cache-only partial must use constrained generated-image cache preview route');
assert.equal(partialPreviewA.workspacePath, undefined, 'cache-only partial must not fake a workspace path');
assert.equal(partialPreviewA.cacheKey, 'partial-a.png', 'cache-only partial should expose only a basename cache key');
assert.equal(partialPreviewA.generationId, 'ig_A', 'partial preview must carry generation identity');
assert.equal(partialPreviewA.previewId, finalPreviewA.previewId, 'partial and final previews for the same generation must share replacement identity');
assert.notEqual(partialPreviewB.previewId, finalPreviewA.previewId, 'simultaneous image previews must have distinct replacement identities');
assert.doesNotMatch(JSON.stringify(partialPreviewA), /[A-Za-z]:\\\\|base64,/i, 'partial preview payload must not contain absolute paths or base64');

const liveEntries = [
  { type: 'vision', preview: partialPreviewA },
  { type: 'vision', preview: partialPreviewB },
];
const incomingPreviewId = String(finalPreviewA.previewId || '').trim();
const incomingGenerationId = String(finalPreviewA.generationId || '').trim();
const incomingWorkspacePath = String(finalPreviewA.workspacePath || '').trim();
const incomingCacheKey = String(finalPreviewA.cacheKey || '').trim();
const priorIndex = liveEntries.findIndex((entry) =>
  entry?.type === 'vision'
  && String(entry?.preview?.artifactKind || '') === 'generated_image_partial'
  && (
    (!!incomingPreviewId && String(entry?.preview?.previewId || '') === incomingPreviewId)
    || (!!incomingGenerationId && String(entry?.preview?.generationId || '') === incomingGenerationId)
    || (!incomingPreviewId && !incomingGenerationId && !!incomingWorkspacePath && String(entry?.preview?.workspacePath || '') === incomingWorkspacePath)
    || (!incomingPreviewId && !incomingGenerationId && !!incomingCacheKey && String(entry?.preview?.cacheKey || '') === incomingCacheKey)
  )
);
assert.equal(priorIndex, 0, 'final image must replace only the matching partial preview by generation identity');
liveEntries.splice(priorIndex, 1);
assert.equal(liveEntries.length, 1, 'replacement must leave other simultaneous partial previews intact');
assert.equal(liveEntries[0].preview.previewId, partialPreviewB.previewId, 'replacement must not remove another image partial');

assert.match(types, /ImageGenerationPresentationMode = 'foreground' \| 'background'/, 'presentation mode must be a typed contract');
assert.match(types, /ImageGenerationProviderCapabilities/, 'provider capabilities must be declared in image-generation types');
assert.match(tool, /presentation_mode[\s\S]*foreground[\s\S]*background/, 'generate_image schema must expose presentation_mode');
assert.match(defs, /presentation_mode[\s\S]*foreground[\s\S]*background/, 'model-facing tool definitions must expose presentation_mode');

assert.match(registry, /providerSupportsRequest\([\s\S]*?transparency[\s\S]*?maskEditing[\s\S]*?partialStreaming/, 'registry must route by provider capabilities');
assert.match(registry, /partialImages > 0[\s\S]*partialStreaming/, 'registry must require partial-streaming support only when partial images are requested');
assert.match(registry, /exactSizeRequested[\s\S]*exactSizes/, 'registry must reject exact width/height requests for providers without exact-size support');
assert.match(registry, /Mask editing requires at least one reference image edit target/, 'mask edits must require an edit target');
assert.match(registry, /normalizeImageSize/, 'registry must validate exact sizes before provider execution');
assert.match(registry, /normalizeImageOutputCompression/, 'registry must normalize output compression before provider execution');
assert.match(registry, /presentationMode/, 'registry errors/results must carry presentation mode');
assert.match(utils, /inspectImageBuffer/, 'persisted images must be inspected for actual dimensions/alpha');
assert.match(utils, /validateMaskImage[\s\S]*alpha channel[\s\S]*dimensions/, 'mask validation must check alpha and dimensions');

assert.match(openai, /readonly capabilities[\s\S]*transparency: true[\s\S]*maskEditing: true[\s\S]*outputCompression: true/, 'OpenAI provider must advertise alpha, mask, and compression capabilities');
assert.match(openai, /form\.append\('mask'/, 'OpenAI edits path must send mask files');
assert.match(openai, /output_compression/, 'OpenAI provider must forward output compression');
assert.match(codex, /partialStreaming: true/, 'Codex auth provider must advertise partial streaming');
assert.match(codex, /on_partial_image/, 'Codex auth provider must emit partial-image callbacks');
assert.match(codex, /partial_images: request\.partial_images/, 'Codex auth provider must honor partial_images control');
assert.match(codex, /generation_id: generated\.id \|\| null/, 'Codex auth final images must retain generation identity for partial replacement');
assert.match(xai, /transparency: false/, 'xAI provider must declare transparency unsupported');

assert.match(router, /inferImageGenerationPresentationMode/, 'main chat must infer image presentation mode at orchestration layer');
assert.match(router, /presentation_mode = inferImageGenerationPresentationMode/, 'main chat must write inferred presentation_mode into tool args');
assert.match(router, /sourceValue === 'generated_image' \? 'Generated image'/, 'durable trace must label generated-image previews');
assert.match(executor, /presentation_mode: args\.presentation_mode === 'background' \? 'background' : 'foreground'/, 'shared executor must preserve explicit background mode');
assert.match(executor, /buildGeneratedImageVisionEvent/, 'shared executor must emit generated-image visual preview events through the shared helper');
assert.match(executor, /buildGeneratedImageVisionEvent[\s\S]*Generated image partial/, 'shared executor must stream partial generated-image previews through the shared helper');
assert.match(webMedia, /presentation_mode: args\.presentation_mode === 'foreground' \? 'foreground' : 'background'/, 'workflow media executor should default images to background mode');
assert.match(webMedia, /buildGeneratedImageVisionEvent[\s\S]*Generated image/, 'workflow media executor must emit generated-image previews through the shared helper');

assert.match(desktop, /hasBackgroundImageGeneration[\s\S]*return false/, 'foreground loader must be suppressed for background image generation');
assert.match(desktop, /generated-image-preview\\\?cache=/, 'desktop UI must render cache-backed generated-image previews');
assert.match(desktop, /previewId[\s\S]*generationId[\s\S]*splice\(priorIndex, 1\)/, 'desktop UI must replace partial generated-image previews by stable identity');
assert.match(mobile, /generated-image-preview\\\?cache=/, 'mobile UI must render cache-backed generated-image previews');
assert.match(mobile, /previewId[\s\S]*generationId[\s\S]*splice\(priorIndex, 1\)/, 'mobile UI must replace partial generated-image previews by stable identity');
assert.match(skill, /presentation_mode="foreground"[\s\S]*presentation_mode="background"/, 'imagegen skill must teach foreground/background routing');
assert.match(skill, /PNG alpha `mask`/, 'imagegen skill must document selection mask editing');

console.log('[image-generation-flow] presentation routing, previews, capabilities, validation, and docs contracts passed');
