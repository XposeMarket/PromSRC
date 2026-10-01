// How long does the gateway event loop stay blocked by coding-panel git reads?
// Builds a temp repo (3,000 tracked + 300 untracked files), then calls the
// cached `git status --untracked-files=all` path the way the coding panel polls
// it: once cold, then repeatedly after the TTL. Reports event-loop blocking per
// poll for the old (sync on expiry) and new (stale-while-revalidate) paths.
// Usage: node scripts/benchmark-gateway-git-blocking.mjs [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gitblock-'));
const git = (args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
git(['init', '-q']);
git(['config', 'user.email', 'bench@local']); git(['config', 'user.name', 'bench']);
for (let i = 0; i < 3000; i++) { const d = path.join(dir, `src/m${i % 60}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `f${i}.ts`), `export const v${i} = ${i};\n`); }
git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
for (let i = 0; i < 300; i++) { const d = path.join(dir, `tmp/u${i % 30}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `u${i}.txt`), 'x'); }

const ARGS = ['status', '--porcelain=v1', '--branch', '--untracked-files=all'];
const TTL = 4000; const STALE = 60000;
const syncRun = () => execFileSync('git', ARGS, { cwd: dir, encoding: 'utf8', windowsHide: true });
const asyncRun = () => new Promise((res) => execFile('git', ARGS, { cwd: dir, encoding: 'utf8', windowsHide: true }, (_e, o) => res(String(o || ''))));

function makeCache(withRefresh) {
  let entry = null; let inflight = null; let clock = 0;
  return {
    tick(ms) { clock += ms; },
    read() {
      if (entry && clock - entry.at < TTL) return entry.value;
      if (entry && withRefresh && clock - entry.at < STALE) {
        if (!inflight) { const at = clock; inflight = asyncRun().then((v) => { entry = { at, value: v }; inflight = null; }); }
        return entry.value;
      }
      entry = { at: clock, value: syncRun() };
      return entry.value;
    },
    settle() { return inflight || Promise.resolve(); },
  };
}

async function measure(label, withRefresh, polls = 8) {
  const cache = makeCache(withRefresh);
  const h = monitorEventLoopDelay({ resolution: 5 });
  const blocks = [];
  h.enable();
  for (let i = 0; i < polls; i++) {
    const t0 = performance.now();
    cache.read();
    blocks.push(performance.now() - t0);
    await cache.settle();
    await new Promise((r) => setTimeout(r, 30));
    cache.tick(TTL + 500); // the panel polls again after the TTL expired
  }
  h.disable();
  const warm = blocks.slice(1);
  return { label, coldBlockMs: Math.round(blocks[0]), warmPollBlockMsMax: Math.round(Math.max(...warm)), warmPollBlockMsTotal: Math.round(warm.reduce((a, b) => a + b, 0)), loopDelayMaxMs: Math.round(h.max / 1e6) };
}

try {
  const before = await measure('before (sync on expiry)', false);
  const after = await measure('after (stale-while-revalidate)', true);
  const rows = [before, after];
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else for (const r of rows) console.log(`${r.label.padEnd(32)} cold=${r.coldBlockMs}ms warm-poll max=${r.warmPollBlockMsMax}ms total(7 polls)=${r.warmPollBlockMsTotal}ms loopDelayMax=${r.loopDelayMaxMs}ms`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
