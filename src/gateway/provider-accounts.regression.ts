import assert from 'node:assert/strict';
import { dropRemovedAccounts, planRemoveProviderAccount, planUpdateProviderAccount } from './provider-accounts.js';
import { resolveToolCapabilityMetadata } from './tool-capabilities.js';

// provider_accounts agent tool: list is read-only, remove is approval-gated.
const cap = (args: Record<string, any>) => resolveToolCapabilityMetadata('provider_accounts', undefined, args);
assert.equal(cap({ action: 'list' }).readOnly, true);
assert.equal(cap({ action: 'remove' }).destructive, true);
assert.equal(cap({ action: 'remove', dry_run: true }).readOnly, true);
assert.equal(cap({ action: 'rename' }).localWrite, true);
// @ts-ignore -- browser ES module shared by desktop + mobile Settings
import { buildAccountGroups, roleLabel } from '../../web-ui/src/settings/provider-accounts-list.js';

function sample(): any {
  return {
    llm: {
      provider: 'anthropic',
      accountId: 'a1',
      providers: {
        anthropic: {
          defaultAccountId: 'a1',
          accounts: {
            a1: { id: 'a1', label: 'Main', authType: 'setup_token', status: 'connected' },
            a2: { id: 'a2', label: 'Work', authType: 'setup_token', status: 'connected' },
          },
        },
        openai: {
          defaultAccountId: 'o1',
          accounts: { o1: { id: 'o1', label: 'API', authType: 'api_key', status: 'connected' } },
        },
      },
    },
    agent_model_defaults: { planner: 'anthropic/claude-sonnet-5', builder: 'anthropic/claude-haiku-5-5', reviewer: 'openai/gpt-5.6-sol' },
    agent_model_default_accounts: { planner: 'a1', builder: 'a2', reviewer: 'a1' },
  };
}

// Remove default account: next default reassigned, active llm.accountId follows.
{
  const cfg = sample();
  const plan = planRemoveProviderAccount(cfg, 'anthropic', 'a1');
  assert.equal(plan.ok, true);
  assert.equal(plan.nextDefaultAccountId, 'a2');
  assert.equal(plan.nextConfigPatch?.llm.providers.anthropic.defaultAccountId, 'a2');
  assert.equal(plan.nextConfigPatch?.llm.accountId, 'a2');
  assert.equal(plan.nextConfigPatch.llm.providers.anthropic.accounts.a1, undefined);
}

// Remove non-default account: default unchanged.
{
  const plan = planRemoveProviderAccount(sample(), 'anthropic', 'a2');
  assert.equal(plan.ok, true);
  assert.equal(plan.nextConfigPatch.llm.providers.anthropic.defaultAccountId, 'a1');
  assert.equal(plan.nextConfigPatch.llm.accountId, 'a1');
  assert.equal(plan.nextDefaultAccountId, 'a1');
}

// Removing the only account is refused: an empty accounts map falls back to
// legacy single-account mode, which would resurrect a connected "default".
{
  const cfg = sample();
  const plan = planRemoveProviderAccount(cfg, 'openai', 'o1');
  assert.equal(plan.ok, false);
  assert.match(String(plan.error), /only openai account/i);
  assert.equal(plan.nextConfigPatch.llm, null);
}

// Removing on a provider that is not the live chat provider never moves llm.accountId.
{
  const cfg = sample();
  cfg.llm.providers.openai.accounts.o2 = { id: 'o2', label: 'Second', authType: 'api_key', status: 'connected' };
  const plan = planRemoveProviderAccount(cfg, 'openai', 'o1');
  assert.equal(plan.ok, true);
  assert.equal(plan.nextConfigPatch.llm.accountId, 'a1');
  assert.equal(plan.nextConfigPatch.llm.providers.openai.defaultAccountId, 'o2');
  assert.deepEqual(Object.keys(plan.nextConfigPatch.llm.providers.openai.accounts), ['o2']);
  // An openai role pointing at o1 is cleared; an anthropic role also named o1 would not be.
  assert.deepEqual(plan.affectedRoles, []);
}

