import assert from 'node:assert/strict';
import {
  buildConnectorWrapperDefinition,
  connectorWrapperName,
  resolveConnectorWrapperCall,
  type ConnectorWrapperSpec,
} from '../extensions/runtime-registry';
import { searchToolCatalog, type ToolCatalogEntry } from './tool-search';

const spec: ConnectorWrapperSpec = {
  wrapper: connectorWrapperName('github'),
  connectorId: 'github',
  connectorName: 'GitHub',
  actions: {
    list_prs: {
      tool: 'connector_github_list_prs',
      description: 'List pull requests for a repository. Extra text.',
      parameters: { type: 'object', required: ['owner', 'repo'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } } },
    },
    create_pr: {
      tool: 'connector_github_create_pr',
      description: 'Open a pull request.',
      parameters: { type: 'object', required: ['owner', 'repo', 'title', 'head', 'base'], properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' } } },
    },
  },
};

assert.equal(spec.wrapper, 'connector_github');
const def = buildConnectorWrapperDefinition(spec);
assert.equal(def.function.name, 'connector_github');
assert.deepEqual(def.function.parameters.required, ['action']);
assert.deepEqual(def.function.parameters.properties.action.enum, ['list_prs', 'create_pr']);
assert.ok(def.function.description.includes('list_prs(owner, repo, state?)'));
assert.ok(def.function.parameters.properties.title, 'union of action properties keeps typed args');

const ok = resolveConnectorWrapperCall(spec, { action: 'list_prs', owner: 'a', repo: 'b' });
assert.equal(ok.name, 'connector_github_list_prs', 'resolves to the direct tool so approval rules match the real name');
assert.equal(ok.args.action, undefined);
assert.equal(ok.error, undefined);

const missing = resolveConnectorWrapperCall(spec, { action: 'create_pr', owner: 'a', repo: 'b' });
assert.ok(missing.error?.includes('title, head, base'));
const unknown = resolveConnectorWrapperCall(spec, { action: 'nope' });
assert.ok(unknown.error?.includes('Available: list_prs(owner, repo, state?)'));
assert.ok(resolveConnectorWrapperCall(spec, {}).error?.includes('requires action'));

const catalog: ToolCatalogEntry[] = [
  { name: 'connector_github_list_prs', source: 'connector', group: 'github', description: 'List pull requests', parameters: {} },
  { name: 'connector_gmail_list_emails', source: 'connector', group: 'gmail', description: 'List recent emails in the inbox', parameters: {} },
  { name: 'mcp__notion__search', source: 'mcp', group: 'mcp:notion', description: 'Search pages', parameters: {} },
];
assert.equal(searchToolCatalog('github pull requests', 3, catalog)[0].name, 'connector_github_list_prs');
assert.equal(searchToolCatalog('gmail inbox', 3, catalog)[0].name, 'connector_gmail_list_emails');
assert.equal(searchToolCatalog('notion', 3, catalog)[0].name, 'mcp__notion__search');
assert.equal(searchToolCatalog('zzz', 3, catalog).length, 0);

console.log('connector wrapper + tool search regression passed');
