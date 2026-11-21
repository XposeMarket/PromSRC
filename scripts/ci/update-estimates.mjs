#!/usr/bin/env node
// Refresh the `seconds` estimates in scripts/ci/regressions.json from a real CI run, so the
// shard plan stays balanced. Each shard publishes its timings as a "Regression timings"
// notice annotation, which the GitHub API serves without the (large, auth-only) job logs.
//
//   npm run ci:rebalance -- <workflow run id> [--repo owner/name] [--dry-run]
//
// Public repositories need no token; set GH_TOKEN or GITHUB_TOKEN for private ones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadManifest, manifestPath, planShards, repoRoot, TIMINGS_TITLE } from './run-regressions.mjs';

// Pure merge used by the CLI and the regression test: measured seconds win, rounded up, minimum 1.
export function applyTimings(manifest, timings) {
  const changes = [];
  const set = (target, label, measured) => {
    const next = Math.max(1, Math.ceil(measured));
    if (target.seconds !== next) changes.push({ name: label, from: target.seconds ?? null, to: next });
    target.seconds = next;
  };
  for (const [name, measured] of Object.entries(timings)) {
    if (!Number.isFinite(measured)) continue;
    const setupId = name.startsWith('setup: ') ? name.slice('setup: '.length) : null;
    if (setupId && manifest.setups?.[setupId]) set(manifest.setups[setupId], name, measured);
    const entry = manifest.regressions.find((candidate) => candidate.name === name);
    if (entry) set(entry, name, measured);
  }
  return changes;
}

function defaultRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const match = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`cannot derive owner/name from origin ${url}; pass --repo`);
  return match[1];
}

async function main(argv) {
  const runId = argv.find((arg) => /^\d+$/.test(arg));
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : defaultRepo();
  if (!runId) throw new Error('usage: update-estimates.mjs <workflow run id> [--repo owner/name] [--dry-run]');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'prometheus-ci-rebalance', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const api = async (url) => {
    const response = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, { headers });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  };
  const { jobs } = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const timings = {};
  let shards = 0;
  for (const job of jobs.filter((candidate) => candidate.name.startsWith('regressions'))) {
    const annotations = await api(`${job.check_run_url}/annotations?per_page=100`);
    const note = annotations.find((annotation) => String(annotation.title || '').startsWith(TIMINGS_TITLE));
    if (!note) { console.warn(`no timings annotation on "${job.name}" (${job.conclusion})`); continue; }
    Object.assign(timings, JSON.parse(note.message));
    shards++;
  }
  if (!shards) throw new Error(`run ${runId} has no regression timing annotations`);
  const manifest = loadManifest();
  const changes = applyTimings(manifest, timings);
  for (const change of changes) console.log(`${String(change.from).padStart(4)} -> ${String(change.to).padStart(4)}  ${change.name}`);
  const count = jobs.filter((candidate) => candidate.name.startsWith('regressions')).length;
  for (const shard of planShards(manifest, count)) console.log(`shard ${shard.index}/${count}: ~${shard.estimatedSeconds}s, ${shard.entries.length} regressions`);
  if (argv.includes('--dry-run')) return;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`updated ${changes.length} estimates from ${shards} shards of run ${runId} in ${path.relative(repoRoot, manifestPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error?.message || error); process.exitCode = 1; });
}
