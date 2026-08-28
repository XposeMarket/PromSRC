import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const css = read('web-ui/src/styles/components.css');

assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}fileChanges: mergeFileChangesWithBackground\(finalFileChanges, thisSessionId\)/, 'aborted desktop turns must retain file changes');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}richArtifacts: \(Array\.isArray\(finalRichArtifacts\)/, 'aborted desktop turns must retain rich artifacts');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}canvasFiles: canvasPresentedFiles\.length/, 'aborted desktop turns must retain presented files');
assert.match(mobile, /function _compactMobileThreadCacheFileChanges\(value\)/, 'mobile cold cache must delegate file-change serialization to the chat runtime');
assert.match(renderer, /function _compactMobileThreadCacheFileChanges\(/, 'chat runtime must own the file-change serializer');
assert.match(mobile, /fileChanges: _compactMobileThreadCacheFileChanges\(m\?\.fileChanges\)/, 'mobile cold cache must persist file changes');
assert.match(mobile, /for \(const key of \['generatedImages', 'generatedVideos', 'files', 'artifacts'\]\)/, 'array cache entries must use array cleanup');
assert.match(mobile, /function _hasMobileFileChanges\(value\)/, 'file-change cleanup must inspect grouped payloads');
assert.match(mobile, /if \(!_hasMobileFileChanges\(compact\.fileChanges\)\)/, 'empty file-change objects must be removed without deleting valid data');

const helperStart = renderer.indexOf('function _compactMobileThreadCacheFileChanges(');
const helperEnd = renderer.indexOf('\n\n// Chat rich-message', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'file-change compaction helper must be extractable for behavioral coverage');
const compactFileChanges = new Function(
  `${renderer.slice(helperStart, helperEnd)}; return _compactMobileThreadCacheFileChanges;`,
)();
const compacted = compactFileChanges({
  summary: { fileCount: 1, insertions: 3, deletions: 1 },
  files: [{ path: 'src/example.js', status: 'modified', insertions: 3, deletions: 1 }],
});
assert.equal(compacted.files.length, 1, 'valid file-change objects survive cache compaction');
assert.equal(compacted.files[0].path, 'src/example.js', 'compaction preserves the file path');
assert.equal(compactFileChanges({ files: [] }), undefined, 'empty file-change objects are omitted');

const retentionStart = mobile.indexOf('function _hasMobileFileChanges(');
const retentionEnd = mobile.indexOf('\n\nfunction _compactMobileThreadCacheValue', retentionStart);
assert(retentionStart >= 0 && retentionEnd > retentionStart, 'file-change retention helper must be extractable for behavioral coverage');
const mobileFileChangesHasEntries = new Function(
  `${mobile.slice(retentionStart, retentionEnd)}; return _hasMobileFileChanges;`,
)();
const groupedOnly = compactFileChanges({
  groups: [{
    id: 'background-1',
    fileChanges: {
      files: [{ path: 'src/background.js', status: 'modified' }],
    },
  }],
});
assert.equal(groupedOnly.files, undefined, 'groups-only payloads must not invent a top-level file list');
assert.equal(groupedOnly.groups.length, 1, 'groups-only payloads survive compaction');
assert.equal(mobileFileChangesHasEntries(groupedOnly), true, 'groups-only payloads are retained by cache cleanup');
assert.equal(mobileFileChangesHasEntries({ groups: [{ fileChanges: { files: [] } }] }), false, 'empty groups are still removed');
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}width: min\(100%, 640px\)/, 'desktop diff cards must have a bounded responsive width');
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}box-sizing: border-box/, 'desktop diff cards must include their border in the width contract');

console.log('[chat-artifact-lifecycle] abort persistence, mobile cache retention, and bounded diff-card contracts passed');
