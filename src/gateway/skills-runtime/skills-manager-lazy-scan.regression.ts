// The skill catalog scan (~0.6-0.9s for ~200 skills) used to run in the
// SkillsManager constructor, before the gateway listener bound. It is now lazy:
// construction must not scan, the first real access must scan synchronously
// (callers never see an empty catalog), and warmInBackground() must scan
// without blocking the caller.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skills-lazy-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;
process.env.PROMETHEUS_DISABLE_ELISION_DIAGNOSTICS = '1';

function writeSkill(root: string, id: string) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: lazy scan fixture ${id}\n---\n# ${id}\nBody.\n`);
}

async function main() {
  const { SkillsManager } = await import('./skills-manager');
  const skillsDir = path.join(tmp, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  writeSkill(skillsDir, 'alpha-fixture');
  writeSkill(skillsDir, 'beta-fixture');

  const a = new SkillsManager(skillsDir);
  assert.equal(a.hasScanned(), false, 'constructor must not scan the catalog');
  // Bundled connector skills (connector-*) are appended to every catalog, so count fixtures only.
  const fixtures = (m: { getAll(): Array<{ id: string }> }) => m.getAll().filter((s) => s.id.endsWith('-fixture')).length;
  assert.equal(fixtures(a), 2, 'first access must scan synchronously and return the full catalog');
  assert.equal(a.hasScanned(), true);
  assert.ok(a.get('alpha-fixture'), 'get() must resolve after lazy scan');

  const b = new SkillsManager(skillsDir);
  assert.ok(b.get('beta-fixture'), 'get() before any explicit scan must still resolve (no empty catalog)');

  const c = new SkillsManager(skillsDir);
  let warmed = -1;
  c.warmInBackground((count) => { warmed = count; });
  assert.equal(c.hasScanned(), false, 'warmInBackground must not scan synchronously');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(c.hasScanned(), true, 'warmInBackground must complete the scan off the caller path');
  assert.equal(warmed, c.getAll().length);
  assert.equal(fixtures(c), 2);

  // Time-sliced warm (gateway boot): with a 0ms budget every slice loads one
  // package and yields, so the warm spans many event-loop turns, never stalls,
  // and only publishes the catalog once it is complete.
  for (const id of ['gamma-fixture', 'delta-fixture', 'epsilon-fixture', 'zeta-fixture', 'eta-fixture', 'theta-fixture']) writeSkill(skillsDir, id);
  const d = new SkillsManager(skillsDir);
  let dWarmed = -1;
  d.warmInBackground((count) => { dWarmed = count; }, 0);
  let ticks = 0;
  while (dWarmed < 0 && ticks < 500) { await new Promise((r) => setImmediate(r)); ticks++; }
  assert.ok(ticks >= 8, `a sliced warm must yield between packages (finished after ${ticks} ticks)`);
  assert.equal(d.hasScanned(), true);
  assert.equal(fixtures(d), 8, 'the sliced warm must load every package');
  assert.equal(dWarmed, d.getAll().length);

  // A synchronous access during the warm wins: it scans immediately, and the
  // warm discards its partial work instead of replacing the catalog later.
  const e = new SkillsManager(skillsDir);
  let eWarmed = -1;
  e.warmInBackground((count) => { eWarmed = count; }, 0);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(e.hasScanned(), false, 'warm still in progress');
  assert.equal(fixtures(e), 8, 'a synchronous access mid-warm must return the full catalog');
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  assert.equal(eWarmed, -1, 'a warm overtaken by a synchronous scan must not publish its partial catalog');
  assert.equal(fixtures(e), 8);

  console.log('skills-manager-lazy-scan regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
