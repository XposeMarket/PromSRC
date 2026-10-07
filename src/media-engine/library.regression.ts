import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listCast, getCast, saveCast, deleteCast, castFromCharacter, castToCharacterOp,
  listBrands, getBrand, saveBrand, deleteBrand, brandToProjectOps,
} from './library.js';
import { listTemplates, getTemplate, planFromTemplate } from './templates.js';

let failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}
function throws(fn: () => unknown, msg: string): void {
  try { fn(); check(false, msg); } catch { check(true, msg); }
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-lib-'));
try {
  fs.mkdirSync(path.join(ws, 'uploads'), { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  fs.writeFileSync(path.join(ws, 'uploads', 'face.png'), png);
  fs.writeFileSync(path.join(ws, 'uploads', 'logo.png'), png);

  console.log('cast');
  const m = saveCast(ws, { name: 'Ava', anchors: ['uploads/face.png', 'uploads/face.png'], refs: [] });
  check(/^cast_[a-f0-9]{10}$/.test(m.id), 'id format');
  check(m.anchors.length === 1 && m.anchors[0] === `video-library/cast/${m.id}/face.png`, 'anchor copied + deduped');
  check(fs.existsSync(path.join(ws, m.anchors[0])), 'copied file exists');
  const m2 = saveCast(ws, { ...m, notes: 'n' });
  check(m2.anchors[0] === m.anchors[0] && m2.notes === 'n', 'resave keeps in-dir anchor');
  const prod = castFromCharacter(ws, { name: 'Soda', anchors: ['uploads/face.png'], refs: [] }, { kind: 'product' });
  check(listCast(ws).length === 2 && listCast(ws, { kind: 'product' }).length === 1, 'list + filter');
  check(getCast(ws, m.id)?.name === 'Ava', 'get');
  const op = castToCharacterOp(prod);
  check(op.op === 'character.upsert' && op.castId === prod.id && op.kind === 'product', 'castToCharacterOp');
  throws(() => getCast(ws, '../../etc'), 'traversal id rejected');
  throws(() => saveCast(ws, { name: 'x', anchors: ['../../outside.png'] }), 'traversal anchor rejected');
  throws(() => saveCast(ws, { id: 'cast_../../x', name: 'x' }), 'bad id rejected');

  console.log('brand');
  const b = saveBrand(ws, { name: 'Fizz', logo: 'uploads/logo.png', colors: ['#ff0066', '#000'], tone: 'energetic, playful', castIds: [m.id], productIds: [prod.id], watermark: true });
  check(b.logo === `video-library/brands/${b.id}/logo.png` && fs.existsSync(path.join(ws, b.logo!)), 'logo copied');
  check(getBrand(ws, b.id)?.name === 'Fizz' && listBrands(ws).length === 1, 'get/list brand');
  const ops = brandToProjectOps(ws, b);
  check(ops[0].op === 'style.upsert' && ops[0].name === 'Fizz brand' && /#ff0066/.test(ops[0].promptSuffix) && /energetic/.test(ops[0].promptSuffix), 'style op');
  check(ops.filter((o) => o.op === 'character.upsert').length === 2, 'character ops');
  const last = ops[ops.length - 1];
  check(last.op === 'project.update' && last.brand.id === b.id && last.brand.watermark === true && last.brand.colors.length === 2, 'project.update brand');
  throws(() => saveBrand(ws, { name: 'bad', colors: ['red'] }), 'bad color rejected');
  check(deleteBrand(ws, b.id) && listBrands(ws).length === 0, 'delete brand');
  check(deleteCast(ws, m.id) && getCast(ws, m.id) === null && listCast(ws).length === 1, 'delete cast');

  console.log('templates');
  const list = listTemplates();
  const want = ['ugc-testimonial', 'product-demo', 'cinematic-trailer', 'explainer', 'before-after', 'local-business-promo', 'faceless-youtube'];
  check(want.every((id) => list.some((t) => t.id === id)) && list.length === want.length, `${want.length} templates present`);
  for (const s of list) {
    const t = getTemplate(s.id)!;
    const sum = t.shots.reduce((a, x) => a + x.durationSec, 0);
    check(Math.abs(sum - t.durationSec) <= t.durationSec * 0.3, `${t.id} duration ${sum}~${t.durationSec}`);
    check(t.shots.every((x) => x.prompt.trim().length > 20 && x.durationSec >= 3 && x.durationSec <= (t.id === 'faceless-youtube' ? 30 : 6)), `${t.id} shots valid`);
    for (const vars of [{ brief: 'summer vibes', product: 'Fizz Soda', character: 'Ava', brand: 'Fizz' }, {}]) {
      const plan = planFromTemplate(t, vars, { productCharId: 'char_p', personCharId: 'char_c' });
      const strs: string[] = [];
      JSON.stringify(plan, (_k, v) => { if (typeof v === 'string') strs.push(v); return v; });
      check(strs.every((x) => !x.includes('{') && !x.includes('}') && !/\s{2}/.test(x)), `${t.id} no leftover braces`);
      const setShots = plan.ops.find((o) => o.op === 'plan.setShots')!;
      check(setShots.shots.length === t.shots.length && setShots.shots.every((sh: any) => sh.anchorMode === 'reference'), `${t.id} setShots`);
      t.shots.forEach((src, i) => {
        const ci: string[] = setShots.shots[i].characterIds;
        if ((src.usesProduct ? 1 : 0) !== (ci.includes('char_p') ? 1 : 0) || (src.usesCharacter ? 1 : 0) !== (ci.includes('char_c') ? 1 : 0)) {
          check(false, `${t.id} shot ${i} characterIds`);
        }
      });
      check(plan.hookVariants.every((h) => !/[{}]/.test(h)), `${t.id} hookVariants filled`);
      check(plan.ops[0].op === 'project.update' && plan.ops[0].target.aspect === t.aspect, `${t.id} project.update`);
    }
  }
  const ugc = planFromTemplate(getTemplate('ugc-testimonial')!, { product: 'Fizz' }, { productCharId: 'p1' });
  const first = ugc.ops.find((o) => o.op === 'plan.setShots')!.shots;
  check(first[1].characterIds.join() === 'p1' && first[0].characterIds.length === 0, 'characterIds wiring');
  check(getTemplate('ugc-testimonial')!.shots.every((s) => !s.line || s.line.split(/\s+/).length <= 12), 'ugc lines <= 12 words');
  check(ugc.ops.some((o) => o.op === 'voice.set') && ugc.ops.some((o) => o.op === 'captions.set'), 'voice/captions ops');
} finally {
  fs.rmSync(ws, { recursive: true, force: true });
}

if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log('ALL PASS');
