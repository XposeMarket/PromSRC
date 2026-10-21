import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import githubExtension, { validateGitHubApiPath, buildGitHubReviewCall, buildGitHubReviewCommentsCall } from './runtime.js';
import { resolveToolCapabilityMetadata } from '../../../../gateway/tool-capabilities.js';

// Every registered GitHub tool must be in both manifest allowlists, otherwise
// the connection layer reports "not enabled for this connection".
const registeredTools = new Map<string, any>();
let connectorToolNames: string[] = [];
githubExtension.register({
  registerConnector: (c: any) => { connectorToolNames = c.toolNames; },
  registerTool: (tool: any) => registeredTools.set(tool.name, tool),
} as any);

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src', 'extensions', 'bundled', 'connectors', 'github', 'prometheus.extension.json'), 'utf8'));
const owned = new Set<string>(manifest.ownership.tools);
const strategyTools = new Set<string>(manifest.connection.strategies[0].config.registeredTools);

for (const name of registeredTools.keys()) {
  assert.ok(connectorToolNames.includes(name), `${name} missing from runtime toolNames`);
  assert.ok(owned.has(name), `${name} missing from manifest ownership.tools`);
  assert.ok(strategyTools.has(name), `${name} missing from manifest strategy registeredTools`);
}
for (const name of ['connector_github_close_pr', 'connector_github_update_pr', 'connector_github_update_issue', 'connector_github_comment', 'connector_github_api_request']) {
  assert.ok(registeredTools.has(name), `${name} must register`);
}

// Write tools declare external-write side effects so approval gates apply.
for (const name of ['connector_github_close_pr', 'connector_github_update_pr', 'connector_github_update_issue', 'connector_github_comment', 'connector_github_merge_pr', 'connector_github_create_review']) {
  assert.equal(registeredTools.get(name).sideEffects?.externalWrite, true, `${name} must be an external write`);
}
// Review listing is a read: GET only, no write side effects.
assert.ok(registeredTools.has('connector_github_list_review_comments'), 'list_review_comments must register');
assert.ok(!registeredTools.get('connector_github_list_review_comments').sideEffects?.externalWrite, 'list_review_comments must be read-only');

// Raw API escape hatch: read-only only for GET/HEAD.
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, { method: 'GET' }).externalWrite, false);
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, { method: 'PATCH' }).externalWrite, true);
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, {}).externalWrite, true, 'missing method fails toward write');

// Path validation keeps requests on api.github.com.
assert.equal(validateGitHubApiPath('/repos/a/b/pulls/12'), null);
assert.equal(validateGitHubApiPath('/repos/a/b/issues?state=all&per_page=5'), null);
for (const bad of ['', 'repos/a/b', '//evil.com/x', 'https://evil.com/x', '/repos/../user', '/repos/a b', '/x\\y', '/a/./b']) {
  assert.ok(validateGitHubApiPath(bad), `path should be rejected: ${JSON.stringify(bad)}`);
}

// create_review request builder: POST shape, defaults, passthrough.
const base = { owner: 'a', repo: 'b', pr_number: 12, body: 'Looks good with one nit' };
const ok: any = buildGitHubReviewCall({ ...base, comments: [{ path: 'src/x.ts', line: 7, body: 'nit' }], commit_id: 'abc123' });
assert.ok(!('error' in ok), 'valid review must build');
assert.equal(ok.method, 'POST');
assert.equal(ok.path, '/repos/a/b/pulls/12/reviews');
assert.deepEqual(ok.body, { event: 'COMMENT', body: 'Looks good with one nit', comments: [{ path: 'src/x.ts', line: 7, side: 'RIGHT', body: 'nit' }], commit_id: 'abc123' });
assert.equal(ok.commentCount, 1);

const ranged: any = buildGitHubReviewCall({ ...base, event: 'request_changes', comments: [{ path: 'src/x.ts', line: 7, start_line: 5, body: 'range' }] });
assert.equal(ranged.body.event, 'REQUEST_CHANGES');
assert.deepEqual(ranged.body.comments[0], { path: 'src/x.ts', line: 7, side: 'RIGHT', body: 'range', start_line: 5, start_side: 'RIGHT' });
assert.ok(!('commit_id' in ranged.body), 'commit_id only sent when provided');

// Validation rejects with an error and never builds a request.
const bad: [string, any][] = [
  ['empty path', { ...base, comments: [{ path: '', line: 3, body: 'x' }] }],
  ['missing path', { ...base, comments: [{ line: 3, body: 'x' }] }],
  ['line zero', { ...base, comments: [{ path: 'a', line: 0, body: 'x' }] }],
  ['line negative', { ...base, comments: [{ path: 'a', line: -1, body: 'x' }] }],
  ['line fractional', { ...base, comments: [{ path: 'a', line: 1.5, body: 'x' }] }],
  ['line non-numeric', { ...base, comments: [{ path: 'a', line: 'abc', body: 'x' }] }],
  ['empty body', { ...base, body: '   ' }],
  ['invalid event', { ...base, event: 'LGTM' }],
  ['invalid side', { ...base, comments: [{ path: 'a', line: 2, side: 'MIDDLE', body: 'x' }] }],
  ['too many comments', { ...base, comments: Array.from({ length: 51 }, () => ({ path: 'a', line: 1, body: 'x' })) }],
];
for (const [label, args] of bad) {
  assert.ok('error' in buildGitHubReviewCall(args), `create_review must reject: ${label}`);
}
assert.ok('error' in buildGitHubReviewCall({ ...base, pr_number: 0 }), 'pr_number must be positive');

// Tool execute rejects before touching the connector (no API call, no "not connected" path).
const createTool = registeredTools.get('connector_github_create_review');
const toolCheck = createTool.execute({ ...base, comments: [{ path: '', line: 3, body: 'x' }] }).then((res: unknown) => {
  const rejected = JSON.stringify(res);
  assert.match(rejected, /path is required/, 'tool must surface the validation error');
  assert.doesNotMatch(rejected, /not connected/i);
});

// list_review_comments builder: GET to the comments endpoint, per_page capped at 100.
assert.deepEqual(buildGitHubReviewCommentsCall({ owner: 'a', repo: 'b', pr_number: 12 }), { method: 'GET', path: '/repos/a/b/pulls/12/comments?per_page=30' });
assert.deepEqual(buildGitHubReviewCommentsCall({ owner: 'a', repo: 'b', pr_number: 12, per_page: 500 }), { method: 'GET', path: '/repos/a/b/pulls/12/comments?per_page=100' });
assert.ok('error' in buildGitHubReviewCommentsCall({ owner: 'a', repo: 'b' }), 'list requires pr_number');

toolCheck.then(() => {
  console.log(`github connector regression: ${registeredTools.size} tools, manifests in sync, write gates, review builders + validation, path validation OK`);
});
