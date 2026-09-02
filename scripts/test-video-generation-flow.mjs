import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const registry = read('src/video-generation/registry.ts');
const imageRegistry = read('src/image-generation/registry.ts');
const xai = read('src/video-generation/providers/xai.ts');
const xaiRuntime = read('src/media-generation/xai-runtime.ts');
const config = read('src/config/config-classic.ts');
const settings = read('src/gateway/routes/settings.router.ts');
const tool = read('src/tools/generate-video.ts');
const defs = read('src/gateway/tools/defs/file-web-memory.ts');
const voice = read('src/gateway/routes/chat.router.ts');
const blockForTool = (source, name) => {
  const start = source.indexOf(`name: '${name}'`);
  const next = source.indexOf("\n        name: '", start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
};

// Provider registration and auto-routing must match the providers that really
// exist in this build.
assert.match(registry, /new XAIVideoGenerationProvider\(\)/, 'xAI video provider must be registered');
assert.doesNotMatch(registry, /OpenAIVideoGenerationProvider|providers\/openai/, 'unsupported OpenAI video provider must not be registered');
assert.doesNotMatch(registry, /['"]openai['"]/, 'video auto-routing must not advertise OpenAI');
assert.match(registry, /Unknown video generation provider/, 'unknown providers must remain explicit errors');

assert.equal(fs.existsSync(path.join(root, 'src/video-generation/providers/openai.ts')), false, 'unsupported OpenAI video adapter must be removed');

// xAI OAuth must use the account pool, including legacy vault fallback, for
// both image and video instead of assuming one possibly stale account id.
assert.match(xaiRuntime, /getXaiAuthCandidates/, 'xAI media credentials must use the shared account pool');
assert.match(xaiRuntime, /legacy vault key/, 'xAI media credentials must retain legacy OAuth fallback');
assert.match(xai, /resolveXAIMediaRuntime/, 'xAI video must use the shared media runtime resolver');
const xaiImage = read('src/image-generation/providers/xai.ts');
assert.match(xaiImage, /resolveXAIMediaRuntime/, 'xAI image must use the shared media runtime resolver');
assert.match(xaiImage, /grok-imagine-image-2\.0/, 'xAI image must target the current Imagine image model');

// xAI image must downgrade exact pixels to its preset rather than fail before
// the provider receives the request.
assert.match(imageRegistry, /Exact pixels are an optional presentation preference[\s\S]*request\.exactSizeRequested && !caps\.exactSizes/, 'exact-size incompatibility must be treated as an optional downgrade');
assert.match(imageRegistry, /size: supportsExactSizes \? sizeInfo\.size : 'auto'/, 'non-exact-size providers must receive a preset-size request');
assert.match(xaiImage, /exactSizes: false/, 'xAI image must advertise preset-size capability');

// User-facing video schemas must expose only the registered xAI provider.
assert.match(tool, /enum: \['auto', 'xai'\]/, 'generate_video must expose xAI');
assert.doesNotMatch(tool, /openai/i, 'generate_video must not advertise OpenAI');
const mediaVideoBlock = blockForTool(defs, 'generate_video');
assert.match(mediaVideoBlock, /enum: \['auto', 'xai'\]/, 'media_generate video schema must expose xAI');
assert.doesNotMatch(defs, /name: 'generate_video'[\s\S]*?provider: \{[^}]*enum: \['auto', 'openai'/, 'media_generate video schema must not advertise OpenAI');
const voiceVideoBlock = blockForTool(voice, 'voice_generate_video');
assert.match(voiceVideoBlock, /enum: \['auto', 'xai'\]/, 'voice video schema must expose xAI');
assert.doesNotMatch(voice, /name: 'voice_generate_video'[\s\S]*?provider: \{[^}]*enum: \['auto', 'openai'/, 'voice video schema must not advertise OpenAI');
const videoConfig = config.slice(config.indexOf('video_generation:'), config.indexOf('tools:'));
assert.doesNotMatch(videoConfig, /openai/i, 'default video config must not register OpenAI');
assert.match(settings, /legacyConnected[\s\S]*loadXAITokens\(configDir, accountConnected/, 'xAI Settings status must recognize legacy OAuth fallback');
assert.match(settings, /if \(accountId && !accountConnected\) clearXAITokens\(CONFIG_DIR_PATH\)/, 'xAI disconnect must clear a legacy fallback token');

console.log('[video-generation-flow] xAI provider routing, OAuth fallback, preset-size normalization, and tool contracts passed');
