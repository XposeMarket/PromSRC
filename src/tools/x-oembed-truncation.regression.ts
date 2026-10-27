// Regression: X oEmbed clips long-form (note) posts with a trailing ellipsis.
// web_fetch must detect that and not report the clipped text as complete.
import assert from 'node:assert/strict';
import { isLikelyTruncatedXText } from './web.js';

const clipped = 'Before you launch anything, have Opus 5.5 send 5 subagents in as your first users. Paste this into Claude Code: "Act as my launch QA lead. Spin up 5 subagents, each a different first-time user: 1. The impatient one: skims, clicks the first button, quits at the first error 2.\u2026';
assert.equal(isLikelyTruncatedXText(clipped), true, 'oEmbed note-tweet clip must be flagged');
assert.equal(isLikelyTruncatedXText(clipped.replace(/\u2026$/, '...')), true, 'ascii ellipsis clip must be flagged');
assert.equal(isLikelyTruncatedXText('Short post ending in thought\u2026'), false, 'short posts with ellipsis are intentional');
assert.equal(isLikelyTruncatedXText('x'.repeat(270) + '.'), false, 'full-length post without ellipsis is complete');
assert.equal(isLikelyTruncatedXText(''), false);
console.log('x-oembed-truncation regression: PASS');
