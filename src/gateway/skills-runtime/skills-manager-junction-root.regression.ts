// Regression: when the skills root is a Windows directory junction (the default
// desktop layout links <data>/.prometheus/skills -> <workspace>/skills), Node's
// recursive mkdir under the junction throws ENOENT, so skill_ops create and
// create_bundle failed for every new skill. SkillsManager must resolve the real
// directory and create bundles successfully through a junction/symlink root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-skills-junction-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;
process.env.PROMETHEUS_DISABLE_ELISION_DIAGNOSTICS = '1';

async function main() {
  const { SkillsManager, resolveRealSkillsDir } = await import('./skills-manager');
  const realDir = path.join(tmp, 'workspace', 'skills');
  fs.mkdirSync(realDir, { recursive: true });
  const linkParent = path.join(tmp, '.prometheus');
  fs.mkdirSync(linkParent, { recursive: true });
  const linkDir = path.join(linkParent, 'skills');
  fs.symlinkSync(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(
    path.resolve(resolveRealSkillsDir(linkDir)).toLowerCase(),
    path.resolve(fs.realpathSync(realDir)).toLowerCase(),
    'junction root must resolve to the real skills directory',
  );

  const mgr = new SkillsManager(linkDir);
  assert.equal(
    path.resolve(mgr.getSkillsDir()).toLowerCase(),
    path.resolve(fs.realpathSync(realDir)).toLowerCase(),
  );

  const skill = mgr.createBundle({
    id: 'junction-root-fixture',
    name: 'Junction root fixture',
    description: 'Fixture skill created through a junction skills root.',
    instructions: '# Junction root fixture\n\nBody.',
    implicitInvocation: false,
  } as any);
  assert.equal(skill.id, 'junction-root-fixture');
  assert.ok(fs.existsSync(path.join(realDir, 'junction-root-fixture', 'SKILL.md')), 'SKILL.md must land in the real directory');
  assert.ok(fs.existsSync(path.join(linkDir, 'junction-root-fixture', 'SKILL.md')), 'and be visible through the junction');

  console.log('skills-manager-junction-root regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
