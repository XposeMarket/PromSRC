import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-workdir-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  const { getConfig } = await import('../../config/config');
  const ws = getConfig().getWorkspacePath();
  const { resolveTeamWorkDir, resolveTeamExecutionRoot, resolveTeamAgentAllowedWorkPaths } = await import('./team-dispatch-runtime');
  const { compactManagedTeamForStorage } = await import('./managed-teams');

  // 1) workDir inside an allowed path resolves, is created, and becomes the execution root.
  const allowed = path.join(ws, 'teams-test');
  const team: any = { id: 't1', allowedWorkPaths: [allowed], workDir: path.join(allowed, 'timer-cli') };
  const wd = resolveTeamWorkDir(team);
  assert.equal(wd, path.resolve(allowed, 'timer-cli'));
  assert.ok(fs.existsSync(wd!), 'workDir is created');
  assert.equal(resolveTeamExecutionRoot(team, path.join(ws, 'teams', 't1', 'workspace')), wd);
  const paths = resolveTeamAgentAllowedWorkPaths(team, path.join(ws, 'teams', 't1', 'workspace'));
  assert.ok(paths.some((p) => path.resolve(p) === path.resolve(path.join(ws, 'teams', 't1', 'workspace'))), 'team workspace stays allowed');
  assert.ok(paths.some((p) => path.resolve(p) === wd), 'workDir is allowed');

  // 1b) Teams v7: a goal that names its project folder yields that folder.
  const { inferTeamWorkDirFromText } = await import('./team-dispatch-runtime');
  const v7 = `Teams v7 live test. Project folder ${path.join(allowed, 'roman-cli')} (create it; absolute paths). Build...`;
  assert.equal(inferTeamWorkDirFromText(v7), path.join(allowed, 'roman-cli'));
  assert.equal(inferTeamWorkDirFromText(`Project folder: \`${path.join(allowed, 'x-cli')}\`.`), path.join(allowed, 'x-cli'));
  assert.equal(inferTeamWorkDirFromText('Build a tiny CLI with tests.'), null);
  assert.equal(resolveTeamWorkDir({ allowedWorkPaths: [allowed], workDir: inferTeamWorkDirFromText(v7) }), path.resolve(allowed, 'roman-cli'));

  // 2) Relative workDir resolves against the main workspace.
  assert.equal(resolveTeamWorkDir({ workDir: 'teams-test/rel-cli', allowedWorkPaths: [] }), path.resolve(ws, 'teams-test/rel-cli'));

  // 3) A workDir outside every root is rejected (cannot widen the sandbox).
  const outside = path.join(os.tmpdir(), `prom-outside-${Date.now()}`);
  assert.equal(resolveTeamWorkDir({ workDir: outside, allowedWorkPaths: [allowed] }), null);
  assert.equal(resolveTeamExecutionRoot({ workDir: outside, allowedWorkPaths: [allowed] }, '/tw'), '/tw');
  assert.equal(fs.existsSync(outside), false, 'rejected workDir is not created');

  // 4) Unset workDir falls back to the team workspace.
  assert.equal(resolveTeamExecutionRoot({ allowedWorkPaths: [allowed] }, '/tw'), '/tw');

  // 5) Store compaction: old messages/runs lose traces, recent keep a capped trace.
  const bigEntry = { type: 'tool', content: 'x'.repeat(5000) };
  const mkMsg = (i: number) => ({ id: `m${i}`, content: `c${i}`, metadata: { processEntries: Array(300).fill(bigEntry), liveTraceEntries: Array(300).fill(bigEntry), runId: `r${i}` } });
  const t: any = {
    teamChat: Array.from({ length: 40 }, (_, i) => mkMsg(i)),
    roomState: { roomMessages: Array.from({ length: 40 }, (_, i) => mkMsg(i)) },
    runHistory: Array.from({ length: 20 }, (_, i) => ({ id: `tr${i}`, processEntries: Array(300).fill(bigEntry), liveTraceEntries: Array(300).fill(bigEntry), roomSnapshot: { x: 'y'.repeat(9000) } })),
  };
  const before = JSON.stringify(t).length;
  compactManagedTeamForStorage(t);
  const after = JSON.stringify(t).length;
  assert.equal(t.teamChat[0].metadata.processEntries, undefined, 'old chat trace dropped');
  assert.equal(t.teamChat[0].metadata.runId, 'r0', 'non-trace metadata kept');
  assert.equal(t.teamChat[0].content, 'c0', 'content kept');
  assert.equal(t.teamChat.length, 40, 'no messages dropped');
  const last = t.teamChat[39].metadata.processEntries;
  assert.ok(Array.isArray(last) && last.length === 80, 'recent trace capped to 80 entries');
  assert.ok(JSON.stringify(last[0]).length < 1500, 'recent trace entries clamped');
  assert.equal(t.runHistory[0].roomSnapshot, undefined, 'old run snapshot dropped');
  assert.ok(t.runHistory[19].roomSnapshot, 'recent run snapshot kept');
  assert.ok(after < before / 20, `store shrinks a lot (before=${before}, after=${after})`);
  // Idempotent.
  const again = JSON.stringify(t).length;
  compactManagedTeamForStorage(t);
  assert.equal(JSON.stringify(t).length, again);

  console.log(`team-workdir-store regression: PASS (compaction ${before} -> ${after} chars)`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
