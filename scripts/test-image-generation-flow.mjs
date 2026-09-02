import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const types = read('src/image-generation/types.ts');
const registry = read('src/image-generation/registry.ts');
const utils = read('src/image-generation/utils.ts');
const openai = read('src/image-generation/providers/openai.ts');
const codex = read('src/image-generation/providers/openai-codex.ts');
const xai = read('src/image-generation/providers/xai.ts');
const mediaCredentials = read('src/media-generation/provider-credentials.ts');
const tool = read('src/tools/generate-image.ts');
const webMedia = read('src/gateway/agents-runtime/capabilities/web-media-executor.ts');
const capabilityRegistry = read('src/gateway/agents-runtime/capabilities/registry.ts');
const preview = read('src/gateway/generated-image-preview.ts');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const defs = read('src/gateway/tools/defs/file-web-memory.ts');
const skill = read('workspace/skills/imagegen/SKILL.md');

// Typed request/result and provider capability contract.
assert.match(types, /ImageGenerationPresentationMode = 'foreground' \| 'background'/, 'presentation mode must remain a typed result contract');
assert.match(types, /ImageGenerationProviderCapabilities/, 'provider capabilities must remain declared in image-generation types');
assert.match(tool, /presentation_mode\?: 'foreground' \| 'background' \| 'auto'/, 'generate_image must accept explicit/auto presentation routing');
assert.match(tool, /presentation_mode[\s\S]*foreground[\s\S]*background/, 'generate_image schema must describe foreground/background routing');
assert.match(defs, /presentation_mode[\s\S]*foreground[\s\S]*background/, 'model-facing tool definition must expose image presentation routing');

