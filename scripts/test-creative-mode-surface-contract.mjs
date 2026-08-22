import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const tools = read('src/gateway/tools/defs/creative-tools.ts');
const editor = read('web-ui/src/components/creative/editor/index.js');
const designRegression = read('scripts/test-design-preview-contract.mjs');
const imageRegression = read('scripts/test-image-generation-flow.mjs');
const promptContext = read('src/gateway/prompt-context.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const overview = read('workspace/self/creative/00-overview.md');

assert.match(tools, /design[\s\S]*image[\s\S]*canvas[\s\S]*video/, 'Creative tool definitions must retain all supported mode values');

assert.match(designRegression, /same-origin/i, 'Design mode regression must protect same-origin preview inspection');
assert.match(designRegression, /hover/i, 'Design mode regression must protect hover targeting');
assert.match(designRegression, /Edit[\s\S]*Chat[\s\S]*Select/i, 'Design mode regression must protect the preview interaction actions');

assert.match(editor, /Only mount the video editor for 'video' mode/, 'dedicated Creative editor must stay Video-only');
assert.match(editor, /const isVideoMode = mode === 'video'/, 'Video mode must be the only dedicated editor mount condition');
assert.match(editor, /Image, design, and other modes keep their own native canvas UI untouched/, 'Image/Design native surfaces must not be replaced by the Video editor');

assert.match(imageRegression, /web-media capability must own generate_image execution/, 'Image regression must target the current capability executor');
assert.doesNotMatch(imageRegression, /read\('src\/gateway\/routes\/chat\.router\.ts'\)/, 'Image regression must not depend on the retired chat.router implementation');
assert.doesNotMatch(imageRegression, /read\('src\/gateway\/agents-runtime\/subagent-executor\.ts'\)/, 'Image regression must not depend on the retired monolithic subagent executor');

assert.equal(chatRouter.trim(), '', 'chat.router.ts is currently only an empty compatibility shell; update this contract if it becomes an execution owner again');
assert.doesNotMatch(promptContext, /creative_design|creative_image|creative_canvas|creative_video/, 'named legacy creative prompt profiles must not silently reappear without updating the Creative architecture contract');
assert.doesNotMatch(overview, /isolated Creative Runtime uses|Creative prompt profiles exist/, 'Creative overview must not describe retired isolated-runtime/prompt-profile ownership');
assert.match(overview, /Design[\s\S]*Image[\s\S]*Video/, 'Creative overview must cover all three active user-facing mode families');

console.log('[creative-mode-surface-contract] Design, Image, and Video ownership boundaries are current');
