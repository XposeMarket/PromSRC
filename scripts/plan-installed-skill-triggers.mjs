#!/usr/bin/env node
// Explicit, reviewable migration for non-bundled/local catalogs. Capture is read-only
// except for the chosen plan file. Apply requires the exact unchanged captured bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSkillTriggerPolicy } from '../src/gateway/skills-runtime/skill-package.ts';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = p => fs.existsSync(p) ? fs.readFileSync(p) : null;
const json = b => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
const args = process.argv.slice(2);
const value = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const allowed = new Set(['--capture', '--apply', '--skills-dir', '--plan', '--catalog']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (!['--capture', '--apply'].includes(args[i])) {
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`);
    i++;
  }
}
const skillsDirArg = value('--skills-dir');
const planArg = value('--plan');
if (!skillsDirArg || !planArg || args.includes('--capture') === args.includes('--apply')) {
  throw new Error('Use --capture OR --apply, --skills-dir <root>, --plan <file>; capture optionally takes --catalog <reviewed JSON>');
}
const root = fs.realpathSync(path.resolve(skillsDirArg));
const planPath = path.resolve(planArg);
const targets = id => [path.join(root,id,'skill.json'),path.join(root,'.manifests',`${id}.skill.json`)];
const safeId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);
if (args.includes('--capture')) {
  if (fs.existsSync(planPath)) throw new Error('Plan already exists; choose a new path to preserve prior review evidence');
  const catalogPath = value('--catalog') || fileURLToPath(new URL('../src/gateway/skills-runtime/fixtures/strict-skill-catalog.json', import.meta.url));
  const catalog = json(fs.readFileSync(catalogPath));
  const rows = Array.isArray(catalog) ? catalog : catalog.rows;
  const entries = [];
  const skipped = [];
  for (const row of rows) {
    if (!safeId(row.id)) throw new Error('Unsafe catalog ID');
    const validation = validateSkillTriggerPolicy(row.triggerPolicy);
    if (!validation.present || validation.errors.length) throw new Error(`Invalid policy for ${row.id}`);
    const [native,overlay] = targets(row.id);
    const nb = read(native), ob = read(overlay);
    if (!nb) { skipped.push(row.id); continue; }
    json(nb); if (ob) json(ob);
    entries.push({id:row.id,nativeHash:hash(nb),overlayHash:ob?hash(ob):null,triggerPolicy:row.triggerPolicy});
  }
  fs.mkdirSync(path.dirname(planPath),{recursive:true});
  fs.writeFileSync(planPath,JSON.stringify({version:1,root,entries,skipped},null,2)+'\n',{flag:'wx'});
  console.log(`Captured ${entries.length} installed policies; ${skipped.length} absent. No skills changed. Review ${planPath} before --apply.`);
} else {
  const plan = json(fs.readFileSync(planPath));
  if (plan.version !== 1 || plan.root !== root || !Array.isArray(plan.entries)) throw new Error('Plan version/root mismatch');
  const writes = [], seen = new Set();
  for (const row of plan.entries) {
    if (!safeId(row.id) || seen.has(row.id)) throw new Error('Unsafe/duplicate plan ID');
    seen.add(row.id);
    const v = validateSkillTriggerPolicy(row.triggerPolicy);
    if (!v.present || v.errors.length) throw new Error(`Invalid policy for ${row.id}`);
    const [native,overlay] = targets(row.id);
    const nb = read(native), ob = read(overlay);
    if (!nb || hash(nb)!==row.nativeHash || (ob?hash(ob):null)!==row.overlayHash) throw new Error(`Changed since capture: ${row.id}. No files written; capture/review a fresh plan.`);
    const manifest = json(nb); manifest.triggerPolicy = row.triggerPolicy;
    writes.push({target:native,before:nb,after:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
    // The reviewed snapshot authorizes policy replacement in both layers; all
    // non-policy fields and instruction/resources remain unchanged.
    if (ob) { const m=json(ob);m.triggerPolicy=row.triggerPolicy;writes.push({target:overlay,before:ob,after:Buffer.from(JSON.stringify(m,null,2)+'\n')}); }
  }
  const backup = `${planPath}.backup-${Date.now()}`;
  fs.mkdirSync(backup,{recursive:false});
  for (const w of writes) { const dest=path.join(backup,path.relative(root,w.target));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,w.before,{flag:'wx'}); }
  const applied=[];
  try { for(const w of writes){if(hash(fs.readFileSync(w.target))!==hash(w.before))throw new Error('Concurrent edit; rolling back own writes');fs.writeFileSync(w.target,w.after);applied.push(w);} }
  catch(error){ for(const w of applied.reverse()){if(hash(fs.readFileSync(w.target))===hash(w.after))fs.writeFileSync(w.target,w.before);}throw error; }
  console.log(`Applied ${plan.entries.length} reviewed policies. Original bytes: ${backup}. A repeated old plan fails safely; capture a new plan for further changes.`);
}
