// Crash-window regressions for SchedulerAdmission (2026-10-15 review, finding 2).
// Real child processes are killed at each crash point, so the on-disk residue and
// the "owner is dead" signal are genuine, not hand-written fixtures.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCK_GRACE_MS, RECOVERY_MAX_AGE_MS, SchedulerAdmission, publishExclusive } from './scheduler-admission';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-sched-crash-'));
let checks = 0;
const check = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };

/** Runs `body` in a fresh node process that then dies abruptly (no cleanup handlers). Returns its (now dead) pid. */
function crashChild(body: string): number {
  const r = spawnSync(process.execPath, ['-e', `const fs=require('fs');${body};process.reallyExit(137)`], { encoding: 'utf8' });
  assert.equal(r.status, 137, `crash child should die abruptly: ${r.stderr}`);
  return r.pid!;
}

function leasePaths(store: string, jobId: string) {
  const key = crypto.createHash('sha256').update(jobId).digest('hex');
  const lease = path.join(`${store}.admission`, `${key}.lease`);
  fs.mkdirSync(path.dirname(lease), { recursive: true });
  return { lease, recover: `${lease}.recover` };
}

async function main() {
  const store = path.join(root, 'jobs.json');
  const a = new SchedulerAdmission(store);
  const b = new SchedulerAdmission(store);
  const now = Date.now();
  const afterGrace = now + LOCK_GRACE_MS + 1_000;

  // 1. Owner killed immediately after exclusive create, before any metadata was written (empty lease).
  {
    const { lease } = leasePaths(store, 'empty-lease');
    crashChild(`fs.closeSync(fs.openSync(${JSON.stringify(lease)}, 'wx'))`);
    check(fs.statSync(lease).size === 0, 'crash left an empty lease');
    check(a.acquire('empty-lease', undefined, 1000, now) === null, 'within grace an unreadable lease is not stolen (could be a live writer)');
    const release = a.acquire('empty-lease', undefined, 1000, afterGrace);
    check(!!release, 'after grace the empty lease is reclaimed and the job is admitted');
    check(JSON.parse(fs.readFileSync(lease, 'utf8')).pid === process.pid, 'replacement lease has complete metadata');
    check(b.acquire('empty-lease', undefined, 1000, afterGrace) === null, 'no overlap with the new owner');
    release!();
  }

  // 2. Owner killed during metadata persistence (partial JSON).
  {
    const { lease } = leasePaths(store, 'partial-lease');
    crashChild(`const fd=fs.openSync(${JSON.stringify(lease)}, 'wx');fs.writeSync(fd,'{"jobId":"partial-lease","tok')`);
    check(a.acquire('partial-lease', undefined, 1000, now) === null, 'partial lease within grace is left alone');
    const release = a.acquire('partial-lease', undefined, 1000, afterGrace);
    check(!!release, 'partial lease is reclaimed after grace');
    release!();
  }

  // 3. Recovery lock abandoned: stealer killed while holding .lease.recover over an expired dead-owner lease.
  {
    const { lease, recover } = leasePaths(store, 'abandoned-recover');
    const deadOwner = crashChild(`fs.writeFileSync(${JSON.stringify(lease)}, JSON.stringify({jobId:'abandoned-recover',token:'t',pid:process.pid,expiresAt:${now - 1}}))`);
    crashChild(`fs.writeFileSync(${JSON.stringify(recover)}, JSON.stringify({token:'r',pid:process.pid,at:${now}}))`);
    check(fs.existsSync(recover), 'crash left an abandoned recovery lock');
    const release = a.acquire('abandoned-recover', undefined, 1000, now);
    check(!!release, `abandoned recovery lock (dead pid) does not block recovery of a dead owner's expired lease (owner ${deadOwner})`);
    check(!fs.existsSync(recover), 'recovery lock released after use');
    release!();
  }

  // 4. Recovery lock abandoned mid-write (empty file) is reclaimed after grace, not before.
  {
    const { lease, recover } = leasePaths(store, 'empty-recover');
    crashChild(`fs.writeFileSync(${JSON.stringify(lease)}, JSON.stringify({jobId:'empty-recover',token:'t',pid:process.pid,expiresAt:${now - 1}}))`);
    crashChild(`fs.closeSync(fs.openSync(${JSON.stringify(recover)}, 'wx'))`);
    check(a.acquire('empty-recover', undefined, 1000, now) === null, 'fresh unreadable recovery lock is respected');
    const release = a.acquire('empty-recover', undefined, 1000, afterGrace);
    check(!!release, 'unreadable recovery lock reclaimed after grace');
    release!();
  }

  // 5. Live owner is never overlapped: expired lease, live pid, even far in the future.
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    const { lease, recover } = leasePaths(store, 'live-owner');
    fs.writeFileSync(lease, JSON.stringify({ jobId: 'live-owner', token: 'live', pid: sleeper.pid, expiresAt: now - 1 }));
    check(a.acquire('live-owner', undefined, 1000, now + 24 * 3600_000) === null, 'expired lease of a live owner is never stolen');
    check(JSON.parse(fs.readFileSync(lease, 'utf8')).token === 'live', 'live owner lease untouched');
    // A live process holding the recovery lock (fresh) is also respected.
    const { lease: l2, recover: r2 } = leasePaths(store, 'live-recover');
    crashChild(`fs.writeFileSync(${JSON.stringify(l2)}, JSON.stringify({jobId:'live-recover',token:'t',pid:process.pid,expiresAt:${now - 1}}))`);
    fs.writeFileSync(r2, JSON.stringify({ token: 'held', pid: sleeper.pid, at: now }));
    check(a.acquire('live-recover', undefined, 1000, now) === null, 'live, fresh recovery-lock holder is not overlapped');
    check(!!a.acquire('live-recover', undefined, 1000, now + RECOVERY_MAX_AGE_MS + 1)?.call, 'recovery lock older than RECOVERY_MAX_AGE_MS is treated as abandoned (pid reuse)');
    check(!fs.existsSync(recover), 'no stray recovery lock for the live-owner job');
  } finally { sleeper.kill(); }

  // 6. Racing replacements: exactly one wins a stale dead-owner lease.
  {
    const { lease } = leasePaths(store, 'race');
    crashChild(`fs.writeFileSync(${JSON.stringify(lease)}, JSON.stringify({jobId:'race',token:'t',pid:process.pid,expiresAt:${now - 1}}))`);
    const winners = [a, b, new SchedulerAdmission(store)].map(s => s.acquire('race', undefined, 1000, now)).filter(Boolean);
    check(winners.length === 1, `exactly one replacement admitted (got ${winners.length})`);
    (winners[0] as () => void)();
  }

  // 7. publishExclusive never exposes partial metadata and is exclusive.
  {
    const target = path.join(root, 'pub.lock');
    check(publishExclusive(target, '{"pid":1}') === true, 'first publish wins');
    check(publishExclusive(target, '{"pid":2}') === false, 'second publish is refused');
    check(fs.readFileSync(target, 'utf8') === '{"pid":1}', 'winner metadata intact');
    check(fs.readdirSync(root).every(f => !f.endsWith('.tmp')), 'no temp residue');
  }

  console.log(`scheduler-admission crash windows: ${checks}/${checks} passed`);
}

main().then(() => fs.rmSync(root, { recursive: true, force: true }), (err) => { console.error(err); process.exitCode = 1; });
