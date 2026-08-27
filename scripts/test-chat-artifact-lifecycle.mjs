import assert from 'node:assert/strict';
import fs from 'node:fs';

const desktop = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
const mobile = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const css = fs.readFileSync('web-ui/src/styles/components.css', 'utf8');

assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}fileChanges: mergeFileChangesWithBackground\(finalFileChanges, thisSessionId\)/, 'aborted desktop turns must retain file changes');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}richArtifacts: \(Array\.isArray\(finalRichArtifacts\)/, 'aborted desktop turns must retain rich artifacts');
assert.match(desktop, /saveInterruptedAssistantTurn[\s\S]{0,2600}canvasFiles: canvasPresentedFiles\.length/, 'aborted desktop turns must retain presented files');
assert.match(mobile, /function _compactMobileThreadCacheFileChanges\(/, 'mobile cold cache must have a dedicated file-change serializer');
assert.match(mobile, /fileChanges: _compactMobileThreadCacheFileChanges\(m\?\.fileChanges\)/, 'mobile cold cache must persist file changes');
assert.match(mobile, /\['generatedImages', 'generatedVideos', 'files', 'artifacts', 'fileChanges'\]/, 'empty file-change cache entries must be removed');
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}width: min\(100%, 640px\)/, 'desktop diff cards must have a bounded responsive width');
assert.match(css, /\.file-changes-card \{[\s\S]{0,180}box-sizing: border-box/, 'desktop diff cards must include their border in the width contract');

console.log('[chat-artifact-lifecycle] abort persistence, mobile cache retention, and bounded diff-card contracts passed');
