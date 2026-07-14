import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await import(pathToFileURL(path.join(root, 'dist/gateway/browser-tools.js')).href);
const defs = browser.getBrowserToolDefinitions();
const wrapper = (name) => defs.find((entry) => entry.function?.name === name)?.function;

assert.deepEqual(defs.slice(0, 4).map((entry) => entry.function.name), ['browser_session', 'browser_observe', 'browser_act', 'browser_extract']);
assert.equal(browser.resolveBrowserObserveMode('browser_press_key'), 'none');
assert.equal(browser.resolveBrowserObserveMode('browser_fill'), 'none');
assert.equal(browser.resolveBrowserObserveMode('browser_click'), 'none');

const actProps = wrapper('browser_act').parameters.properties;
assert.ok(actProps.fast, 'browser_act must expose fast:true alias');
const extractProps = wrapper('browser_extract').parameters.properties;
assert.ok(extractProps.include_bodies, 'network bodies must be explicit opt-in');
assert.ok(extractProps.body_max_chars, 'network body output must expose a cap');
assert.ok(extractProps.page_only, 'console reads must expose page scoping');
assert.ok(extractProps.steps, 'smoke tests must expose declarative interaction/assertion steps');

const missing = browser.resolveBrowserExtractionSchemaForUrl('https://example.com', {});
assert.match(missing.error, /Minimum valid schema/);
assert.match(missing.error, /container_selector/);
assert.match(missing.error, /fields/);

const invalidType = browser.resolveBrowserExtractionSchemaForUrl('https://example.com', {
  container_selector: 'body', fields: { links: { selector: 'a', type: 'list' } },
});
assert.match(invalidType.error, /Unsupported extraction field type/);

const valid = browser.resolveBrowserExtractionSchemaForUrl('https://example.com', {
  container_selector: 'body', fields: { title: { selector: 'h1', type: 'text' } },
});
assert.equal(valid.schema.containerSelector, 'body');
assert.equal(valid.schema.fields.title.type, 'text');

const source = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'src/gateway/browser-tools.ts'), 'utf8'));
assert.match(source, /session\.context\.on\('response', handler\)/, 'network interception must be context-scoped across page changes');
assert.doesNotMatch(source, /session\.page\.on\('response', handler\)/, 'network interception must not attach only to the current page');
const executorSource = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8'));
assert.match(executorSource, /const nativeText = \['button','a','summary','option'\]/, 'a11y audit must honor native button/link text');
assert.match(executorSource, /browserRunSmokeSteps/, 'smoke tests must execute declarative steps');

console.log('PASS: browser wrapper, payload-budget, fast-action, and extraction contracts');
