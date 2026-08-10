import assert from 'assert';
import fs from 'fs';
import path from 'path';

const routerPath = path.join(process.cwd(), 'src', 'gateway', 'routes', 'resources.router.ts');
const source = fs.readFileSync(routerPath, 'utf8');
const listStart = source.indexOf("router.get('/api/sessions/:sessionId/resources'");
const listEnd = source.indexOf('\n});', listStart);
const contentStart = source.indexOf("router.get('/api/sessions/:sessionId/resources/:resourceId/content'");
assert.ok(listStart >= 0, 'resource list route must exist');
assert.ok(listEnd > listStart, 'resource list route must be closed');
assert.ok(contentStart > listStart, 'resource content route must follow resource list route');
assert.equal(source.slice(listStart, listEnd).includes('migrateLegacyHistory'), false, 'GET resource listing must be side-effect free');
assert.match(source, /router\.post\('\/api\/sessions\/:sessionId\/resources\/migrate'/, 'migration must be explicit POST');
assert.match(source, /sessionExists\(sessionId\)/, 'resource routes must require an existing authorized session');
assert.match(source, /deleteResourceForThread\(sessionId, resourceId/, 'delete must be thread-authorized');
assert.match(source, /assertSafeStorageId\(String\(req\.params\.resourceId/, 'resource IDs must be boundary-validated');

console.log('resources-router regression: ok');
