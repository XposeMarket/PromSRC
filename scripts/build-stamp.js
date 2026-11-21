#!/usr/bin/env node
/**
 * Marks dist/ as a completed backend build of the current source tree.
 *
 *   node scripts/build-stamp.js begin     first step of build:backend: drops dist/.build-complete.json
 *                                         and records the build start in dist/.build-in-progress.json
 *   node scripts/build-stamp.js complete  last step, after tsc and every copy step succeeded
 *
 * Source checkouts launch the compiled gateway (no tsx) only while this stamp is newer than
 * every source file. See electron/compiled-build-freshness.js.
 */
const path = require('path');
const { beginBuildStamp, completeBuildStamp } = require('../electron/compiled-build-freshness.js');

const root = path.resolve(__dirname, '..');
const action = process.argv[2];
if (action === 'begin') beginBuildStamp(root);
else if (action === 'complete') {
  if (!completeBuildStamp(root)) {
    console.warn('[build] A newer backend build took over dist/; leaving the completion stamp to it.');
  }
} else {
  console.error('usage: node scripts/build-stamp.js begin|complete');
  process.exit(2);
}
