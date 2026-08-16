from pathlib import Path

root = Path('.')
server = root / 'src/gateway/core/server.ts'
source_sw = root / 'web-ui/service-worker.js'
generated_sw = root / 'generated/public-web-ui/service-worker.js'

server_text = server.read_text(encoding='utf-8')
old_server = """  if (pathname.startsWith('/static/') || pathname.startsWith('/vendor/') || pathname.startsWith('/assets/')) {\n    return 'public, max-age=86400';\n  }\n"""
new_server = """  // Generated /static module filenames are stable rather than content-hashed.\n  // Always revalidate them so an app update cannot leave a browser executing\n  // yesterday's JS/CSS under a still-fresh 24-hour HTTP cache entry.\n  if (pathname.startsWith('/static/')) return 'no-cache';\n  if (pathname.startsWith('/vendor/') || pathname.startsWith('/assets/')) {\n    return 'public, max-age=86400';\n  }\n"""
if old_server not in server_text:
    raise SystemExit('server cache-control anchor not found')
server.write_text(server_text.replace(old_server, new_server, 1), encoding='utf-8')

for sw_path in (source_sw, generated_sw):
    text = sw_path.read_text(encoding='utf-8')
    old_version = "const VERSION = 'pm-v291-2026-08-13-mobile-syntax-recovery';"
    new_version = "const VERSION = 'pm-v292-2026-08-15-static-cache-contract';"
    if old_version not in text:
        raise SystemExit(f'service worker version anchor not found in {sw_path}')
    text = text.replace(old_version, new_version, 1)

    old_fetch = """    const res = await fetch(request);\n"""
    new_fetch = """    // `no-cache` forces HTTP revalidation too. This matters after upgrading\n    // from builds that served stable /static filenames with a 24-hour max-age.\n    const res = await fetch(request, { cache: 'no-cache' });\n"""
    if old_fetch not in text:
        raise SystemExit(f'networkFirst fetch anchor not found in {sw_path}')
    text = text.replace(old_fetch, new_fetch, 1)

    old_route = """  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/src/')) {\n"""
    new_route = """  if (\n    url.pathname === '/'\n    || url.pathname === '/index.html'\n    || url.pathname.startsWith('/src/')\n    || url.pathname.startsWith('/static/')\n  ) {\n"""
    if old_route not in text:
        raise SystemExit(f'static fetch-route anchor not found in {sw_path}')
    text = text.replace(old_route, new_route, 1)
    sw_path.write_text(text, encoding='utf-8')

regression = root / 'scripts/test-public-ui-cache-contract.mjs'
regression.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('src/gateway/core/server.ts', 'utf8');
const sourceSw = fs.readFileSync('web-ui/service-worker.js', 'utf8');
const generatedSw = fs.readFileSync('generated/public-web-ui/service-worker.js', 'utf8');

assert.match(
  server,
  /pathname\.startsWith\('\/static\/'\)\) return 'no-cache'/,
  'stable generated /static module URLs must revalidate instead of staying fresh for 24 hours',
);
assert.doesNotMatch(
  server,
  /pathname\.startsWith\('\/static\/'\)\s*\|\|\s*pathname\.startsWith\('\/vendor\/'\)/,
  '/static must not share the long-lived immutable-ish vendor/assets policy',
);

for (const [name, sw] of [['source', sourceSw], ['generated', generatedSw]]) {
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/, `${name} network-first fetch must force HTTP revalidation`);
  assert.match(sw, /url\.pathname\.startsWith\('\/static\/'\)/, `${name} service worker must route /static through CacheStorage fallback`);
  assert.match(sw, /'\/static\/mobile\/mobile-api\.js'/, `${name} precache must still include generated mobile modules`);
}
assert.equal(sourceSw, generatedSw, 'source and generated service-worker cache contracts must stay identical');

console.log('public UI cache contract regression: ok');
''', encoding='utf-8')

print('public UI cache contract patch applied')
