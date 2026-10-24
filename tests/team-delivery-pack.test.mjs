// Static docs-pack completeness and negative-fixture integrity only.
// This test does NOT validate live team/schedule configuration, runtime behavior,
// Roblox quality, release readiness, or the safety of any external change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'docs/team-delivery';
const REQUIRED_FILES = [
  'README.md',
  'roblox/TEAM.md',
  'roblox/PIPELINE.md',
  'roblox/QUALITY-ALIGNMENT.md',
  'OTHER-TEAMS.md',
];

const TEAMS = ['Roblox Studio', 'X Growth', 'Perf QA', 'Teams Gauntlet'];
const ROLES = ['Forge', 'Probe', 'Designer', 'manager'];
const SCHEDULES = [
  'Roblox Studio: Build Sprint (autonomous)',
  'Roblox Studio: Daily Pulse',
  'Roblox Studio: Weekly Strategy',
  'X Growth: Morning Brief',
  'X Editor: auto-select + post',
];
const OPERATIONS = ['replace', 'patch', 'no-op'];
const REQUIRED_SECTIONS = {
  'roblox/PIPELINE.md': ['Rollback', 'Snapshot', 'Evidence', 'Current-state'],
  'README.md': ['Rollback', 'Unique', 'Target', 'Preconditions'],
};

// Prohibited content: private IDs, local paths, account identifiers, secrets,
// public auto-publish and team auto-post instructions.
const PROHIBITED = [
  { name: 'absolute Windows user path', re: /[A-Za-z]:\\Users\\/i },
  { name: 'UUID-style identifier', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i },
  { name: 'long numeric identifier', re: /\b\d{7,}\b/ },
  { name: 'account handle', re: /(^|\s)@[A-Za-z0-9_.]{3,}/m },
  { name: 'secret-looking token', re: /\b(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|xox[abp]-[A-Za-z0-9-]{10,})/ },
  { name: 'public auto-publish instruction', re: /auto-?publish/i },
  { name: 'team auto-post instruction', re: /\bautopost\b/i },
];

// Live-activation claims are prohibited in an active-looking pack.
const ACTIVATION_CLAIM = /\b(has been|have been|is now|are now|now|was)\s+(activated|applied|live|enabled|published)\b|Status:\s*ACTIVE\b/i;

// Stale active-policy language that must not appear outside a clearly marked retired/negative note.
const STALE = [
  { name: 'one-milestone-per-sprint throttle', re: /one milestone per sprint|Do ONE milestone/i },
  { name: 'stale Q1-Q8 range', re: /Q1\s*[–-]\s*Q8/ },
  { name: 'stale reference floor 6/10', re: /at least 6 out of 10|>=\s*6\/10|6\/10/ },
];

function loadPack(overrides = {}) {
  const files = {};
  for (const rel of REQUIRED_FILES) {
    const p = join(root, PACK, rel);
    files[rel] = Object.prototype.hasOwnProperty.call(overrides, rel)
      ? overrides[rel]
      : existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return files;
}

// Returns an array of human-readable failures. Empty array = static completeness passes.
export function checkPack(files) {
  const errors = [];
  const all = Object.values(files).join('\n');

  for (const rel of REQUIRED_FILES) {
    if (!files[rel] || files[rel].trim() === '') errors.push(`missing or empty file: ${rel}`);
  }
  for (const team of TEAMS) {
    if (!all.includes(team)) errors.push(`missing team mapping: ${team}`);
  }
  for (const role of ROLES) {
    if (!all.includes(role)) errors.push(`missing role mapping: ${role}`);
  }
  for (const sched of SCHEDULES) {
    if (!all.includes(sched)) errors.push(`missing exact schedule display name: ${sched}`);
  }
  for (const op of OPERATIONS) {
    if (!files['README.md']?.includes(op)) errors.push(`missing operation vocabulary: ${op}`);
  }
  for (const [rel, words] of Object.entries(REQUIRED_SECTIONS)) {
    for (const w of words) {
      if (!files[rel]?.toLowerCase().includes(w.toLowerCase())) errors.push(`missing "${w}" in ${rel}`);
    }
  }
  // Unresolved-target rule: the pack must say what happens when a name does not resolve uniquely.
  if (!/zero or multiple|more than one|ambiguous/i.test(files['README.md'] ?? '')) {
    errors.push('unresolved-target rule missing: README must state zero/multiple matches fail closed');
  }
  for (const p of PROHIBITED) {
    for (const [rel, text] of Object.entries(files)) {
      if (p.re.test(text)) errors.push(`prohibited content (${p.name}) in ${rel}`);
    }
  }
  for (const [rel, text] of Object.entries(files)) {
    if (ACTIVATION_CLAIM.test(text)) errors.push(`live-activation claim in ${rel}`);
    for (const s of STALE) {
      if (s.re.test(text) && !/retired|superseded|not used|negative example/i.test(text)) {
        errors.push(`stale active-policy language (${s.name}) in ${rel}`);
      }
    }
  }
  return errors;
}

test('real staged pack passes static completeness (structure only)', () => {
  const errors = checkPack(loadPack());
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('negative: missing team mapping fails', () => {
  const files = loadPack();
  files['OTHER-TEAMS.md'] = files['OTHER-TEAMS.md'].replaceAll('Teams Gauntlet', 'REMOVED');
  files['README.md'] = files['README.md'].replaceAll('Teams Gauntlet', 'REMOVED');
  assert.ok(checkPack(files).some((e) => e.includes('Teams Gauntlet')));
});

test('negative: unresolved target without fail-closed rule fails', () => {
  const files = loadPack({ 'README.md': loadPack()['README.md'].replace(/zero or multiple|more than one|ambiguous/gi, 'skipped') });
  assert.ok(checkPack(files).some((e) => e.includes('unresolved-target rule')));
});

test('negative: missing rollback fails', () => {
  const files = loadPack({ 'roblox/PIPELINE.md': loadPack()['roblox/PIPELINE.md'].replaceAll('Rollback', 'Undo') });
  assert.ok(checkPack(files).some((e) => e.includes('"Rollback"')));
});

test('negative: live-activation claim fails', () => {
  const files = loadPack({ 'README.md': loadPack()['README.md'] + '\nThe X clause has been applied to the live Morning Brief.\n' });
  assert.ok(checkPack(files).some((e) => e.includes('live-activation claim')));
});

test('negative: prohibited local path fails', () => {
  const files = loadPack({ 'README.md': loadPack()['README.md'] + '\nSee C:\\Users\\someone\\notes.\n' });
  assert.ok(checkPack(files).some((e) => e.includes('absolute Windows user path')));
});
