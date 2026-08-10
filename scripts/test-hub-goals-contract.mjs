import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const sourcePage = read('web-ui/src/pages/HubPage.js');
const generatedPage = read('generated/public-web-ui/static/pages/HubPage.js');
const sourceCss = read('web-ui/src/styles/hub.css');
const generatedCss = read('generated/public-web-ui/static/styles/hub.css');
const sourceHtml = read('web-ui/index.html');
const generatedHtml = read('generated/public-web-ui/index.html');

assert.match(sourcePage, /const GOALS_INITIAL_VISIBLE_COUNT = 4;/);
assert.match(sourcePage, /const GOALS_RENDER_BATCH_SIZE = 4;/);
assert.match(sourcePage, /const visibleGoals = _goals\.slice\(0, visibleCount\);/);
assert.match(sourcePage, /addEventListener\('scroll', _goalsScrollHandler/);
assert.match(sourcePage, /data-goal-load-more/);
assert.match(sourcePage, /role="button"[^>]*aria-label=/);
assert.match(sourcePage, /aria-expanded="\$\{expanded \? 'true' : 'false'\}"/);
assert.match(sourcePage, /Loading goals…/);
assert.match(sourcePage, /No main-chat goals yet\./);
assert.match(sourcePage, /Unable to load goals\./);
assert.match(sourcePage, /loadGoals\(\{ force: true \}\)/);

assert.match(sourceCss, /\.hub-achievements-grid[\s\S]*max-height: min\(440px, calc\(100vh - 260px\)\)/);
assert.match(sourceCss, /\.hub-achievements-grid[\s\S]*overflow-y: auto/);
assert.match(sourceCss, /overscroll-behavior: contain/);
assert.match(sourceCss, /@media \(max-width: 720px\)[\s\S]*\.hub-split \{ grid-template-columns: 1fr; gap: 12px; \}/);

assert.match(sourceHtml, /id="hub-goals-refresh"[^>]*aria-label="Refresh goals"/);
assert.match(sourceHtml, /id="hub-goals-status"[^>]*role="status"/);
assert.match(sourceHtml, /id="hub-achievements-grid"[^>]*role="region"[^>]*aria-label="Goals"/);

assert.equal(sourcePage, generatedPage, 'generated HubPage.js must match web-ui source');
assert.equal(sourceCss, generatedCss, 'generated hub.css must match web-ui source');
assert.match(generatedHtml, /id="hub-goals-refresh"[^>]*aria-label="Refresh goals"/);
assert.match(generatedHtml, /id="hub-achievements-grid"[^>]*role="region"[^>]*aria-label="Goals"/);

console.log('hub goals contract: ok');
