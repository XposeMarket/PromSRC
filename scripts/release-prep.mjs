#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_SINCE = '2026-08-13';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(`release:prep: ${message}`);
  process.exit(1);
}

function usage() {
  return `Usage: npm run release:prep -- <version> [--dry-run] [--since <date-or-commit>]\n\nWhen no tag is reachable from HEAD, history starts at --since (default: ${DEFAULT_SINCE}).`;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`git ${args.join(' ')} failed${error.stderr?.toString().trim() ? `: ${error.stderr.toString().trim()}` : ''}`);
  }
}

function parseArgs(argv) {
  let version;
  let dryRun = false;
  let since = DEFAULT_SINCE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--since') {
      since = argv[++index];
      if (!since) fail('--since requires a date or commit.');
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (!version) version = arg;
    else fail(`unexpected argument: ${arg}\n\n${usage()}`);
  }
  if (!version) fail(`a version is required.\n\n${usage()}`);
  if (!SEMVER.test(version)) fail(`"${version}" is not a valid SemVer version.`);
  const prerelease = version.match(/-([^.]+)/)?.[1];
  if (prerelease && !['beta', 'rc'].includes(prerelease)) {
    fail(`prerelease channel "${prerelease}" is not supported; use beta or rc.`);
  }
  return { version, dryRun, since };
}

function previousTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function historyRange(tag, since) {
  if (tag) return { label: tag, args: [`${tag}..HEAD`] };
  try {
    const commit = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (commit) return { label: since, args: [`${commit}..HEAD`] };
  } catch {
    // Dates are intentionally handled by git log --since below.
  }
  return { label: since, args: [`--since=${since}`] };
}

function releaseEntry(subject, body) {
  const merged = subject.match(/^Merge pull request #(\d+)\b/i);
  if (merged) {
    const title = body.split('\n').map((line) => line.trim()).find(Boolean);
    return title ? { title, pr: merged[1] } : null;
  }
  const squash = subject.match(/^(.*?)\s*\(#(\d+)\)\s*$/);
  return squash ? { title: squash[1].trim(), pr: squash[2] } : null;
}

function groupFor(title) {
  if (/^(feat|feature)(\([^)]*\))?[:!]?\b|\b(add|introduce|support)\b/i.test(title)) return 'Features';
  if (/^(fix|bugfix|hotfix)(\([^)]*\))?[:!]?\b|\b(fix|resolve|correct)\b/i.test(title)) return 'Fixes';
  return 'Other';
}

function changelog(range, version) {
  const output = git(['log', '--format=%s%x00%b%x00', ...range.args]);
  const groups = new Map([['Features', []], ['Fixes', []], ['Other', []]]);
  const seen = new Set();
  const fields = output ? output.split('\0') : [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const entry = releaseEntry(fields[index].trim(), fields[index + 1] ?? '');
    if (!entry || !entry.title) continue;
    if (seen.has(entry.pr)) continue;
    seen.add(entry.pr);
    groups.get(groupFor(entry.title)).push(`- ${entry.title} (#${entry.pr})`);
  }
  const sections = [...groups]
    .filter(([, entries]) => entries.length)
    .map(([name, entries]) => `### ${name}\n\n${entries.join('\n')}`);
  return [`## ${version} — ${new Date().toISOString().slice(0, 10)}`, '', ...(sections.length ? sections : ['### Other', '', '- No merged or squash PR titles identified from git history.'])].join('\n');
}

function versionChange(filename, version) {
  const path = resolve(process.cwd(), filename);
  const source = readFileSync(path, 'utf8');
  const json = JSON.parse(source);
  const before = { version: json.version, root: json.packages?.['']?.version };
  json.version = version;
  if (filename === 'package-lock.json') {
    if (!json.packages?.['']) fail('package-lock.json has no packages[""] entry.');
    json.packages[''].version = version;
  }
  return { filename, path, source, next: `${JSON.stringify(json, null, 2)}${source.includes('\r\n') ? '\r\n' : '\n'}`, before, after: { version: json.version, root: json.packages?.['']?.version } };
}

function displayVersionChange(change) {
  const oldValue = change.before.root ? `${change.before.version} / ${change.before.root}` : change.before.version;
  const newValue = change.after.root ? `${change.after.version} / ${change.after.root}` : change.after.version;
  console.log(`${change.filename}: ${oldValue} -> ${newValue}`);
}

function changelogChange(section) {
  const path = resolve(process.cwd(), 'CHANGELOG.md');
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n\n';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n').replace(/\s*$/, '');
  return { path, next: `${normalized}\n\n${section}\n`.replace(/\n/g, newline) };
}

const { version, dryRun, since } = parseArgs(process.argv.slice(2));
const tag = previousTag();
const range = historyRange(tag, since);
const packageChange = versionChange('package.json', version);
const lockChange = versionChange('package-lock.json', version);
const section = changelog(range, version);
const changelogFile = changelogChange(section);

console.log(`Release preparation for ${version}${dryRun ? ' (dry run)' : ''}`);
console.log('Version changes:');
displayVersionChange(packageChange);
displayVersionChange(lockChange);
console.log('CHANGELOG.md: append generated release section');
console.log(`History range: ${tag ? `previous tag ${tag}` : `--since ${range.label}`}`);
console.log('');
console.log(section);
console.log('');
if (dryRun) {
  console.log('Dry run: no files were written.');
} else {
  writeFileSync(packageChange.path, packageChange.next, 'utf8');
  writeFileSync(lockChange.path, lockChange.next, 'utf8');
  writeFileSync(changelogFile.path, changelogFile.next, 'utf8');
  console.log('Updated package.json, package-lock.json, and CHANGELOG.md.');
}
console.log('This command never creates tags or pushes. Next steps:');
console.log(`  git checkout -b release/v${version}`);
console.log(`  git add package.json package-lock.json CHANGELOG.md && git commit -m "chore(release): prepare v${version}"`);
console.log(`  Open a release PR for v${version} in GitHub.`);
console.log(`  # After the release PR is merged: git tag -a v${version} -m "Release v${version}" && git push origin v${version}`);
