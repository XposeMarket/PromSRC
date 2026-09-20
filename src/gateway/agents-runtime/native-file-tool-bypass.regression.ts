import assert from 'node:assert/strict';
import { looksLikeNativeFileToolBypass } from './native-file-tool-bypass';

assert.equal(looksLikeNativeFileToolBypass("Add-Content -LiteralPath ISSUES.md -Value 'entry'"), false);
assert.equal(looksLikeNativeFileToolBypass("powershell -Command \"Add-Content -Path ISSUES.md -Value @'\nentry\n'@\""), false);
assert.equal(looksLikeNativeFileToolBypass("Get-Date | Add-Content -Path ISSUES.md"), false);
assert.equal(looksLikeNativeFileToolBypass("powershell -Command \"Set-Content -Path src/app.ts -Value 'replacement'\""), true);
assert.equal(looksLikeNativeFileToolBypass("node -e \"require('fs').writeFileSync('x', 'y')\""), true);

console.log('native file tool bypass regression passed');
