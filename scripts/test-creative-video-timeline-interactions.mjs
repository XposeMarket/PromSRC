import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const interactions = read('web-ui', 'src', 'components', 'creative', 'compositionInteractions.js');
const publicInteractions = read('generated', 'public-web-ui', 'static', 'components', 'creative', 'compositionInteractions.js');
const runtime = read('web-ui', 'src', 'components', 'creative', 'featureRuntime.js');
const publicRuntime = read('generated', 'public-web-ui', 'static', 'components', 'creative', 'featureRuntime.js');
const timeline = read('web-ui', 'src', 'components', 'creative', 'editor', 'timeline', 'editor.js');
const importer = read('web-ui', 'src', 'components', 'creative', 'editor', 'assets', 'importer.js');

assert.equal(publicInteractions, interactions, 'public composition interaction module must stay synced');
assert.equal(publicRuntime, runtime, 'public Creative feature runtime must stay synced');

assert.match(runtime, /installCreativeCompositionTimelineInteractions\(\)/, 'lazy Creative runtime must install composition interactions');
assert.match(runtime, /protected mode until `drop`/, 'runtime must document protected drag payload behavior');
assert.match(runtime, /dataTransfer\?\.types\?\.includes\?\.\('text\/ce-asset-id'\)/, 'dragover arming must use the drag type marker without reading protected payload data');

assert.match(interactions, /data-ce-comp-trim="head"/, 'composition clips must receive a head trim handle');
assert.match(interactions, /data-ce-comp-trim="tail"/, 'composition clips must receive a tail trim handle');
assert.match(interactions, /b\.moveClip\?\.\(current\.clipId, \{ atMs:/, 'direct composition drag must persist absolute clip movement');
assert.match(interactions, /b\.trimClip\?\.\(current\.clipId, 'head'/, 'head drag must persist trim edits');
assert.match(interactions, /b\.trimClip\?\.\(current\.clipId, 'tail'/, 'tail drag must persist trim edits');
assert.match(interactions, /lane: 'source-video'/, 'video assets added to sequence must use the source-video lane');
assert.match(interactions, /source: \{ kind: 'source-video', path: String\(asset\.path\) \}/, 'sequence assets must use persisted workspace-relative video paths');
assert.match(interactions, /data-ce-add-sequence/, 'persisted video assets must expose an explicit sequence-add affordance');
assert.match(interactions, /event\.stopImmediatePropagation\(\)[\s\S]*addVideoAssetToSequence/, 'composition-lane drops must not also add duplicate scene clips');
assert.match(interactions, /key === 'delete' \|\| key === 'backspace'/, 'Delete/Backspace must target an active composition clip');
assert.match(interactions, /key === 's'/, 'S split shortcut must target an active composition clip');

assert.ok(
  timeline.includes("e.target.closest?.('[data-ce-comp-action],[data-ce-comp-clip]')) return;"),
  'base timeline intentionally delegates composition pointer interaction to the capture-layer module',
);
assert.match(importer, /path: persisted\?\.path \|\| null/, 'video asset descriptors must retain workspace-relative paths for source-video composition clips');

console.log('[creative-video-timeline-interactions] direct sequence move/trim/drop/keyboard contracts passed');
