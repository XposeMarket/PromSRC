// Agent pixel pets: validates the shared sprite module used by desktop + mobile.
// Run: node scripts/test-agent-pets.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'web-ui/src/components/agent-pets.js');
const cssPath = path.join(root, 'web-ui/src/styles/agent-pets.css');
const P = await import(pathToFileURL(modulePath).href);

// 1. Sprite set: 12 pets, 12x12 grids, unique ids, every sprite has eyes.
const ids = new Set();
assert.equal(P.AGENT_PETS.length, 12, 'twelve pets in the set');
for (const pet of P.AGENT_PETS) {
  assert.equal(pet.grid.length, 12, `${pet.id} has 12 rows`);
  pet.grid.forEach((row, i) => {
    assert.equal(row.length, 12, `${pet.id} row ${i} is 12 wide`);
    assert.match(row, /^[.okwbsa]+$/, `${pet.id} row ${i} uses only palette chars`);
  });
  assert.ok(!ids.has(pet.id), `pet id ${pet.id} is unique`);
  ids.add(pet.id);
  assert.ok(pet.grid.join('').includes('k'), `${pet.id} has eyes`);
}

// 2. Resolution: explicit pet wins, unknown falls back to the stable hash pet.
assert.equal(P.resolveAgentPetId({ id: 'forge', pet: 'kit' }), 'kit', 'explicit pet wins');
assert.equal(P.resolveAgentPetId({ id: 'forge', pet: 'nope' }), P.autoAgentPetId('forge'), 'unknown pet falls back to auto');
assert.equal(P.resolveAgentPetId('forge'), P.resolveAgentPetId('FORGE '), 'auto id is case/space insensitive');
assert.equal(P.autoAgentPetId('forge'), P.autoAgentPetId('forge'), 'auto pet is stable');

// 3. Remembered pets (from /api/agents) apply to id-only callers, and clearing resets to auto.
P.rememberAgentPets([{ id: 'forge', pet: 'hoot' }]);
assert.equal(P.resolveAgentPetId('forge'), 'hoot', 'remembered pet applies to id-only callers');
P.rememberAgentPets([{ id: 'forge' }]);
assert.equal(P.resolveAgentPetId('forge'), P.autoAgentPetId('forge'), 'cleared pet returns to auto');

// 4. Escaping and bounds.
assert.ok(!P.renderAgentPet({ id: 'x', name: '<img onerror=1>' }).includes('<img'), 'names are escaped');
assert.ok(P.renderAgentPet('x', { size: 9999 }).includes('--agent-pet-size:96px'), 'size is clamped to 96px');
assert.ok(P.renderAgentPet('x', { state: 'bogus' }).includes('agent-pet--idle'), 'unknown state falls back to idle');

// 5. Run state mapping.
assert.equal(P.agentPetStateFromRun({ lastRun: { inProgress: true } }), 'working');
assert.equal(P.agentPetStateFromRun({ lastRun: { error: 'x' } }), 'failed');
assert.equal(P.agentPetStateFromRun({}), 'idle');

// 6. Picker: Auto + 12 pets, selected state reflects the explicit pet.
const picker = P.renderAgentPetPickerHtml({ id: 'forge', pet: 'kit' });
assert.equal((picker.match(/data-agent-pet-choice=/g) || []).length, P.AGENT_PETS.length + 1, 'auto + every pet is a choice');
assert.ok(picker.includes('data-agent-pet-choice="kit" aria-pressed="true"'), 'explicit pet is selected');
assert.ok(picker.includes('data-agent-pet-choice="" aria-pressed="false"'), 'auto is not selected when a pet is explicit');

// 7. Stylesheet exists and styles the sprite root.
const css = fs.readFileSync(cssPath, 'utf8');
assert.ok(css.includes('.agent-pet'), 'agent-pets.css styles .agent-pet');

// 8. Wiring: every shipped surface imports the shared module (no robot/house/emoji avatars left).
const surfaces = [
  'web-ui/src/pages/SubagentsPage.js',
  'web-ui/src/pages/TeamsPage.js',
  'web-ui/src/prom-bot.js',
  'web-ui/src/pages/ChatPage.js',
  'web-ui/src/mobile/mobile-api.js',
  'web-ui/src/mobile/mobile-teams-pages.js',
  'web-ui/src/mobile/mobile-subagent-pages.js',
  'web-ui/src/mobile/mobile-pages.js',
];
for (const rel of surfaces) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(src, /components\/agent-pets\.js/, `${rel} imports the shared pet module`);
}
for (const rel of ['web-ui/src/pages/SubagentsPage.js', 'web-ui/src/pages/TeamsPage.js']) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.doesNotMatch(src, /drawAgentSVG|drawHouseSVG|AGENT_EMOJIS/, `${rel} has no robot/house avatar code left`);
}

// 9. Backend: the optional pet field is declared in config schema and the agent_update tool.
const schema = fs.readFileSync(path.join(root, 'src/config/config-schema.ts'), 'utf8');
assert.match(schema, /pet:\s+z\.string\(\)\.optional\(\)/, 'config schema declares pet');
const toolDef = fs.readFileSync(path.join(root, 'src/gateway/tools/defs/agent-team-schedule.ts'), 'utf8');
assert.match(toolDef, /pet: \{ type: 'string'/, 'agent_update advertises a pet param');

console.log('agent-pets: ok (12 pets, resolution, escaping, picker, stylesheet, surface wiring, backend schema)');
