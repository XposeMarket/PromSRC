import assert from 'node:assert/strict';
import { looksLikeNativeFileToolBypass } from './native-file-tool-bypass';

// Existing contract: log appends stay on the shell path.
assert.equal(looksLikeNativeFileToolBypass("Add-Content -LiteralPath ISSUES.md -Value 'entry'"), false);
assert.equal(looksLikeNativeFileToolBypass("powershell -Command \"Add-Content -Path ISSUES.md -Value @'\nentry\n'@\""), false);
assert.equal(looksLikeNativeFileToolBypass("Get-Date | Add-Content -Path ISSUES.md"), false);

// Genuine bulk edits must still be blocked.
assert.equal(looksLikeNativeFileToolBypass("powershell -Command \"Set-Content -Path src/app.ts -Value 'replacement'\""), true);
assert.equal(looksLikeNativeFileToolBypass("node -e \"require('fs').writeFileSync('x', 'y')\""), true);
assert.equal(looksLikeNativeFileToolBypass("python -c \"open('x','w').write('y')\""), true);

// Real output redirects are still edits.
assert.equal(looksLikeNativeFileToolBypass('echo "done" > out.txt'), true);
assert.equal(looksLikeNativeFileToolBypass('echo "line" >> out.txt'), true);
assert.equal(looksLikeNativeFileToolBypass('echo "body" | Out-File -FilePath notes.txt'), true);
assert.equal(looksLikeNativeFileToolBypass('type template.txt > copy.txt'), true);

// Regression: stream-merge redirects (2>&1) are not file writes. Previously a
// read-only inspection that paired `echo` with `2>&1` was blocked outright.
assert.equal(
  looksLikeNativeFileToolBypass(
    'git log --oneline -6 -- src/gateway/process/supervisor.ts; echo "---GIT TOOL---"; git log --oneline -6 -- src/gateway/routes/processes.ts 2>&1',
  ),
  false,
);
assert.equal(looksLikeNativeFileToolBypass('echo "hello"; git status 2>&1'), false);
assert.equal(looksLikeNativeFileToolBypass('npm test 2>&1 | Select-Object -Last 20'), false);
assert.equal(looksLikeNativeFileToolBypass('echo "start"; npm run build 1>&2'), false);
assert.equal(looksLikeNativeFileToolBypass('echo "probe"; tsc --noEmit *>&1'), false);

// Regression: a redirect in a later, unrelated segment must not taint an
// earlier echo. Segment-local matching keeps these read-only.
assert.equal(looksLikeNativeFileToolBypass('echo "marker"; git diff --stat'), false);
assert.equal(looksLikeNativeFileToolBypass('Select-String -Path src/gateway/routes/processes.ts -Pattern "baseline"'), false);

// ...but a write in its own segment is still caught alongside an echo.
assert.equal(looksLikeNativeFileToolBypass('echo "marker"; echo "data" > out.txt'), true);

console.log('native file tool bypass regression passed');
