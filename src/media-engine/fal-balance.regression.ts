import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { balanceShortfall, falBalance, parseFalBalance, setBalanceFetcherForTests } from './balance.js';
import { estimate, generateShots } from './engine.js';
import { executeVideoProject } from './tool.js';

const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

async function main() {
  // Response shapes: v1 billing (expand=credits) and the legacy plain number.
  assert.equal(parseFalBalance({ username: 'x', credits: { current_balance: 4.25, currency: 'USD' } }), 4.25);
  assert.equal(parseFalBalance(-0.18), -0.18);
  assert.equal(parseFalBalance('2.5'), 2.5);
  assert.equal(parseFalBalance({ foo: 1 }), undefined);

  // v1 401 -> legacy endpoint answers.
  const seen: string[] = [];
  setBalanceFetcherForTests(async (url) => { seen.push(url); return url.includes('api.fal.ai') ? json(401, { error: 'x' }) : json(200, '-0.18'); });
  const locked = await falBalance({ fresh: true, key: 'id:secret' });
  assert.equal(locked.balanceUsd, -0.18);
  assert.equal(seen.length, 2);
  assert.match(balanceShortfall(locked, 3.02) || '', /fal balance is \$-0.18 .* quoted at \$3.02.*Top up at fal.ai\/dashboard\/billing/);

  // Enough balance -> no problem. Unknown balance never blocks.
  assert.equal(balanceShortfall({ provider: 'fal', balanceUsd: 10, source: 't', checkedAt: 0 }, 3.02), undefined);
  setBalanceFetcherForTests(async () => json(500, 'down'));
  const unknown = await falBalance({ fresh: true, key: 'id:secret' });
  assert.equal(unknown.balanceUsd, undefined);
  assert.match(unknown.source, /unknown/);
  assert.equal(balanceShortfall(unknown, 3.02), undefined);
  assert.equal((await falBalance({ fresh: true, key: '' })).balanceUsd, undefined);

  // End to end: an empty account blocks generate even with approved:true, before any job exists.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fal-balance-'));
  try {
    fs.writeFileSync(path.join(ws, 'frame.png'), 'fixture');
    const created = await executeVideoProject({ action: 'create', title: 'Balance preflight' }, { workspacePath: ws });
    const projectId = created.created;
    await executeVideoProject({ action: 'apply_ops', projectId, ops: [{ op: 'plan.setShots', shots: [{ id: 'shot_a', title: 'A', prompt: 'a woman turns', startImage: 'frame.png', durationSec: 5, modelId: 'fal/seedance-v1-pro-i2v' }] }] }, { workspacePath: ws });
    await executeVideoProject({ action: 'apply_ops', projectId, ops: [{ op: 'project.update', budget: { capUsd: 50 } }] }, { workspacePath: ws });

    setBalanceFetcherForTests(async () => json(200, { credits: { current_balance: 0, currency: 'USD' } }));
    // estimate() reads the key itself; inject one through the env for this test only.
    process.env.FAL_KEY = 'id:secret';
    const est = await estimate(ws, projectId, { shotIds: ['shot_a'] });
    assert.equal(est.falBalance?.balanceUsd, 0);
    assert.match(est.balanceProblem || '', /fal balance is \$0.00/);
    const gen = await generateShots(ws, projectId, { shotIds: ['shot_a'], approved: true });
    assert.equal(gen.needsApproval, true);
    assert.match(gen.reason || '', /Top up at fal.ai\/dashboard\/billing/);
    assert.equal(gen.jobs.length, 0);

    // Funded account: no balance problem on the quote.
    setBalanceFetcherForTests(async () => json(200, { credits: { current_balance: 20, currency: 'USD' } }));
    const ok = await estimate(ws, projectId, { shotIds: ['shot_a'] });
    assert.equal(ok.falBalance?.balanceUsd, 20);
    assert.equal(ok.balanceProblem, undefined);
  } finally {
    delete process.env.FAL_KEY;
    setBalanceFetcherForTests();
    fs.rmSync(ws, { recursive: true, force: true });
  }
  console.log('fal balance preflight regression passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