// affectedRoles: only roles on this provider that pointed at this account.
{
  const plan = planRemoveProviderAccount(sample(), 'anthropic', 'a1');
  assert.deepEqual(plan.affectedRoles, ['planner']);
  assert.deepEqual(plan.nextConfigPatch.agent_model_default_accounts, { builder: 'a2', reviewer: 'a1' });
}

// Other providers/accounts are deep-equal to input.
{
  const cfg = sample();
  const plan = planRemoveProviderAccount(cfg, 'anthropic', 'a1');
  assert.deepEqual(plan.nextConfigPatch.llm.providers.openai, cfg.llm.providers.openai);
  assert.deepEqual(plan.nextConfigPatch.llm.providers.anthropic.accounts.a2, cfg.llm.providers.anthropic.accounts.a2);
}

// Failure cases.
{
  const cfg = sample();
  assert.equal(planRemoveProviderAccount(cfg, 'anthropic', 'nope').ok, false);
  assert.equal(planRemoveProviderAccount(cfg, 'ollama', 'a1').ok, false);
  assert.equal(planRemoveProviderAccount(cfg, 'anthropic', '').ok, false);
  assert.equal(planRemoveProviderAccount(cfg, 'anthropic', '   ').ok, false);
}

// Input is never mutated.
{
  const cfg = sample();
  const snapshot = JSON.parse(JSON.stringify(cfg));
  planRemoveProviderAccount(cfg, 'anthropic', 'a1');
  planUpdateProviderAccount(cfg, 'anthropic', 'a2', { label: 'Renamed', makeDefault: true });
  assert.deepEqual(cfg, snapshot);
}

