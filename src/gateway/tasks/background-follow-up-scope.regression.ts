/**
 * Pure admission-time recomputation of a follow-up's authorized work scope
 * against the ORIGINAL spawn scope (blocker: removed grants / new denies).
 * Pure: no filesystem, config or session access.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { recomputeFollowUpScope } from './background-follow-up-scope';

const ws = path.resolve('/synthetic/main');
const wt = path.join(ws, 'worktree');
const other = path.resolve('/synthetic/other');
const always = (_p: string) => true;
const inside = (root: string, target: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Removed grant: original may reach the main workspace; the requester now only holds the worktree.
{
  const r = recomputeFollowUpScope({
    original: { workDir: wt, scopedWorkDir: true, allowedWorkPaths: [wt, ws] },
    current: { workDir: wt, roots: [wt], scoped: true },
    isDirectory: always,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.allowedWorkPaths, [wt], 'removed grant drops the main workspace root');
  assert.equal(r.allowedWorkPaths.some((p) => inside(p, path.join(ws, 'README.md'))), false, 'main workspace file is no longer reachable');
}

// New deny that narrows the requester to a descendant: the wider original root must not survive.
{
  const r = recomputeFollowUpScope({
    original: { workDir: wt, scopedWorkDir: true, allowedWorkPaths: [ws] },
    current: { workDir: wt, roots: [wt], scoped: true },
    isDirectory: always,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.allowedWorkPaths, [wt], 'wider original root is narrowed to the current descendant root');
  assert.equal(r.allowedWorkPaths.some((p) => inside(p, path.join(ws, 'secret', 'x.txt'))), false, 'sibling descendant of the old root is blocked');
  assert.equal(r.allowedWorkPaths.some((p) => inside(p, path.join(wt, 'sub', 'y.txt'))), true, 'descendant of the still-granted root remains reachable');
}

// Working directory no longer authorized: fail closed, never widen.
{
  const r = recomputeFollowUpScope({
    original: { workDir: wt, scopedWorkDir: true, allowedWorkPaths: [wt, ws] },
    current: { workDir: other, roots: [other], scoped: true },
    isDirectory: always,
  });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.code, 'scope_revoked');
  assert.match(r.error, /working directory/i);
}

// Original unscoped run, but requester is now scoped elsewhere: must not run unscoped (would bypass the new scope).
{
  const r = recomputeFollowUpScope({
    original: { workDir: ws, scopedWorkDir: false, allowedWorkPaths: undefined },
    current: { workDir: wt, roots: [wt], scoped: true },
    isDirectory: always,
  });
  assert.equal(r.ok, false, 'unscoped original cannot escape a scoped requester');
}

// Unscoped original and unscoped requester keep the historical unscoped policy.
{
  const r = recomputeFollowUpScope({
    original: { workDir: ws, scopedWorkDir: false, allowedWorkPaths: undefined },
    current: { workDir: ws, roots: [ws], scoped: false },
    isDirectory: always,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.scopedWorkDir, false);
}

// Relative or missing original working directory fails closed.
{
  const r = recomputeFollowUpScope({
    original: { workDir: 'relative/wt', scopedWorkDir: true, allowedWorkPaths: [] },
    current: { workDir: wt, roots: [wt], scoped: true },
    isDirectory: always,
  });
  assert.equal(r.ok, false);
}

// A granted root that no longer exists is dropped (narrowing), while the workDir still works.
{
  const r = recomputeFollowUpScope({
    original: { workDir: wt, scopedWorkDir: true, allowedWorkPaths: [wt, ws] },
    current: { workDir: wt, roots: [wt, ws], scoped: true },
    isDirectory: (p) => path.resolve(p) !== path.resolve(ws),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.allowedWorkPaths, [wt]);
}

console.log('PASS background follow-up scope: removed grants and new denies narrow or fail closed; never widen');

// Scoped execution cannot represent a hole under an otherwise allowed root.
assert.equal(recomputeFollowUpScope({ original: {workDir:wt,scopedWorkDir:true,allowedWorkPaths:[ws]},current:{workDir:wt,roots:[ws],scoped:true,blocked:[path.join(wt,'private')]},isDirectory:always }).ok,false,'configured blocked descendant must not be reachable');
