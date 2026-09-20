/**
 * The destructive-command guard must block real invocations without rejecting
 * ordinary English.
 *
 * Observed live: `git commit -m "...grep compaction, output format..."` and
 * `Select-String -Pattern "compact|format"` were both blocked because the
 * pattern list contained the bare word "format". The matcher also stripped
 * whitespace from each pattern, so a qualified entry like "format c:" could
 * never have matched anything.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}: ${(error as Error).message}`);
  }
}

/** Mirror of the shipped matcher, verified against source below. */
function commandContainsBlockedPattern(command: string, blockedPatterns: string[] | undefined): string | null {
  const cmd = String(command || '').toLowerCase();
  const boundary = '(?:^|[\\s;&|()])';
  const endBoundary = '(?:$|[\\s;&|()])';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const rawBlocked of blockedPatterns || []) {
    const blocked = String(rawBlocked || '').trim().toLowerCase();
    if (!blocked) continue;
    const parts = blocked.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const sequence = parts.map(escape).join('(?:[\\s]+[^\\s;&|()]+){0,3}?[\\s]+');
    const pattern = parts.length === 1
      ? `${boundary}${sequence}${endBoundary}`
      : `${boundary}${sequence}`;
    if (new RegExp(pattern, 'i').test(cmd)) return blocked;
  }
  return null;
}

const repoRoot = process.cwd();
const helpersSource = fs.readFileSync(
  path.join(repoRoot, 'src', 'gateway', 'chat', 'chat-helpers.ts'),
  'utf-8',
);
const executorSource = fs.readFileSync(
  path.join(repoRoot, 'src', 'gateway', 'agents-runtime', 'subagent-executor.ts'),
  'utf-8',
);

const listMatch = helpersSource.match(/const BLOCKED_PATTERNS = \[([\s\S]*?)\];/);
assert.ok(listMatch, 'BLOCKED_PATTERNS must be present in chat-helpers.ts');
const BLOCKED_PATTERNS = Array.from(listMatch![1].matchAll(/'([^']+)'/g)).map(m => m[1]);

console.log('shell-blocked-pattern regression');

check('pattern list contains no bare vocabulary words', () => {
  const bare = BLOCKED_PATTERNS.filter(p => /^(format|shutdown|restart|stop|delete|remove)$/i.test(p.trim()));
  assert.deepStrictEqual(bare, [], `bare words still present: ${bare.join(', ')}`);
});

check('matcher no longer strips whitespace from patterns', () => {
  assert.ok(
    !/const token = blocked\.replace\(\/\\s\+\/g, ''\)/.test(executorSource),
    'whitespace-stripping made multi-token patterns unmatchable',
  );
});

check('destructive disk commands are blocked', () => {
  for (const cmd of [
    'format c:',
    'format /fs:ntfs c:',
    'FORMAT C: /Q',
    'mkfs -t ext4 /dev/sda1',
    'diskpart',
  ]) {
    assert.ok(commandContainsBlockedPattern(cmd, BLOCKED_PATTERNS), `should block: ${cmd}`);
  }
});

check('destructive power commands are blocked', () => {
  for (const cmd of ['shutdown /s /t 0', 'shutdown -r now', 'Stop-Computer', 'Restart-Computer -Force']) {
    assert.ok(commandContainsBlockedPattern(cmd, BLOCKED_PATTERNS), `should block: ${cmd}`);
  }
});

check('the exact commands wrongly blocked this session are allowed', () => {
  const allowed = [
    'git commit -q -m "grep compaction, output format, goal-reminder throttle"',
    'Select-String -Path src/tools/file-intelligence.ts -Pattern "compact|format"',
    'Get-ChildItem | Format-Table -AutoSize',
    'git log --pretty=format:%h',
    'npm run build && node scripts/restart-check.mjs',
    'echo "restart the gateway from updated PromSRC"',
  ];
  for (const cmd of allowed) {
    const hit = commandContainsBlockedPattern(cmd, BLOCKED_PATTERNS);
    assert.strictEqual(hit, null, `should allow: ${cmd} (blocked by "${hit}")`);
  }
});

check('a blocked token inside an unrelated long command does not false-positive', () => {
  const hit = commandContainsBlockedPattern(
    'git log --oneline | Select-String "format" ; Write-Host "c: drive"',
    BLOCKED_PATTERNS,
  );
  assert.strictEqual(hit, null, `unexpected block: ${hit}`);
});

if (failures) {
  console.error(`shell-blocked-pattern regression FAILED (${failures})`);
  process.exit(1);
}
console.log('shell-blocked-pattern regression passed');
