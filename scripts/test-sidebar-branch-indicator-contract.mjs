import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(root, 'web-ui/index.html'), 'utf8');
const generatedInline = fs.readdirSync(path.join(root, 'generated/public-web-ui/build/inline'))
  .filter((name) => /^index-inline-\d+-.*\.js$/.test(name))
  .sort()
  .map((name) => fs.readFileSync(path.join(root, 'generated/public-web-ui/build/inline', name), 'utf8'))
  .join('\n');
const codingRouter = fs.readFileSync(path.join(root, 'src/gateway/routes/coding.router.ts'), 'utf8');
const componentsCss = fs.readFileSync(path.join(root, 'web-ui/src/styles/components.css'), 'utf8');

assert.match(codingRouter, /router\.get\('\/api\/coding\/session-metadata'/);
assert.match(codingRouter, /getCodingWorkspaceSession\(root\)/);
assert.match(codingRouter, /path\.resolve\(root\)\.toLowerCase\(\) !== path\.resolve\(configuredRoot\)\.toLowerCase\(\)/);

assert.match(indexHtml, /function ensureSidebarBranchMetadata\(sessions = \[\]\)/);
assert.match(indexHtml, /\/api\/coding\/session-metadata\?/);
assert.match(indexHtml, /function renderSidebarBranchIndicator\(session, placement = 'default'\)/);
assert.match(indexHtml, /function showSidebarBranchPopover\(source\)/);
assert.match(indexHtml, /renderSidebarBranchIndicator\(session, 'default'\)/);
assert.match(indexHtml, /const branch = renderSidebarBranchIndicator\(s, 'priority'\)/);
assert.match(indexHtml, /ensureSidebarBranchMetadata\(\[\.\.\.pinned, \.\.\.displayedUnpinned\]\)/);
assert.match(indexHtml, /ensureSidebarBranchMetadata\(activeSessions\.slice\(0, 80\)\)/);

assert.match(componentsCss, /\.chat-session-top-meta\s*\{/);
assert.match(componentsCss, /\.sidebar-branch-indicator\s*\{/);
assert.match(componentsCss, /\.sidebar-branch-popover\.is-visible\s*\{/);
assert.match(componentsCss, /\.sidebar-branch-indicator--priority\s*\{\s*margin-left: auto;/);

assert.match(generatedInline, /renderSidebarBranchIndicator/);
assert.match(generatedInline, /\/api\/coding\/session-metadata\?/);

console.log('sidebar branch indicator contract: scoped metadata, default/priority placement, hover popover, CSS, and generated inline parity passed');
