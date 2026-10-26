/**
 * Authoring lifecycle regression for the v2 triggerPolicy field.
 * Exercises the real SkillsManager surfaces (createSkill, createBundle,
 * writeManifestOverlay, importBundles, exportBundle, inspect after reload).
 * Invalid input must reject with zero filesystem writes. Run:
 *   npx tsx src/gateway/skills-runtime/skill-authoring-lifecycle.regression.ts
 * Scope: new file, owned by the engine lane. Main owns docs.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillsManager } from './skills-manager';
import { rankSkillsForQuery } from '../agents-runtime/capabilities/skills-executor';

const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`not ok - ${name}`, err);
  }
}

// Deterministic text dump of a directory tree (paths + file contents).
function tree(dir: string): string {
  if (!fs.existsSync(dir)) return '<none>';
  const out: string[] = [];
  const walk = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        out.push(`${path.relative(dir, p)}/`);
        walk(p);
      } else {
        out.push(`${path.relative(dir, p)}=${fs.readFileSync(p, 'utf-8')}`);
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-lifecycle-'));
const skillsDir = path.join(base, 'skills');
fs.mkdirSync(skillsDir, { recursive: true });
const newManager = () => new SkillsManager(skillsDir);

const AUTO = { version: 2, mode: 'auto', rules: [{ allOf: ['draw', 'portrait'] }] };
const EXPLICIT = { version: 2, mode: 'explicit' };
const INVALID_EMPTY_RULE = { version: 2, mode: 'auto', rules: [{ allOf: [] }] };
const INVALID_UNKNOWN_KEY = { version: 2, mode: 'auto', rules: [{ allOf: ['draw'], bogus: 1 }] };

async function main() {
  await check('createBundle: invalid triggerPolicy rejects with zero writes', () => {
    const m = newManager();
    const before = tree(skillsDir);
    assert.throws(() => m.createBundle({
      id: 'bad-bundle', name: 'Bad Bundle', description: 'd', instructions: 'Body.',
      triggerPolicy: INVALID_EMPTY_RULE,
    }), /Invalid skill triggerPolicy/);
    assert.equal(tree(skillsDir), before, 'no partial write');
    assert.equal(fs.existsSync(path.join(skillsDir, 'bad-bundle')), false);
  });

  await check('createBundle: null triggerPolicy is present-invalid, not a clear', () => {
    const m = newManager();
    const before = tree(skillsDir);
    assert.throws(() => m.createBundle({
      id: 'null-bundle', name: 'Null', description: 'd', instructions: 'Body.', triggerPolicy: null,
    }), /Invalid skill triggerPolicy/);
    assert.equal(tree(skillsDir), before);
  });

  await check('createBundle: valid auto policy persists, inspect returns raw policy after reload', () => {
    const m = newManager();
    m.createBundle({
      id: 'portrait-bundle', name: 'Portrait', description: 'd', instructions: 'Body.',
      triggerPolicy: AUTO,
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(skillsDir, 'portrait-bundle', 'skill.json'), 'utf-8'));
    assert.deepEqual(onDisk.triggerPolicy, AUTO);
    const reloaded = newManager().inspect('portrait-bundle') as any;
    assert.deepEqual(reloaded.triggerPolicy, AUTO, 'raw roundtrip, not validation wrapper');
    assert.deepEqual(reloaded.triggerPolicyErrors, []);
  });

  await check('createSkill: invalid triggerPolicy rejects with zero writes', () => {
    const m = newManager();
    const before = tree(skillsDir);
    assert.throws(() => m.createSkill({
      id: 'bad-skill', name: 'Bad Skill', description: 'd', instructions: 'Body.',
      triggerPolicy: INVALID_UNKNOWN_KEY,
    } as any), /Invalid skill triggerPolicy/);
    assert.equal(tree(skillsDir), before);
    assert.equal(fs.existsSync(path.join(skillsDir, 'bad-skill')), false);
  });

  await check('createSkill: valid explicit policy persists and reloads', () => {
    const m = newManager();
    m.createSkill({
      id: 'explicit-skill', name: 'Explicit Skill', description: 'd', instructions: 'Body.',
      triggerPolicy: EXPLICIT,
    } as any);
    const reloaded = newManager().inspect('explicit-skill') as any;
    assert.deepEqual(reloaded.triggerPolicy, EXPLICIT);
  });

  await check('writeManifestOverlay: invalid triggerPolicy rejects with zero writes', () => {
    const m = newManager();
    const before = tree(skillsDir);
    assert.throws(() => m.writeManifestOverlay('portrait-bundle', { triggerPolicy: INVALID_EMPTY_RULE }), /Invalid skill triggerPolicy/);
    assert.equal(tree(skillsDir), before, 'no snapshot or overlay written');
  });

  await check('writeManifestOverlay: explicit then auto reverse, unknown custom fields preserved', () => {
    const m = newManager();
    m.writeManifestOverlay('portrait-bundle', { triggerPolicy: EXPLICIT, x_owner: 'raul' });
    assert.deepEqual((newManager().inspect('portrait-bundle') as any).triggerPolicy, EXPLICIT);
    m.writeManifestOverlay('portrait-bundle', { triggerPolicy: AUTO, x_owner: 'raul' });
    const reloaded = newManager().inspect('portrait-bundle') as any;
    assert.deepEqual(reloaded.triggerPolicy, AUTO, 'auto reverse persists');
    const overlay = JSON.parse(fs.readFileSync(reloaded.overlayPath || path.join(skillsDir, 'portrait-bundle', 'skill.json'), 'utf-8'));
    assert.equal(overlay.x_owner, 'raul', 'unknown custom field preserved');
  });

  await check('importBundles: invalid triggerPolicy rejects with zero writes', async () => {
    const src = path.join(base, 'src-bad');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: "Import Bad"\ndescription: "d"\n---\n\nBody.\n');
    fs.writeFileSync(path.join(src, 'skill.json'), JSON.stringify({
      id: 'import-bad', name: 'Import Bad', description: 'd', triggerPolicy: INVALID_UNKNOWN_KEY,
    }));
    const m = newManager();
    const before = tree(skillsDir);
    await assert.rejects(m.importBundles(src), /triggerPolicy/);
    assert.equal(tree(skillsDir), before, 'no imported skill or provenance written');
  });

  await check('importBundles: valid auto policy imports and reloads raw', async () => {
    const src = path.join(base, 'src-good');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: "Import Good"\ndescription: "d"\n---\n\nBody.\n');
    fs.writeFileSync(path.join(src, 'skill.json'), JSON.stringify({
      id: 'import-good', name: 'Import Good', description: 'd', triggerPolicy: AUTO,
    }));
    await newManager().importBundles(src, { overwrite: true });
    assert.deepEqual((newManager().inspect('import-good') as any).triggerPolicy, AUTO);
  });

  await check('exportBundle: invalid on-disk policy rejects with zero output', async () => {
    const dir = path.join(skillsDir, 'export-bad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: "Export Bad"\ndescription: "d"\n---\n\nBody.\n');
    fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({
      id: 'export-bad', name: 'Export Bad', description: 'd', triggerPolicy: INVALID_EMPTY_RULE,
    }));
    const m = newManager();
    const out = path.join(base, 'export-bad.zip');
    await assert.rejects(m.exportBundle('export-bad', out), /invalid triggerPolicy/);
    assert.equal(fs.existsSync(out), false, 'no export file written');
  });

  await check('exportBundle: valid policy exports', async () => {
    const out = path.join(base, 'portrait.zip');
    const res = await newManager().exportBundle('portrait-bundle', out);
    assert.equal(res.path, out);
    assert.equal(fs.existsSync(out), true);
  });

  await check('discovery: exact bare short name finds the available skill (skill_list path)', () => {
    const m = newManager();
    m.createBundle({ id: 'figma', name: 'figma', description: 'Design file helper.', instructions: 'Body.' });
    const ranked = rankSkillsForQuery(newManager().getAll(), 'figma');
    assert.equal(ranked[0]?.skill?.id, 'figma', 'exact short name is returned first in discovery');
  });

  fs.rmSync(base, { recursive: true, force: true });
  if (failures.length) {
    console.error(`skill authoring lifecycle: ${failures.length} failed`);
    process.exit(1);
  }
  console.log('skill authoring lifecycle: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
