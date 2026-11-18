// Allow-list for tracked paths under workspace/.
//
// workspace/ is the owner's personal runtime data (memory, Brain, uploads,
// exports, ...) and must never be tracked in this public repository. Only the
// shipped skill catalog (minus its local edit history) and the developer self
// docs are allowed. scripts/audit-repo-privacy.mjs enforces this on every run;
// scripts/test-workspace-tracking-guard.mjs proves both directions.

const ALLOWED_PREFIXES = ['workspace/skills/', 'workspace/self/'];
const DENIED_PREFIXES = ['workspace/skills/.history/', 'workspace/skills/.cache/'];

function normalize(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isWorkspacePath(file) {
  const value = normalize(file);
  return value === 'workspace' || value.startsWith('workspace/');
}

export function isAllowedWorkspacePath(file) {
  const value = normalize(file);
  if (!isWorkspacePath(value)) return true;
  if (DENIED_PREFIXES.some((prefix) => value.startsWith(prefix))) return false;
  return ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function findDisallowedWorkspacePaths(files) {
  return files.map(normalize).filter((file) => !isAllowedWorkspacePath(file));
}

export const WORKSPACE_TRACKING_ALLOW_LIST = Object.freeze({
  allowed: ALLOWED_PREFIXES,
  denied: DENIED_PREFIXES,
});
