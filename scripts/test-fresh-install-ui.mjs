// Regression for the fresh-install UI audit (GR computer, IMG_2139-2146).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = (rel) => path.join(root, 'web-ui', rel);
const load = (rel) => import(pathToFileURL(web(rel)).href);
const read = (rel) => fs.readFileSync(web(rel), 'utf8');

// 1. The onboarding control block never shows in chat, closed or mid-stream.
const { stripOnboardingControlBlock } = await load('src/onboarding/onboarding-block.js');
const reply = 'Thanks, Raul!\n\n[ONBOARDING_COMPLETE]\n{"name":"Raul"}\n[/ONBOARDING_COMPLETE]\n\nLet me lock that in.';
assert.equal(stripOnboardingControlBlock(reply), 'Thanks, Raul!\n\nLet me lock that in.');
assert.equal(stripOnboardingControlBlock('Thanks!\n[ONBOARDING_COMPLETE]\n{"name":"Ra'), 'Thanks!');
assert.equal(stripOnboardingControlBlock('Plain reply'), 'Plain reply', 'ordinary text untouched');

// 2. Memory confirm describes changes in plain words and never hardcodes white/indigo.
const { memoryPlanSummary } = await load('src/onboarding/memory-confirm.js');
assert.equal(memoryPlanSummary('# USER\n', '# USER\n- Name: Raul\n- Works at GR Automotive\n'), 'Adds 2 lines about you');
assert.equal(memoryPlanSummary('a\nb', 'a\nb'), 'Small wording updates');
const memorySrc = read('src/onboarding/memory-confirm.js');
assert.doesNotMatch(memorySrc, /background:#fff|rgba\(99,102,241|chars`/, 'theme-token rows only');
assert.match(memorySrc, /Step 3 of 3/);
assert.match(read('src/onboarding/meet-panel.js'), /Step 2 of 3/);

// 3. Tour: sidebar steps open the sidebar, grouped steps union their targets, the finale prefills a prompt.
const { TOUR_STEPS, stepRect } = await load('src/onboarding/tutorial-overlay.js');
assert.ok(TOUR_STEPS.length <= 7, 'tour trimmed to 7 steps');
for (const step of TOUR_STEPS) {
  const selectors = step.targets || (step.target ? [step.target] : []);
  if (selectors.some((s) => /nav-|sessions-new|openSettings/.test(s))) assert.equal(step.needsSidebar, true, `${step.title} opens the sidebar`);
}
assert.ok(TOUR_STEPS.some((s) => Array.isArray(s.targets) && s.targets.length > 1), 'grouped spotlight step');
assert.ok(TOUR_STEPS.at(-1).starterPrompt, 'final step prefills a starter prompt');
globalThis.window = { innerWidth: 1200, innerHeight: 800 };
globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
const rects = { '#a': { left: 10, top: 100, right: 210, bottom: 130, width: 200, height: 30 }, '#b': { left: 10, top: 140, right: 230, bottom: 170, width: 220, height: 30 } };
globalThis.document = { querySelector: (s) => (rects[s] ? { getBoundingClientRect: () => rects[s] } : null) };
assert.deepEqual(stepRect({ targets: ['#a', '#b', '#missing'] }), { left: 10, top: 100, right: 230, bottom: 170, width: 220, height: 70 });
assert.equal(stepRect({ target: '#missing' }), null, 'missing target falls back to a centered card');
const tourCss = read('src/styles/onboarding.css');
assert.match(tourCss, /\.prom-tour-pulse/);
assert.match(tourCss, /\.prom-tour-arrow/);

// 4. Accounts show real provider logos instead of letters.
const { providerBadgeHtml } = await load('src/settings/provider-accounts-list.js');
for (const id of ['anthropic', 'openai_codex', 'openai', 'xai']) assert.match(providerBadgeHtml(id), /<svg[^>]+spa-prov-logo/, `${id} logo`);
assert.equal(providerBadgeHtml('future_provider', { letter: 'F' }), 'F', 'unknown providers keep their initial');
assert.doesNotMatch(read('src/settings/provider-accounts-list.js'), /Tap an account/);

// 5. Settings: no stray "Off.", empty-search message respects [hidden], browser rows live in their own section.
assert.doesNotMatch(read('src/pages/SettingsPage.js'), /'Off\.'/);
assert.doesNotMatch(read('src/mobile/mobile-settings.js'), /'Off\.'/);
const settingsCss = read('src/styles/settings.css');
assert.match(settingsCss, /\.settings-search-filter-empty\[hidden\]\s*\{\s*display:\s*none/);
const html = read('index.html');
assert.match(html, /<h2>Browser<\/h2>/);
assert.match(html, /settings-row-label-stack[\s\S]{0,200}id="settings-chrome-signin-sync-status"/, 'status sits inside its row');
assert.match(read('src/features/secure-access/secure-access-core.js'), /\.sa-settings \.sa-row>\.sa-btn\{flex:0 0 auto/);

console.log('fresh-install UI regression passed');
