// connector_github list_prs returned the oldest pull requests for `state: all`
// (#2-#129 of ~900) and had no way to page or re-sort.
import assert from 'node:assert/strict';
import { pullsListPath } from './github';

const query = (path: string) => new URLSearchParams(path.split('?')[1]);

const defaults = query(pullsListPath('acme', 'app', 'all', 100));
assert.ok(pullsListPath('acme', 'app', 'all', 100).startsWith('/repos/acme/app/pulls?'));
assert.equal(defaults.get('state'), 'all');
assert.equal(defaults.get('sort'), 'created');
assert.equal(defaults.get('direction'), 'desc', 'newest first by default');
assert.equal(defaults.get('per_page'), '100');
assert.equal(defaults.get('page'), null, 'page 1 is the API default and is left off');

const custom = query(pullsListPath('acme', 'app', 'closed', 500, { sort: 'updated', direction: 'asc', page: 3, base: 'main', head: 'acme:fix/x' }));
assert.equal(custom.get('sort'), 'updated');
assert.equal(custom.get('direction'), 'asc');
assert.equal(custom.get('page'), '3');
assert.equal(custom.get('per_page'), '100', 'per_page is clamped to the API maximum');
assert.equal(custom.get('base'), 'main');
assert.equal(custom.get('head'), 'acme:fix/x');

assert.equal(query(pullsListPath('acme', 'app', 'open', 0)).get('per_page'), '30');
console.log('github list_prs sort, direction and paging regression passed');