// Registry validation and provider routing.
assert.match(registry, /providerSupportsRequest\([\s\S]*?transparency[\s\S]*?maskEditing[\s\S]*?partialStreaming/, 'registry must route by provider capabilities');
assert.match(registry, /partialImages > 0[\s\S]*partialStreaming/, 'partial preview capability must remain part of provider routing');
assert.match(registry, /normalizeRequestForProvider[\s\S]*supportsPartialStreaming[\s\S]*partialImages/, 'providers without partial streaming must receive a normal non-streaming request');
assert.match(registry, /exactSizeRequested[\s\S]*exactSizes/, 'exact-size capability must remain part of provider routing');
assert.match(registry, /supportsExactSizes[\s\S]*sizeInfo\.size : 'auto'/, 'providers without exact-size support must receive a preset-size request');
assert.match(registry, /Mask editing requires at least one reference image edit target/, 'mask edits must require an edit target');
assert.match(registry, /normalizeImagePresentationMode\(request\.presentation_mode\)/, 'registry must normalize presentation mode centrally');
assert.match(utils, /normalizeImagePresentationMode[\s\S]*background[\s\S]*foreground/, 'presentation normalization must keep foreground as the direct-deliverable default');
assert.match(utils, /validateMaskImage[\s\S]*alpha channel[\s\S]*dimensions/, 'mask validation must check alpha and dimensions');
assert.match(utils, /inspectImageBuffer/, 'persisted images must be inspected for actual dimensions/alpha');

// Provider capability and credential paths.
assert.match(openai, /readonly capabilities[\s\S]*transparency: true[\s\S]*maskEditing: true[\s\S]*outputCompression: true/, 'OpenAI provider must advertise alpha, mask and compression support');
assert.match(openai, /form\.append\('mask'/, 'OpenAI edits must send mask files');
assert.match(openai, /output_compression/, 'OpenAI provider must forward output compression');
assert.match(codex, /partialStreaming: true/, 'Codex OAuth provider must advertise partial streaming');
assert.match(codex, /on_partial_image/, 'Codex OAuth provider must emit partial previews');
assert.match(codex, /partial_images: request\.partial_images/, 'Codex OAuth provider must honor partial_images');
assert.match(codex, /generation_id: generated\.id \|\| null/, 'final Codex images must retain generation identity');
assert.match(xai, /transparency: false/, 'xAI provider must declare unsupported transparency');
assert.match(xai, /grok-imagine-image-2\.0/, 'xAI image provider must target the current Imagine image model');
assert.match(registry, /Prefer it when callers say "openai"/, 'OpenAI routing must prefer saved Codex OAuth before API-key auth');
assert.match(mediaCredentials, /getConfiguredProviderAccountId/, 'media providers must resolve selected saved accounts');
assert.match(mediaCredentials, /providerSettings[\s\S]*accountId/, 'media providers must merge account-scoped settings');

// Current runtime ownership. The old chat.router/subagent-executor assertions were
// stale after the capability-runtime refactor; web-media is now the executable
// generate_image path and the registry installs that capability.
assert.match(webMedia, /case 'generate_image'/, 'web-media capability must own generate_image execution');
assert.match(webMedia, /executeGenerateImage\(/, 'web-media capability must call the shared image generator');
assert.match(webMedia, /presentation_mode: args\.presentation_mode === 'foreground' \? 'foreground' : 'background'/, 'workflow capability must preserve explicit foreground and otherwise use background working-asset mode');
assert.match(webMedia, /buildGeneratedImageVisionEvent[\s\S]*Generated image partial/, 'runtime must emit partial previews through the shared preview helper');
assert.match(webMedia, /buildGeneratedImageVisionEvent[\s\S]*Generated image/, 'runtime must emit final previews through the shared preview helper');
assert.match(capabilityRegistry, /webMediaCapabilityExecutor/, 'capability registry must install the web/media executor');

// Preview payloads must use constrained URLs and stable generation identity.
assert.match(preview, /GENERATED_IMAGE_CACHE_PREVIEW_ROUTE = '\/api\/canvas\/generated-image-preview'/, 'cache-only previews must use the constrained Canvas route');
assert.match(preview, /generation:\$\{generationId\}/, 'preview identity must prefer stable generation IDs');
assert.match(preview, /parent_generation_id[\s\S]*partial_index/, 'partial previews must retain parent generation identity including index zero');
assert.match(preview, /workspacePath: workspacePath \|\| undefined/, 'preview payload must distinguish workspace-backed images');
assert.doesNotMatch(preview, /base64,/i, 'preview payload helper must not embed image bytes as base64');

// Desktop/mobile presentation contracts.
assert.match(desktop, /presentationMode !== 'foreground'/, 'desktop foreground loader must require explicit foreground presentation');
assert.match(desktop, /presentationMode === 'background'\) return/, 'desktop foreground loader must ignore background working assets');
assert.match(desktop, /activeImageCalls[\s\S]*observedImageActivity/, 'desktop image loading must track open image calls instead of a stale text match');
assert.match(desktop, /!answerStarted && isGenerateImagePendingFromEntries/, 'desktop image loading must stop once the final response begins');
assert.match(desktop, /generated-image-preview\\\?cache=/, 'desktop must render constrained cache-backed previews');
assert.match(desktop, /previewId[\s\S]*generationId[\s\S]*splice\(priorIndex, 1\)/, 'desktop must replace matching partial previews by stable identity');
assert.match(mobile, /generated-image-preview\\\?cache=/, 'mobile must render constrained cache-backed previews');
assert.match(mobileRenderer, /message\?\.finalResponseStarted === true[\s\S]*message\?\._pmFinalReceived === true/, 'mobile image loading must stop at the final-response boundary');
assert.match(mobileRenderer, /activeImageCalls[\s\S]*observedImageActivity/, 'mobile image loading must reconcile duplicate process/live entries');
assert.match(mobile, /previewId[\s\S]*generationId[\s\S]*splice\(priorIndex, 1\)/, 'mobile must replace matching partial previews by stable identity');
assert.match(mobile, /presentationMode === 'foreground'/, 'mobile image stream filtering must require explicit foreground presentation');
assert.match(mobileRenderer, /presentationMode !== 'foreground'/, 'mobile foreground loader must require explicit foreground presentation');
assert.match(mobile, /hasInlineGeneratedImage[\s\S]{0,260}return \[\]/, 'mobile must not duplicate background working assets into the final gallery');
assert.match(mobile, /sourceValue === 'generated_image'\) message\._pmBackgroundImageGeneration = true/, 'generated-image events must mark background working assets inline-only');

// Agent-facing guidance must teach the foreground/background distinction.
assert.match(skill, /presentation_mode="foreground"[\s\S]*presentation_mode="background"/, 'imagegen skill must teach direct-deliverable vs working-asset routing');
assert.match(skill, /PNG alpha `mask`/, 'imagegen skill must document selection-mask editing');

console.log('[image-generation-flow] current capability runtime, providers, previews, validation, and UI contracts passed');
