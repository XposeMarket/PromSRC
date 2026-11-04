// Regression (2026-11-04, iPhone over Tailscale Funnel):
// 1. The mobile canvas sheet loaded text/code files with a bare fetch() that
//    carried no pairing token, so every file from the end-of-turn diff card
//    showed "Unauthorized: proxied remote requests require a paired device or
//    gateway token".
// 2. Model-authored markdown links to workspace files ([plan](plans/x.md))
//    navigated the PWA to a raw Unauthorized JSON page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const read = (rel) => lf(fs.readFileSync(path.join(root, rel), 'utf8'));

const linkSrc = read('web-ui/src/workspace-file-links.js');
const tmp = path.join(os.tmpdir(), `workspace-file-links-${process.pid}.mjs`);
fs.writeFileSync(tmp, linkSrc);
const { workspaceFilePathFromHref, resolveWorkspaceFileLinks } = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

// --- classification: workspace files ---
const files = {
  'plans/connected-memory/PLAN.md': 'plans/connected-memory/PLAN.md',
  './notes/today.txt': 'notes/today.txt',
  'docs/my%20file.md': 'docs/my file.md',
  'FACTS.md': 'FACTS.md',
  'src/app.ts#L20': 'src/app.ts',
  'C:\\Users\\me\\workspace\\out.json': 'C:\\Users\\me\\workspace\\out.json',
  'file:///C:/Users/me/report.pdf': 'C:/Users/me/report.pdf',
};
for (const [href, expected] of Object.entries(files)) {
  assert.equal(workspaceFilePathFromHref(href), expected, `should treat ${href} as a workspace file`);
}

// --- classification: must NOT be treated as files ---
const notFiles = [
  'https://example.com/a.md', 'http://localhost:18789/x.js', 'mailto:a@b.co', 'tel:+15551234',
  '#section', '/api/canvas/inline?path=a.md', '//cdn.example.com/a.js', 'javascript:alert(1)',
  'data:text/plain,hi', 'plans/connected-memory', 'README', 'example.com', 'www.site.org/page.html', '',
];
for (const href of notFiles) {
  assert.equal(workspaceFilePathFromHref(href), '', `must not treat ${JSON.stringify(href)} as a workspace file`);
}

// --- HTML rewrite ---
const toUrl = (p) => `https://gw.example/api/canvas/inline?path=${encodeURIComponent(p)}&pt=tok`;
const html = [
  '<p><a href="plans/connected-memory/PLAN.md">Locked plan</a></p>',
  '<p><a href="https://example.com/doc.md">web</a></p>',
  '<p><a href="#top">top</a></p>',
  '<p><a href="docs/a&amp;b.md">amp</a></p>',
].join('');
const out = resolveWorkspaceFileLinks(html, toUrl);
assert.match(out, /<a href="https:\/\/gw\.example\/api\/canvas\/inline\?path=plans%2Fconnected-memory%2FPLAN\.md" data-workspace-file="plans\/connected-memory\/PLAN\.md">Locked plan<\/a>/);
assert.doesNotMatch(out, /pt=tok/, 'link hrefs must never carry the device pairing token');
assert.match(resolveWorkspaceFileLinks('<a href="a/b.md">x</a>', () => 'https://gw/api/canvas/inline?pt=tok&path=a%2Fb.md'), /href="https:\/\/gw\/api\/canvas\/inline\?path=a%2Fb\.md"/, 'leading pt param is stripped too');
assert.match(out, /<a href="https:\/\/example\.com\/doc\.md">web<\/a>/, 'web links untouched');
assert.match(out, /<a href="#top">top<\/a>/, 'anchors untouched');
assert.match(out, /data-workspace-file="docs\/a&amp;b\.md"/, 'attribute values are escaped');
assert.equal(resolveWorkspaceFileLinks(out, toUrl), out, 'rewrite is idempotent');
assert.equal(resolveWorkspaceFileLinks('<p>no links</p>', toUrl), '<p>no links</p>');
// Inline code is not an anchor, so it is never rewritten.
assert.equal(resolveWorkspaceFileLinks('<code>plans/a.md</code>', toUrl), '<code>plans/a.md</code>');
// A throwing resolver keeps the original href and still marks the link.
assert.match(resolveWorkspaceFileLinks('<a href="a/b.md">x</a>', () => { throw new Error('boom'); }), /href="a\/b\.md" data-workspace-file="a\/b\.md"/);

// --- wiring contracts ---
const shell = read('web-ui/src/mobile/mobile-shell.js');
assert.doesNotMatch(shell, /(?<![\w.])fetch\(\s*[`'"]\/api\//, 'mobile-shell.js must not call bare fetch(\'/api/...\'): it drops the pairing token');
assert.match(shell, /mobileGatewayFetch\(`\/api\/canvas\/file\?path=/, 'canvas text view loads through mobileGatewayFetch');
assert.match(shell, /mobileGatewayFetch\(`\/api\/canvas\/diff-ranges\?path=/, 'diff view loads ranges through mobileGatewayFetch');
assert.match(shell, /mobileGatewayFetch\(`\/api\/preview\/screenshot\?path=/, 'preview loads through mobileGatewayFetch');

const utils = read('web-ui/src/utils.js');
assert.match(utils, /import \{ resolveWorkspaceFileLinks \} from '\.\/workspace-file-links\.js'/);
assert.match(utils, /resolveWorkspaceFileLinks\(resolveWorkspaceImageSources\(/, 'renderMd marks workspace links');
assert.match(utils, /closest\?\.\('a\[data-workspace-file\]'\)/, 'delegated click opens the host file viewer');
assert.match(utils, /window\.__promOpenWorkspaceFile/);
assert.match(utils, /window\.canvasPresentFile/, 'desktop falls back to its Canvas');

const pages = read('web-ui/src/mobile/mobile-pages.js');
assert.match(pages, /window\.__promOpenWorkspaceFile = \(path, name\) => _openMobileMediaTarget\(/, 'mobile opens workspace links in the canvas sheet');

// Generated public UI must mirror source when present.
for (const rel of ['workspace-file-links.js', 'utils.js', 'mobile/mobile-shell.js', 'mobile/mobile-pages.js']) {
  const gen = path.join(root, 'generated/public-web-ui/static', rel);
  if (fs.existsSync(gen)) assert.equal(lf(fs.readFileSync(gen, 'utf8')), read(`web-ui/src/${rel}`), `generated ${rel} must mirror source`);
}

console.log('test-mobile-file-viewer-auth: PASS');
