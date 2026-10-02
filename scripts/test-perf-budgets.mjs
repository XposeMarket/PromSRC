import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(root, 'generated/public-web-ui');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
  const target = path.join(dir, item.name);
  return item.isDirectory() ? walk(target) : [target];
});
const failures = [];
function limit(label, actual, ceiling) {
  console.log(`[perf] ${label}: ${actual} / ${ceiling}`);
  if (actual > ceiling) failures.push(`${label}: ${actual} exceeds ${ceiling}`);
}
const files = walk(generated);
const size = (p) => fs.statSync(p).size;
const scripts = files.filter((p) => /\.(?:js|css)$/.test(p));
limit('generated JS+CSS total bytes', scripts.reduce((sum, p) => sum + size(p), 0), 27_500_000); // baseline 23,882,051
limit('largest generated JS/CSS bytes', Math.max(...scripts.map(size)), 3_410_000); // vendor mermaid: 2,963,890
const entries = files.filter((p) => /[\\/]build[\\/]entries[\\/](?:desktop|mobile)-[^\\/]+\.js$/.test(p));
for (const name of ['desktop', 'mobile']) {
  const entry = entries.find((p) => path.basename(p).startsWith(`${name}-`));
  assert.ok(entry, `missing ${name} entry bundle`);
  limit(`${name} entry JS bytes`, size(entry), name === 'desktop' ? 151_000 : 11_000);
}
const css = path.join(generated, 'static/styles/mobile.css');
limit('mobile.css bytes', size(css), 740_000);
// Explicit legacy brand assets are intentionally high-resolution; no other image gets an exception.
const allowedImages = new Set(['static/assets/import-sources/hermes.png', 'static/assets/prometheus-one/p1-logo.png']);
for (const image of files.filter((p) => /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(p))) {
  const relative = path.relative(generated, image).replace(/\\/g, '/');
  if (!allowedImages.has(relative) && size(image) > 100 * 1024) limit(`image ${relative} bytes`, size(image), 100 * 1024);
}

const { slimSessionList, slimSkillList } = await import('../src/gateway/routes/perf-projections.ts');
const session = { id: 'web_' + 'x'.repeat(24), title: 'A typical sidebar conversation', channel: 'web',
  createdAt: 1750000000000, lastActiveAt: 1750000001000, lastMessageAt: 1750000001000,
  preview: 'A short preview of the last message', pinnedAt: 1750000000000,
  sidebarOrder: 2, settled: false, mobileUnread: true,
  history: [{ content: 'not on the wire'.repeat(5000) }] };
const sessionBytes = Buffer.byteLength(JSON.stringify(slimSessionList({ sessions: Array.from({ length: 100 }, (_, i) => ({ ...session, id: `web_${i}` })) }))) / 100;
limit('session summary fixture bytes/session', Math.ceil(sessionBytes), 360);
const skills = Array.from({ length: 80 }, (_, i) => ({ id: `skill-${i}`, name: `Skill ${i}`, description: 'Short skill summary for composer and catalog',
  categories: ['coding', 'workflow'], version: '1.0.0', status: 'active', lifecycle: 'stable',
  instructions: 'hidden'.repeat(2000), triggers: ['hidden'.repeat(200)] }));
limit('skills list fixture bytes (80)', Buffer.byteLength(JSON.stringify({ success: true, skills: slimSkillList(skills) })), 19_100);

// Fixture covers cold Git reads on a few hundred tracked files; no gateway/Playwright required.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-perf-context-'));
try {
  execFileSync('git', ['init', '-q', temp]);
  for (let i = 0; i < 320; i++) fs.writeFileSync(path.join(temp, `fixture-${i}.txt`), `content ${i}\n`);
  execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '.'], { cwd: temp });
  const { getCodingWorkspaceContextAsync } = await import('../src/gateway/coding/workspace-context.ts');
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const start = performance.now();
  await getCodingWorkspaceContextAsync({ root: temp, scope: 'project' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  delay.disable();
  const maxMs = Math.ceil(delay.max / 1e6);
  limit('cold coding-context event-loop max delay ms', maxMs, 250);
  console.log(`[perf] cold coding-context wall ms: ${Math.round(performance.now() - start)}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
// TODO(websocket fanout worker): add deterministic idle websocket bytes/client budget once fanout lands.
// Idle localStorage coalescing has an existing executable budget: <=6 background writes/21 s,
// zero idle writes after flush. scripts/test-stream-persistence-budget.mjs runs in test:perf-budgets.
if (failures.length) { console.error(failures.map((failure) => `PERF BUDGET FAIL: ${failure}`).join('\n')); process.exitCode = 1; }
else console.log('[perf] all budgets passed');
