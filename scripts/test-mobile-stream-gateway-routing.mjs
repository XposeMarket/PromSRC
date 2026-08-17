import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('web-ui/src/mobile/mobile-api.js');
const generated = read('generated/public-web-ui/static/mobile/mobile-api.js');

assert.equal(source, generated, 'generated mobile API shim must match canonical source');
assert.doesNotMatch(source, /const url = \(API \|\| ''\) \+ `\/api\/(?:teams|agents)\//, 'mobile SSE streams must not bypass the selected gateway origin');

function blockBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `expected block ${startMarker}`);
  return source.slice(start, end);
}

const team = blockBetween(
  'export function streamTeamChat',
  '\n/* ---------------- workspace / memory / tasks / voice ---------------- */',
);
assert.match(team, /_assertMobileRequestTarget\(\)/, 'team stream must fail closed for an invalid remote target');
assert.match(team, /const token = _mobileRequestToken\(\)/, 'team stream must capture the selected gateway pairing token');
assert.match(team, /const url = _buildUrl\(`\/api\/teams\//, 'team stream URL must use the selected gateway origin');
assert.match(team, /\.\.\.\(token \? \{ 'X-Pairing-Token': token \} : \{\}\)/, 'team stream must use the captured target-scoped token');
assert.doesNotMatch(team, /getDeviceToken\(\)/, 'team stream must not attach the legacy current-gateway token');

const subagent = blockBetween(
  'export function streamSubagentChat',
  '\nfunction _withTimeout',
);
assert.match(subagent, /_assertMobileRequestTarget\(\)/, 'subagent stream must fail closed for an invalid remote target');
assert.match(subagent, /const token = _mobileRequestToken\(\)/, 'subagent stream must capture the selected gateway pairing token');
assert.match(subagent, /const url = _buildUrl\(`\/api\/agents\//, 'subagent stream URL must use the selected gateway origin');
assert.match(subagent, /\.\.\.\(token \? \{ 'X-Pairing-Token': token \} : \{\}\)/, 'subagent stream must use the captured target-scoped token');
assert.doesNotMatch(subagent, /getDeviceToken\(\)/, 'subagent stream must not attach the legacy current-gateway token');

console.log('[test-mobile-stream-gateway-routing] passed: team/subagent SSE streams use selected gateway origin and grant');
