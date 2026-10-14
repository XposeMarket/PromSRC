const LOCK_FREE_READS = new Set(['status', 'diff', 'diff-files', 'diff-index', 'rev-parse', 'branch', 'remote', 'symbolic-ref', 'rev-list', 'log', 'ls-files', 'show']);

export function isLockFreeGitRead(args: string[]): boolean {
  return LOCK_FREE_READS.has(String(args[0] || ''));
}

/**
 * Shared lock-free invocation settings for Prometheus Git reads.
 *
 * Git status can opportunistically refresh the index and take index.lock unless
 * optional locks are disabled. Reads using this helper are safe to terminate on
 * timeout without leaving a stale lock behind.
 */
export function lockFreeGitReadOptions(args: string[], env: NodeJS.ProcessEnv = process.env): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: args.includes('--no-optional-locks') ? args : ['--no-optional-locks', ...args],
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
  };
}
