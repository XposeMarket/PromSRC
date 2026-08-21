import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const HISTORY = process.argv.includes('--history');
const STRICT_CURRENT = process.argv.includes('--strict-current') || process.argv.includes('--strict');
const FAIL_HISTORY = process.argv.includes('--fail-history');
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const HISTORY_BATCH_SIZE = 300;

const secretPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['stripe-live-secret', /\bsk_live_[0-9A-Za-z]{20,}\b/],
  ['openai-style-secret', /\bsk-[A-Za-z0-9_-]{40,}\b/],
];

const absolutePathPatterns = [
  /\b[A-Za-z]:\\Users\\(?!example-user\\|test-user\\|username\\|user\\|you\\|<[^>]+>\\)[^\\\r\n]+\\/i,
  /\/Users\/(?!example-user\/|test-user\/|username\/|user\/|you\/|<[^>]+>\/)[^/\s]+\//,
  /\/home\/(?!example-user\/|test-user\/|username\/|user\/|you\/|<[^>]+>\/)[^/\s]+\//,
];

const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.docx', '.xlsx', '.pptx']);
const fixturePathPattern = /(?:^|\/)(?:sessions?|transcripts?|conversation-exports?|chat-exports?)(?:\/|$)|(?:^|\/)(?:fixtures?|testdata)\/[^\n]*(?:chat|session|conversation)/i;
const guardLiteralFiles = new Set([
  'scripts/prepare-public-build.js',
  'scripts/verify-public-release.js',
]);
const exactPrivateMarkers = (process.env.PROM_REPO_PRIVATE_MARKERS || '')
  .split(/[,\n]/)
  .map((value) => value.trim())
  .filter(Boolean);

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding === null ? null : 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer || 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || `git ${args.join(' ')} failed`));
  return result.stdout;
}

function normalized(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function outsideWorkspace(file) {
  const value = normalized(file);
  return value !== 'workspace' && !value.startsWith('workspace/');
}

function isEnvFile(file) {
  const base = path.posix.basename(normalized(file));
  return /^\.env(?:\..+)?$/i.test(base) && !/\.example$/i.test(base) && !/\.sample$/i.test(base) && !/\.template$/i.test(base);
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function lineForMatch(text, pattern) {
  const match = text.match(pattern);
  if (!match || match.index == null) return null;
  return text.slice(0, match.index).split('\n').length;
}

function scanText(text, file, scope, findings) {
  for (const [kind, pattern] of secretPatterns) {
    const line = lineForMatch(text, pattern);
    if (line) findings.push({ scope, severity: 'block', kind, file, line });
  }
  if (!outsideWorkspace(file)) return;

  for (const pattern of absolutePathPatterns) {
    const line = lineForMatch(text, pattern);
    if (!line) continue;
    findings.push({
      scope,
      severity: guardLiteralFiles.has(normalized(file)) ? 'review' : 'block',
      kind: guardLiteralFiles.has(normalized(file)) ? 'privacy-guard-literal-review' : 'personal-absolute-path',
      file,
      line,
    });
    break;
  }
  for (const marker of exactPrivateMarkers) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) {
      findings.push({
        scope,
        severity: guardLiteralFiles.has(normalized(file)) ? 'review' : 'block',
        kind: guardLiteralFiles.has(normalized(file)) ? 'privacy-guard-literal-review' : 'configured-private-marker',
        file,
        line: text.slice(0, index).split('\n').length,
      });
      break;
    }
  }
}

function addPathWarnings(file, scope, findings) {
  if (isEnvFile(file)) findings.push({ scope, severity: 'block', kind: 'tracked-env-file', file });
  if (!outsideWorkspace(file)) return;
  const ext = path.posix.extname(normalized(file)).toLowerCase();
  if (mediaExtensions.has(ext)) findings.push({ scope, severity: 'review', kind: 'private-material-review', file });
  if (fixturePathPattern.test(normalized(file))) findings.push({ scope, severity: 'review', kind: 'chat-session-fixture-review', file });
}

function currentFiles() {
  return String(git(['ls-files', '-z'])).split('\0').filter(Boolean);
}

function scanCurrent(findings) {
  for (const file of currentFiles()) {
    addPathWarnings(file, 'current', findings);
    const abs = path.join(ROOT, file);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) continue;
    let buffer;
    try { buffer = fs.readFileSync(abs); } catch { continue; }
    if (looksBinary(buffer)) continue;
    scanText(buffer.toString('utf8'), file, 'current', findings);
  }
}

function parseBatch(buffer, objectPaths, findings) {
  let offset = 0;
  while (offset < buffer.length) {
    const newline = buffer.indexOf(10, offset);
    if (newline < 0) break;
    const header = buffer.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    const match = header.match(/^([0-9a-f]{40,64}) blob (\d+)$/);
    if (!match) break;
    const sha = match[1];
    const size = Number(match[2]);
    const content = buffer.subarray(offset, offset + size);
    offset += size + 1;
    if (size > MAX_TEXT_BYTES || looksBinary(content)) continue;
    const paths = objectPaths.get(sha) || new Set(['<unknown>']);
    const text = content.toString('utf8');
    for (const file of paths) scanText(text, file, 'history', findings);
  }
}

function scanHistory(findings) {
  const raw = String(git(['rev-list', '--objects', '--all']));
  const objectPaths = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const sha = line.slice(0, space);
    const file = line.slice(space + 1);
    if (!objectPaths.has(sha)) objectPaths.set(sha, new Set());
    objectPaths.get(sha).add(file);
    addPathWarnings(file, 'history', findings);
  }

  const shas = [...objectPaths.keys()];
  const check = String(git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: `${shas.join('\n')}\n` }));
  const textBlobShas = [];
  for (const line of check.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{40,64}) blob (\d+)$/);
    if (match && Number(match[2]) <= MAX_TEXT_BYTES) textBlobShas.push(match[1]);
  }

  for (let i = 0; i < textBlobShas.length; i += HISTORY_BATCH_SIZE) {
    const batchShas = textBlobShas.slice(i, i + HISTORY_BATCH_SIZE);
    const batch = git(['cat-file', '--batch'], {
      input: `${batchShas.join('\n')}\n`,
      encoding: null,
      maxBuffer: 192 * 1024 * 1024,
    });
    parseBatch(batch, objectPaths, findings);
  }
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.scope}|${item.severity}|${item.kind}|${normalized(item.file)}|${item.line || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const findings = [];
scanCurrent(findings);
if (HISTORY) scanHistory(findings);
const unique = dedupe(findings).sort((a, b) => `${a.scope}/${a.kind}/${a.file}/${a.line || 0}`.localeCompare(`${b.scope}/${b.kind}/${b.file}/${b.line || 0}`));

const grouped = new Map();
for (const item of unique) {
  const key = `${item.scope}:${item.severity}:${item.kind}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(item.line ? `${item.file}:${item.line}` : item.file);
}

console.log(`[privacy-audit] scanned current tree${HISTORY ? ' + full reachable Git history' : ''}`);
for (const [key, files] of grouped) {
  console.log(`\n${key} (${files.length})`);
  for (const file of files.slice(0, 80)) console.log(`- ${file}`);
  if (files.length > 80) console.log(`- ... ${files.length - 80} more`);
}
if (!unique.length) console.log('[privacy-audit] no findings');

const currentBlocks = unique.filter((item) => item.scope === 'current' && item.severity === 'block');
const historyBlocks = unique.filter((item) => item.scope === 'history' && item.severity === 'block');
if ((STRICT_CURRENT && currentBlocks.length) || (FAIL_HISTORY && historyBlocks.length)) process.exit(1);
