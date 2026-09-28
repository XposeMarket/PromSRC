// Native GitHub connector runtime. See §23B. Auth stays in GitHubConnector.
import type { GitHubConnector } from '../../../../integrations/connectors/github.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

/**
 * Agents frequently send GitHub's REST name `pull_number` (or `number`) instead of
 * the schema's `pr_number`. `Number(undefined)` is NaN, which GitHub answers with a
 * misleading 404. Accept the common aliases and reject anything that is not a
 * positive integer before making the API call.
 */
export function resolvePullRequestNumber(args: any): number | null {
  const raw = args?.pr_number ?? args?.pull_number ?? args?.prNumber ?? args?.pullNumber ?? args?.number;
  const text = String(raw ?? '').trim().replace(/^#/, '');
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const ID = 'github';
const NAME = 'GitHub';
const tools = [
  'connector_github_list_repos',
  'connector_github_list_issues',
  'connector_github_create_issue',
  'connector_github_create_repo',
  'connector_github_list_prs',
  'connector_github_create_pr',
  'connector_github_merge_pr',
  'connector_github_get_pr',
  'connector_github_list_commits',
  'connector_github_list_check_runs',
  'connector_github_get_file',
  'connector_github_search',
  'connector_github_update_pr',
  'connector_github_close_pr',
  'connector_github_update_issue',
  'connector_github_comment',
  'connector_github_api_request',
];

const GITHUB_API_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const MAX_GITHUB_API_PATH_CHARS = 2000;
const MAX_GITHUB_API_BODY_CHARS = 200_000;
const MAX_GITHUB_API_RESULT_CHARS = 60_000;
const WRITE_EFFECTS = { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true };

/** Only relative api.github.com paths: no scheme, host, traversal, or control chars. */
export function validateGitHubApiPath(path: unknown): string | null {
  const value = typeof path === 'string' ? path.trim() : '';
  if (!value) return 'path is required, for example /repos/OWNER/REPO/pulls/12.';
  if (!value.startsWith('/') || value.startsWith('//')) return 'path must be a relative GitHub API path starting with a single /.';
  if (/[\s\x00-\x1f\\]/.test(value) || /:\/\//.test(value)) return 'path must not contain whitespace, backslashes, control characters, or a URL scheme.';
  if (value.split('?')[0].split('/').some((seg) => seg === '..' || seg === '.')) return 'path must not contain . or .. segments.';
  if (value.length > MAX_GITHUB_API_PATH_CHARS) return `path must be ${MAX_GITHUB_API_PATH_CHARS} characters or fewer.`;
  return null;
}

function cleanPatch<T extends Record<string, any>>(patch: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined && value !== null && value !== '') out[key] = value;
  return out as Partial<T>;
}

function resolveIssueNumber(args: any): number | null {
  return resolvePullRequestNumber({ pr_number: args?.issue_number ?? args?.issueNumber ?? args?.pr_number ?? args?.pull_number ?? args?.number });
}

function gh(): GitHubConnector | undefined {
  return getLiveConnector<GitHubConnector>(ID);
}
async function withConn<T>(fn: (c: GitHubConnector) => Promise<T> | T) {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = gh();
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['code-hosting'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_github_list_repos',
      description: '[GitHub] List repositories for the connected GitHub account, sorted by last updated.',
      parameters: { type: 'object', required: [], properties: { per_page: { type: 'number', description: 'Number of repos to return (default: 50)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const repos = await c.listRepos(args.per_page || 50);
        if (!Array.isArray(repos)) return toolOk(repos as any);
        return toolOk(repos.map((r: any) => `${r.full_name} — ${r.description || 'no description'} (⭐${r.stargazers_count}, updated: ${r.updated_at?.slice(0, 10)})`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_github_list_issues',
      description: '[GitHub] List issues for a repository.',
      parameters: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string', description: 'Repository owner (username or org)' }, repo: { type: 'string', description: 'Repository name' }, state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' }, per_page: { type: 'number', description: 'Number of issues (default: 30)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const issues = await c.listIssues(args.owner, args.repo, args.state || 'open', args.per_page || 30);
        if (!issues.length) return toolOk('No issues found.');
        return toolOk(issues.map((i: any) => `#${i.number} [${i.state}] ${i.title}\n  by ${i.user?.login} | ${i.created_at?.slice(0, 10)} | labels: ${i.labels?.map((l: any) => l.name).join(', ') || 'none'}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_github_create_issue',
      description: '[GitHub] Create a new issue in a repository.',
      parameters: { type: 'object', required: ['owner', 'repo', 'title'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue description (markdown supported)' }, labels: { type: 'array', items: { type: 'string' }, description: 'Label names to apply' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const issue = await c.createIssue(args.owner, args.repo, args.title, args.body || '', args.labels || []);
        return toolOk(`Issue created: #${issue.number} — ${issue.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_create_repo',
      description: '[GitHub] Create a new repository for the connected GitHub account. Requires approval before execution.',
      parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Repository name' }, description: { type: 'string', description: 'Repository description' }, private: { type: 'boolean', description: 'Whether the repository should be private. Defaults to true.' }, auto_init: { type: 'boolean', description: 'Create the repository with an initial README commit.' }, homepage: { type: 'string', description: 'Optional homepage URL' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const repo = await c.createRepo(args.name, { description: args.description || '', private: args.private !== false, autoInit: args.auto_init === true, homepage: args.homepage || '' });
        return toolOk(`Repository created: ${repo.full_name} - ${repo.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_list_prs',
      description: '[GitHub] List pull requests for a repository.',
      parameters: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state (default: open)' }, per_page: { type: 'number', description: 'Number of PRs (default: 30)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const prs = await c.listPRs(args.owner, args.repo, args.state || 'open', args.per_page || 30);
        if (!prs.length) return toolOk('No pull requests found.');
        return toolOk(prs.map((p: any) => `#${p.number} [${p.state}] ${p.title}\n  by ${p.user?.login} | ${p.created_at?.slice(0, 10)} | ${p.draft ? 'DRAFT' : 'ready'}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_github_create_pr',
      description: '[GitHub] Create a pull request. Requires approval before execution.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'title', 'head', 'base'],
        properties: {
          owner: { type: 'string', description: 'Repository owner (username or org)' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Pull request title' },
          head: { type: 'string', description: 'Head branch, or owner:branch for a fork' },
          base: { type: 'string', description: 'Base branch to merge into' },
          body: { type: 'string', description: 'Pull request description (markdown supported)' },
          draft: { type: 'boolean', description: 'Create as a draft pull request. Defaults to false.' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const pr = await c.createPullRequest(args.owner, args.repo, {
          title: args.title,
          head: args.head,
          base: args.base,
          body: args.body || '',
          draft: args.draft === true,
        });
        return toolOk(`Pull request created: #${pr.number} — ${pr.html_url}`);
      }),
    });


    api.registerTool({
      name: 'connector_github_merge_pr',
      description: '[GitHub] Merge a pull request. Requires approval in Default permissions mode; Lite mode executes automatically.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'pr_number'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          pr_number: { type: 'number', description: 'Pull request number' },
          merge_method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge strategy (default: merge)' },
          commit_title: { type: 'string', description: 'Optional merge commit title' },
          commit_message: { type: 'string', description: 'Optional merge commit message' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      sideEffects: { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true },
      execute: (args: any) => withConn(async (c) => {
        const prNumber = resolvePullRequestNumber(args);
        if (prNumber === null) return toolError('pr_number is required and must be a positive integer (pull request number).');
        const result = await c.mergePullRequest(args.owner, args.repo, prNumber, {
          mergeMethod: args.merge_method || 'merge',
          commitTitle: args.commit_title,
          commitMessage: args.commit_message,
        });
        if (!result.merged) return toolError(`Pull request was not merged: ${result.message || 'GitHub rejected the merge.'}`);
        return toolOk(`Pull request merged: ${result.sha || 'success'}`);
      }),
    });


    api.registerTool({
      name: 'connector_github_update_pr',
      description: '[GitHub] Update a pull request: close or reopen it (state), or change its title, body, or base branch. Requires approval in Default permissions mode.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'pr_number'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          pr_number: { type: 'number', description: 'Pull request number' },
          state: { type: 'string', enum: ['open', 'closed'], description: 'Set to closed to close the PR, open to reopen it' },
          title: { type: 'string', description: 'New title' },
          body: { type: 'string', description: 'New description (markdown)' },
          base: { type: 'string', description: 'New base branch' },
          comment: { type: 'string', description: 'Optional comment posted before the update, e.g. "Superseded by #464"' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      sideEffects: WRITE_EFFECTS,
      execute: (args: any) => withConn(async (c) => {
        const prNumber = resolvePullRequestNumber(args);
        if (prNumber === null) return toolError('pr_number is required and must be a positive integer (pull request number).');
        const patch = cleanPatch({ state: args.state, title: args.title, body: args.body, base: args.base });
        if (patch.state && patch.state !== 'open' && patch.state !== 'closed') return toolError('state must be open or closed.');
        const comment = typeof args.comment === 'string' ? args.comment.trim() : '';
        if (!Object.keys(patch).length && !comment) return toolError('Nothing to update: pass state, title, body, base, or comment.');
        if (comment) await c.createIssueComment(args.owner, args.repo, prNumber, comment);
        if (!Object.keys(patch).length) return toolOk(`Commented on PR #${prNumber}.`);
        const pr = await c.updatePullRequest(args.owner, args.repo, prNumber, patch as any);
        return toolOk(`PR #${pr.number} [${pr.state}] ${pr.title}${comment ? ' (comment posted)' : ''}\n  ${pr.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_close_pr',
      description: '[GitHub] Close a pull request without merging, optionally leaving a comment first (e.g. "Superseded by #464"). Requires approval in Default permissions mode.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'pr_number'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          pr_number: { type: 'number', description: 'Pull request number' },
          comment: { type: 'string', description: 'Optional closing comment' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      sideEffects: WRITE_EFFECTS,
      execute: (args: any) => withConn(async (c) => {
        const prNumber = resolvePullRequestNumber(args);
        if (prNumber === null) return toolError('pr_number is required and must be a positive integer (pull request number).');
        const comment = typeof args.comment === 'string' ? args.comment.trim() : '';
        if (comment) await c.createIssueComment(args.owner, args.repo, prNumber, comment);
        const pr = await c.updatePullRequest(args.owner, args.repo, prNumber, { state: 'closed' });
        if (pr.state !== 'closed') return toolError(`GitHub did not close PR #${prNumber} (state: ${pr.state}).`);
        return toolOk(`Closed PR #${pr.number}: ${pr.title}${comment ? ' (comment posted)' : ''}\n  ${pr.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_update_issue',
      description: '[GitHub] Update an issue: close or reopen it, or change its title, body, labels, or assignees. Requires approval in Default permissions mode.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'issue_number'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          issue_number: { type: 'number', description: 'Issue number' },
          state: { type: 'string', enum: ['open', 'closed'], description: 'closed to close, open to reopen' },
          state_reason: { type: 'string', enum: ['completed', 'not_planned', 'reopened'], description: 'Optional reason for the state change' },
          title: { type: 'string', description: 'New title' },
          body: { type: 'string', description: 'New body (markdown)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Replace labels with this list' },
          assignees: { type: 'array', items: { type: 'string' }, description: 'Replace assignees with this list' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      sideEffects: WRITE_EFFECTS,
      execute: (args: any) => withConn(async (c) => {
        const issueNumber = resolveIssueNumber(args);
        if (issueNumber === null) return toolError('issue_number is required and must be a positive integer.');
        const patch = cleanPatch({ state: args.state, state_reason: args.state_reason, title: args.title, body: args.body, labels: Array.isArray(args.labels) ? args.labels : undefined, assignees: Array.isArray(args.assignees) ? args.assignees : undefined });
        if (!Object.keys(patch).length) return toolError('Nothing to update: pass state, title, body, labels, or assignees.');
        const issue = await c.updateIssue(args.owner, args.repo, issueNumber, patch as any);
        return toolOk(`#${issue.number} [${issue.state}] ${issue.title}\n  ${issue.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_comment',
      description: '[GitHub] Post a comment on an issue or pull request. Requires approval in Default permissions mode.',
      parameters: {
        type: 'object',
        required: ['owner', 'repo', 'issue_number', 'body'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          issue_number: { type: 'number', description: 'Issue or pull request number' },
          body: { type: 'string', description: 'Comment text (markdown)' },
        },
      },
      connectorId: ID, capability: 'code-hosting',
      sideEffects: WRITE_EFFECTS,
      execute: (args: any) => withConn(async (c) => {
        const issueNumber = resolveIssueNumber(args);
        if (issueNumber === null) return toolError('issue_number is required and must be a positive integer (issue or PR number).');
        const body = typeof args.body === 'string' ? args.body.trim() : '';
        if (!body) return toolError('body is required.');
        const comment = await c.createIssueComment(args.owner, args.repo, issueNumber, body);
        return toolOk(`Comment posted: ${comment.html_url}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_api_request',
      description: '[GitHub] Call any GitHub REST API endpoint not covered by a first-class tool (reviews, labels, releases, workflows, branches, reactions, etc.). Paths are restricted to api.github.com. GET/HEAD are read-only; other methods use the normal external-write approval gate.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Relative GitHub API path beginning with /, query string allowed, e.g. /repos/OWNER/REPO/pulls/12/reviews' },
          method: { type: 'string', enum: GITHUB_API_METHODS, description: 'HTTP method, default GET' },
          body: { type: 'object', description: 'Optional JSON body for write methods' },
        },
      },
      connectorId: ID, capability: 'api',
      execute: (args: any) => withConn(async (c) => {
        const path = typeof args?.path === 'string' ? args.path.trim() : '';
        const pathError = validateGitHubApiPath(path);
        if (pathError) return toolError(pathError);
        const method = String(args?.method || 'GET').trim().toUpperCase();
        if (!GITHUB_API_METHODS.includes(method)) return toolError(`method must be one of ${GITHUB_API_METHODS.join(', ')}.`);
        if (args?.body !== undefined && method !== 'GET' && method !== 'HEAD') {
          let serialized: string | undefined;
          try { serialized = JSON.stringify(args.body); } catch { return toolError('body must be JSON-serializable.'); }
          if (serialized === undefined) return toolError('body must be a JSON value.');
          if (serialized.length > MAX_GITHUB_API_BODY_CHARS) return toolError(`body must be ${MAX_GITHUB_API_BODY_CHARS} characters or fewer.`);
        }
        const res = await c.apiRequest(method, path, args?.body);
        let text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        if (text.length > MAX_GITHUB_API_RESULT_CHARS) text = `${text.slice(0, MAX_GITHUB_API_RESULT_CHARS)}\n...[truncated ${text.length - MAX_GITHUB_API_RESULT_CHARS} chars]`;
        const head = `GitHub API ${method} ${path} -> ${res.status}`;
        return res.ok ? toolOk(text ? `${head}\n${text}` : head) : toolError(`${head}\n${text}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_get_pr',
      description: '[GitHub] Get a single pull request by number.',
      parameters: { type: 'object', required: ['owner', 'repo', 'pr_number'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, pr_number: { type: 'number', description: 'Pull request number' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const prNumber = resolvePullRequestNumber(args);
        if (prNumber === null) return toolError('pr_number is required and must be a positive integer (pull request number).');
        const pr = await c.getPR(args.owner, args.repo, prNumber);
        return toolOk(`#${pr.number} [${pr.state}] ${pr.title}\n  ${pr.html_url}\n  ${pr.head?.ref} -> ${pr.base?.ref}\n  ${pr.body || ''}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_list_commits',
      description: '[GitHub] List recent commits for a repository.',
      parameters: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, per_page: { type: 'number', description: 'Number of commits (default: 20)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const commits = await c.listCommits(args.owner, args.repo, args.per_page || 20);
        if (!commits.length) return toolOk('No commits found.');
        return toolOk(commits.map((item: any) => `${item.sha?.slice(0, 7)} ${item.commit?.message?.split('\n')[0] || ''} (${item.commit?.author?.name || item.author?.login || 'unknown'})`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_github_list_check_runs',
      description: '[GitHub] List check runs for a commit SHA or branch ref.',
      parameters: { type: 'object', required: ['owner', 'repo', 'ref'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, ref: { type: 'string', description: 'Commit SHA or branch name' }, per_page: { type: 'number', description: 'Number of check runs (default: 30)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const runs = await c.listCheckRuns(args.owner, args.repo, args.ref, args.per_page || 30);
        if (!runs.length) return toolOk('No check runs found.');
        return toolOk(runs.map((run: any) => `${run.name}: ${run.status}/${run.conclusion || 'pending'} (${run.html_url || run.details_url || ''})`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_github_get_file',
      description: '[GitHub] Read a file from a repository path.',
      parameters: { type: 'object', required: ['owner', 'repo', 'path'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, path: { type: 'string', description: 'File path in the repository' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const file = await c.getFileContents(args.owner, args.repo, args.path);
        return toolOk(`sha: ${file.sha}\n\n${file.content}`);
      }),
    });

    api.registerTool({
      name: 'connector_github_search',
      description: '[GitHub] Search GitHub. Use type="repos" to find repos, type="code" to search code, type="issues" for issues.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search query (supports GitHub search syntax, e.g., "language:typescript stars:>100")' }, type: { type: 'string', enum: ['repos', 'code', 'issues'], description: 'What to search (default: repos)' }, per_page: { type: 'number', description: 'Results per page (default: 20)' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const type = args.type || 'repos';
        if (type === 'code') {
          const results = await c.searchCode(args.query, args.per_page || 20);
          return toolOk(results.map((r: any) => `${r.repository?.full_name}/${r.path} (${r.html_url})`).join('\n'));
        }
        if (type === 'issues') {
          const results = await c.searchRepos(args.query + ' type:issue', args.per_page || 20);
          return toolOk(results as any);
        }
        const results = await c.searchRepos(args.query, args.per_page || 20);
        return toolOk(results.map((r: any) => `${r.full_name} — ${r.description || 'no description'} (⭐${r.stargazers_count})`).join('\n'));
      }),
    });
  },
};

export default ext;