// Update: label validation.
{
  const cfg = sample();
  assert.equal(planUpdateProviderAccount(cfg, 'anthropic', 'a1', { label: '   ' }).ok, false);
  assert.equal(planUpdateProviderAccount(cfg, 'anthropic', 'a1', { label: 'x'.repeat(65) }).ok, false);
  const ok = planUpdateProviderAccount(cfg, 'anthropic', 'a1', { label: '  Renamed  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.nextConfigPatch?.llm.providers.anthropic.accounts.a1.label, 'Renamed');
  assert.equal(planUpdateProviderAccount(cfg, 'anthropic', 'missing', { label: 'x' }).ok, false);
}

// Update: makeDefault sets defaultAccountId and llm.accountId when active.
{
  const cfg = sample();
  const plan = planUpdateProviderAccount(cfg, 'anthropic', 'a2', { makeDefault: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.nextConfigPatch?.llm.providers.anthropic.defaultAccountId, 'a2');
  assert.equal(plan.nextConfigPatch?.llm.accountId, 'a2');

  const inactive = planUpdateProviderAccount(cfg, 'openai', 'o1', { makeDefault: true });
  assert.equal(inactive.ok, true);
  assert.equal(inactive.nextConfigPatch?.llm.accountId, 'a1');
}

// Shared Settings UI view model: groups follow configured accounts, the
// default is marked, and unconfigured providers are offered under "Add".
{
  const normalize = (_providerId: string, cfg: any) => Object.entries(cfg?.accounts || {}).map(([id, acc]: [string, any]) => ({ id, ...acc }));
  const cfg = sample();
  cfg.llm.providers.anthropic.accounts.a2.status = 'disconnected';
  const view = buildAccountGroups(cfg.llm, normalize);
  assert.deepEqual(view.groups.map((g: any) => g.providerId), ['anthropic', 'openai']);
  assert.deepEqual(view.addable, ['openai_codex', 'xai']);
  const anthropic = view.groups[0];
  assert.deepEqual(anthropic.accounts.map((a: any) => [a.id, a.isDefault, a.connected, a.authLabel]), [
    ['a1', true, true, 'Setup token'],
    ['a2', false, false, 'Setup token'],
  ]);
  // Active provider with no configured accounts still gets a group (to add one).
  const empty = buildAccountGroups({ provider: 'xai', providers: {} }, normalize);
  assert.deepEqual(empty.groups.map((g: any) => g.providerId), ['xai']);
  assert.equal(empty.addable.includes('xai'), false);
  // Locally added (unsaved) rows are flagged as drafts; saved ones are not.
  const draftCfg = sample();
  draftCfg.llm.providers.anthropic.accounts.anthropic_new = { id: 'anthropic_new', label: 'New Claude account', authType: 'setup_token', status: 'disconnected' };
  const drafted = buildAccountGroups(draftCfg.llm, normalize, { anthropic: ['a1', 'a2'], openai: ['o1'] });
  assert.deepEqual(drafted.groups[0].accounts.map((a: any) => [a.id, a.draft]), [['a1', false], ['a2', false], ['anthropic_new', true]]);
  assert.equal(buildAccountGroups(draftCfg.llm, normalize).groups[0].accounts.some((a: any) => a.draft), false);
  assert.equal(roleLabel('subagent-planner'), 'Planner');
  assert.equal(roleLabel('main_chat'), 'Main chat');
}

// Remove records a tombstone; a stale full Save cannot write the account back.
{
  const plan = planRemoveProviderAccount(sample(), 'anthropic', 'a2');
  assert.deepEqual(plan.nextConfigPatch.llm.providers.anthropic.removed_account_ids, ['a2']);
  const stale = sample().llm; // surface loaded before the removal still has a2
  const merged = dropRemovedAccounts(stale, plan.nextConfigPatch.llm);
  assert.deepEqual(Object.keys(merged.providers.anthropic.accounts), ['a1']);
  assert.deepEqual(merged.providers.anthropic.removed_account_ids, ['a2']);
  assert.deepEqual(Object.keys(stale.providers.anthropic.accounts), ['a1', 'a2'], 'input not mutated');
  // Stale default/live account pointing at the removed id moves to a survivor.
  const staleOnA2 = sample().llm;
  staleOnA2.accountId = 'a2';
  staleOnA2.providers.anthropic.defaultAccountId = 'a2';
  const fixed = dropRemovedAccounts(staleOnA2, plan.nextConfigPatch.llm);
  assert.equal(fixed.providers.anthropic.defaultAccountId, 'a1');
  assert.equal(fixed.accountId, 'a1');
  // Never empties a provider: that would resurrect legacy single-account mode.
  const onlyRemoved = sample().llm;
  onlyRemoved.providers.anthropic.accounts = { a2: { id: 'a2', label: 'Work' } };
  assert.deepEqual(Object.keys(dropRemovedAccounts(onlyRemoved, plan.nextConfigPatch.llm).providers.anthropic.accounts), ['a2']);
  // No tombstones: untouched.
  assert.deepEqual(Object.keys(dropRemovedAccounts(sample().llm, sample().llm).providers.anthropic.accounts), ['a1', 'a2']);
}

// Removing a legacy "default" account also drops the provider-level key it was
// backed by (factory.ts falls back to it) and, for Codex, the unscoped token.
{
  const cfg = sample();
  cfg.llm.providers.openai = {
    api_key: 'vault:llm.openai.api_key',
    defaultAccountId: 'default',
    accounts: { default: { id: 'default', label: 'OpenAI API account' }, o2: { id: 'o2', label: 'Second' } },
  };
  const plan = planRemoveProviderAccount(cfg, 'openai', 'default');
  assert.equal(plan.ok, true);
  assert.equal(plan.nextConfigPatch.llm.providers.openai.api_key, undefined);
  assert.deepEqual(plan.legacyCredentials, { providerApiKey: true, unscopedOAuth: false });
  assert.equal(cfg.llm.providers.openai.api_key, 'vault:llm.openai.api_key', 'input not mutated');
  const codex = sample();
  codex.llm.providers.openai_codex = { defaultAccountId: 'default', accounts: { default: { id: 'default' }, c2: { id: 'c2' } } };
  assert.deepEqual(planRemoveProviderAccount(codex, 'openai_codex', 'default').legacyCredentials, { providerApiKey: false, unscopedOAuth: true });
  // Named accounts never touch legacy credentials.
  assert.deepEqual(planRemoveProviderAccount(sample(), 'anthropic', 'a2').legacyCredentials, { providerApiKey: false, unscopedOAuth: false });
}

console.log('provider-accounts regression: ok');