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
  assert.equal(a.getAll().length, 2, 'first access must scan synchronously and return the full catalog');
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
  assert.equal(warmed, 2);

  console.log('skills-manager-lazy-scan regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
