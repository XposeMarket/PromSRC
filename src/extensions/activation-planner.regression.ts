import assert from 'node:assert/strict';
import { planMessageExtensionActivation } from './activation-planner.js';

function connector(params: {
  id: string;
  name: string;
  tools: string[];
  capabilities?: string[];
  aliases?: string[];
}) {
  return {
    id: params.id,
    manifest: {
      id: params.id,
      kind: 'connector',
      name: params.name,
      tags: [params.id],
      activation: { aliases: params.aliases || [] },
      ownership: { tools: params.tools, capabilities: params.capabilities || [] },
    },
    contracts: {
      tools: params.tools,
      capabilities: params.capabilities || [],
      connectors: [params.id],
    },
  } as any;
}

const github = connector({
  id: 'github',
  name: 'GitHub',
  tools: [
    'connector_github_list_prs',
    'connector_github_merge_pr',
    'connector_github_list_commits',
  ],
  capabilities: ['repositories', 'pull_requests', 'issues'],
  aliases: ['git', 'pull request', 'pr', 'commit', 'push', 'merge'],
});
const vercel = connector({
  id: 'vercel',
  name: 'Vercel',
  tools: [
    'connector_vercel_list_deployments',
    'connector_vercel_redeploy',
    'connector_vercel_env',
  ],
  capabilities: ['deployments', 'hosting', 'projects', 'environment'],
  aliases: ['deploy', 'deployment', 'preview', 'environment', 'env', 'project', 'projects'],
});
const futurePlugin = connector({
  id: 'future_crm',
  name: 'Future CRM',
  tools: ['connector_future_crm_list_pipelines', 'connector_future_crm_update_pipeline'],
  capabilities: ['pipelines', 'contacts'],
});

function fakeRegistry(connectedIds: string[]) {
  const connected = new Set(connectedIds);
  const extensions = [github, vercel, futurePlugin];
  return {
    listExtensions: () => extensions,
    getConnector: (id: string) => ({ isConnected: () => connected.has(id) }),
  };
}

const githubPlan = planMessageExtensionActivation({
  message: 'Review the open PRs, inspect the commits, and merge the fix.',
  registry: fakeRegistry(['github']),
});
assert.deepEqual(githubPlan.categories, ['external_apps']);
assert.equal(githubPlan.entries.some((entry) => entry.extensionId === 'github'), true);

const githubPushPlan = planMessageExtensionActivation({
  message: 'Push the latest commit to the repository.',
  registry: fakeRegistry(['github']),
});
assert.deepEqual(githubPushPlan.categories, ['external_apps']);

const disconnectedGitHubPlan = planMessageExtensionActivation({
  message: 'Look into my GitHub connector tools.',
  registry: fakeRegistry([]),
});
assert.deepEqual(disconnectedGitHubPlan.categories, []);
assert.deepEqual(disconnectedGitHubPlan.blockedExtensionIds, ['github']);

const setupPlan = planMessageExtensionActivation({
  message: 'Connect GitHub with OAuth.',
  registry: fakeRegistry([]),
});
assert.deepEqual(setupPlan.categories, ['integration_admin']);
assert.equal(setupPlan.entries.some((entry) => entry.extensionId === 'github' && entry.category === 'external_apps'), false);

const vercelPlan = planMessageExtensionActivation({
  message: 'Look at my Vercel deployments and preview projects.',
  registry: fakeRegistry(['vercel']),
});
assert.deepEqual(vercelPlan.categories, ['external_apps']);
assert.equal(vercelPlan.entries.some((entry) => entry.extensionId === 'vercel'), true);

const disconnectedVercelPlan = planMessageExtensionActivation({
  message: 'Deploy this to Vercel.',
  registry: fakeRegistry([]),
});
assert.deepEqual(disconnectedVercelPlan.categories, []);
assert.deepEqual(disconnectedVercelPlan.blockedExtensionIds, ['vercel']);

const futurePluginPlan = planMessageExtensionActivation({
  message: 'Review the pipeline and update the deployment record.',
  registry: fakeRegistry(['future_crm']),
});
assert.deepEqual(futurePluginPlan.categories, ['external_apps']);
assert.equal(futurePluginPlan.entries.some((entry) => entry.extensionId === 'future_crm'), true);

const meaningPlan = planMessageExtensionActivation({
  message: 'What is GitHub?',
  registry: fakeRegistry(['github']),
});
assert.deepEqual(meaningPlan.categories, []);

const suppressedPlan = planMessageExtensionActivation({
  message: 'Do not call any tools; review my PR and summarize the risk.',
  registry: fakeRegistry(['github']),
});
assert.deepEqual(suppressedPlan.categories, [], 'explicit no-tool instructions must suppress connector activation');
assert.deepEqual(suppressedPlan.entries, [], 'explicit no-tool instructions must not expose connector entries');

console.log('[activation-planner.regression] connected-only provider activation, domain triggers, setup routing, future-plugin metadata, and meaning-question suppression passed');
