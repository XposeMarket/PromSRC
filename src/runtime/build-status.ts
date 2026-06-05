// src/runtime/build-status.ts
// Build/version + update-availability status for the operator dashboard.
//
// Two distinct concerns:
//  - DEV builds: surface local git working-tree state (useful only to the
//    developer running from source). Never exposed in public builds.
//  - PUBLIC builds: surface whether an app update is available, checked against
//    the public releases repo. This is what end users should ever see.

import { execFileSync } from 'child_process';
import path from 'path';
import { isPublicDistributionBuild, resolvePrometheusRoot } from './distribution';

const RELEASES_OWNER = 'XposeMarket';
const RELEASES_REPO = 'prometheus-releases';
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface BuildStatus {
  version: string;
  channel: 'public' | 'dev';
  updateAvailable?: boolean;
  latestVersion?: string;
  /** Dev-only local git working-tree summary. Omitted entirely in public builds. */
  repo?: { branch?: string; dirty: boolean; modified: number; untracked: number };
}

let updateCache: { at: number; latestVersion?: string } | null = null;
let updateRefreshInFlight = false;

function currentVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(resolvePrometheusRoot(), 'package.json'));
    return String(pkg?.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function parseSemver(v: string): number[] {
  return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** Returns >0 if a is newer than b. */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readDevRepoStatus(): BuildStatus['repo'] | undefined {
  try {
    const cwd = resolvePrometheusRoot();
    const out = execFileSync('git', ['status', '--porcelain=v1', '-b'], {
      cwd,
      timeout: 4000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    let branch: string | undefined;
    let modified = 0;
    let untracked = 0;
    for (const line of lines) {
      if (line.startsWith('## ')) {
        branch = line.slice(3).split('...')[0].trim();
        continue;
      }
      if (line.startsWith('??')) untracked++;
      else modified++;
    }
    return { branch, dirty: modified + untracked > 0, modified, untracked };
  } catch {
    return undefined;
  }
}

async function fetchLatestRelease(): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://api.github.com/repos/${RELEASES_OWNER}/${RELEASES_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'Prometheus-Updater', accept: 'application/vnd.github+json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return undefined;
    const json: any = await res.json();
    const tag = String(json?.tag_name || json?.name || '').trim();
    return tag || undefined;
  } catch {
    return undefined;
  }
}

function refreshUpdateCacheInBackground(): void {
  if (updateRefreshInFlight) return;
  updateRefreshInFlight = true;
  fetchLatestRelease()
    .then((latestVersion) => { updateCache = { at: Date.now(), latestVersion }; })
    .catch(() => {})
    .finally(() => { updateRefreshInFlight = false; });
}

/**
 * Build status for the dashboard. Update check is cached (1h) and refreshed in
 * the background so the dashboard never blocks on the network. Git status is
 * only computed for dev builds.
 */
export function getBuildStatus(): BuildStatus {
  const version = currentVersion();
  const isPublic = isPublicDistributionBuild();
  const status: BuildStatus = { version, channel: isPublic ? 'public' : 'dev' };

  // Update availability (both channels can show it; it's the only build signal
  // public users ever see). Served from cache; refreshed in the background.
  const fresh = updateCache && (Date.now() - updateCache.at) < UPDATE_CACHE_TTL_MS;
  if (!fresh) refreshUpdateCacheInBackground();
  if (updateCache?.latestVersion) {
    status.latestVersion = updateCache.latestVersion;
    status.updateAvailable = compareSemver(updateCache.latestVersion, version) > 0;
  }

  // Dev-only local repo state. Never included in public builds.
  if (!isPublic) {
    const repo = readDevRepoStatus();
    if (repo) status.repo = repo;
  }

  return status;
}
