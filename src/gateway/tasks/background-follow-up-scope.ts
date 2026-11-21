/**
 * Admission-time authorized-scope recomputation for background follow-ups.
 *
 * A follow-up may only run inside the INTERSECTION of the original spawn scope
 * and the requester's CURRENT effective scope. Scope is an allow-list of
 * directory subtrees, so the intersection is exact: a narrower current root
 * replaces the wider original root, a removed grant disappears, and every
 * descendant outside the surviving roots is unreachable. Anything that cannot
 * be represented safely (the working directory left the intersection, or an
 * unscoped original would escape a scoped requester) fails closed.
 *
 * Pure: no filesystem, config or session access. The caller supplies
 * `isDirectory` and the current policy.
 */
import path from 'node:path';

export type FollowUpScopeDecision =
  | { ok: true; workDir: string; allowedWorkPaths: string[]; scopedWorkDir: boolean }
  | { ok: false; code: 'workspace_unavailable' | 'scope_revoked'; error: string };

export interface FollowUpScopeInput {
  original: { workDir: string; scopedWorkDir: boolean; allowedWorkPaths?: string[] };
  current: { workDir: string; roots: string[]; blocked?: string[]; scoped: boolean };
  isDirectory: (directory: string) => boolean;
}

const WIN = process.platform === 'win32';
const key = (p: string) => (WIN ? p.toLowerCase() : p);

function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  // Only `..` itself or a `..<sep>` prefix leaves the root; `..cache` is a child.
  // path.relative always emits the platform separator, whatever the input used.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const resolved = path.resolve(raw);
    if (seen.has(key(resolved))) continue;
    seen.add(key(resolved));
    out.push(resolved);
  }
  return out;
}

/** Exact intersection of two directory-subtree allow-lists. */
export function intersectScopeRoots(original: string[], current: string[]): string[] {
  const out: string[] = [];
  for (const o of original) {
    for (const c of current) {
      if (isInside(o, c)) {
        // Current root is narrower than (or equal to) the original root.
        out.push(c);
      } else if (isInside(c, o)) {
        // Original root covers the current root's subtree: keep the original root.
        out.push(o);
      }
    }
  }
  return dedupe(out);
}

export function recomputeFollowUpScope(input: FollowUpScopeInput): FollowUpScopeDecision {
  const originalWorkDir = String(input.original.workDir || '');
  const reject = (code: 'workspace_unavailable' | 'scope_revoked', error: string): FollowUpScopeDecision => ({ ok: false, code, error });
  if (!path.isAbsolute(originalWorkDir)) {
    return reject('workspace_unavailable', 'Follow-up blocked: the original working directory is unavailable; scope was not changed.');
  }
  const requesterScoped = input.current.scoped === true;
  if (!input.original.scopedWorkDir && !requesterScoped) {
    // Historical unscoped policy: nothing was granted by scope, nothing is revoked.
    return {
      ok: true,
      workDir: path.resolve(originalWorkDir),
      allowedWorkPaths: [],
      scopedWorkDir: false,
    };
  }
  const originalRoots = dedupe([originalWorkDir, ...(input.original.allowedWorkPaths || []).filter((p) => path.isAbsolute(String(p)))]);
  const currentRoots = dedupe((input.current.roots || []).filter((p) => path.isAbsolute(String(p))));
  const effective = intersectScopeRoots(originalRoots, currentRoots).filter((p) => input.isDirectory(p))
    .filter((p) => !(input.current.blocked || []).some((deny) => isInside(p, deny) || isInside(deny, p)));
  const workDir = path.resolve(originalWorkDir);
  if (!effective.some((root) => isInside(root, workDir))) {
    return reject('scope_revoked', 'Follow-up blocked: the original working directory is no longer inside your current authorized scope; scope was not changed.');
  }
  // Scoped result. An originally unscoped run that meets a scoped requester is
  // narrowed here too, so it can never escape the requester's current scope.
  return { ok: true, workDir, allowedWorkPaths: effective, scopedWorkDir: true };
}
