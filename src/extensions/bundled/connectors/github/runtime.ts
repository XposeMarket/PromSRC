// Native GitHub connector runtime. See §23B. Auth stays in GitHubConnector.
import type { GitHubConnector } from '../../../../integrations/connectors/github.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

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
];

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
        const result = await c.mergePullRequest(args.owner, args.repo, Number(args.pr_number), {
          mergeMethod: args.merge_method || 'merge',
          commitTitle: args.commit_title,
          commitMessage: args.commit_message,
        });
        if (!result.merged) return toolError(`Pull request was not merged: ${result.message || 'GitHub rejected the merge.'}`);
        return toolOk(`Pull request merged: ${result.sha || 'success'}`);
      }),
    });


    api.registerTool({
      name: 'connector_github_get_pr',
      description: '[GitHub] Get a single pull request by number.',
      parameters: { type: 'object', required: ['owner', 'repo', 'pr_number'], properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, pr_number: { type: 'number', description: 'Pull request number' } } },
      connectorId: ID, capability: 'code-hosting',
      execute: (args: any) => withConn(async (c) => {
        const pr = await c.getPR(args.owner, args.repo, Number(args.pr_number));
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
