import assert from 'node:assert/strict';
import fs from 'node:fs';

const desktop = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const mobile = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const renderer = fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js', 'utf8');
const css = fs.readFileSync('web-ui/src/styles/components.css', 'utf8');

assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}fileChanges: mergeFileChangesWithBackground\(finalFileChanges, thisSessionId\)/, 'aborted desktop turns must retain file changes');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}richArtifacts: \(Array\.isArray\(finalRichArtifacts\)/, 'aborted desktop turns must retain rich artifacts');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}canvasFiles: canvasPresentedFiles\.length/, 'aborted desktop turns must retain presented files');
assert.match(mobile, /function _compactMobileThreadCacheFileChanges\(value\)/, 'mobile cold cache must delegate file-change serialization to the chat runtime');
assert.match(renderer, /function _compactMobileThreadCacheFileChanges\(/, 'chat runtime must own the file-change serializer');
assert.match(mobile, /fileChanges: _compactMobileThreadCacheFileChanges\(m\?\.fileChanges\)/, 'mobile cold cache must persist file changes');
assert.match(mobile, /for \(const key of \['generatedImages', 'generatedVideos', 'files', 'artifacts'\]\)/, 'array cache entries must use array cleanup');
assert.match(mobile, /if \(!compact\.fileChanges \|\| typeof compact\.fileChanges !== 'object'/, 'file-change cache entries must use object cleanup');
assert.match(mobile, /Array\.isArray\(compact\.fileChanges\.files\) \|\| !compact\.fileChanges\.files\.length/, 'empty file-change objects must be removed without deleting valid data');

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
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}width: min\(100%, 640px\)/, 'desktop diff cards must have a bounded responsive width');
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}box-sizing: border-box/, 'desktop diff cards must include their border in the width contract');

console.log('[chat-artifact-lifecycle] abort persistence, mobile cache retention, and bounded diff-card contracts passed');
