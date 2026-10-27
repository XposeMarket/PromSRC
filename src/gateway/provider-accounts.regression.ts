import assert from 'node:assert/strict';
import { planRemoveProviderAccount, planUpdateProviderAccount } from './provider-accounts.js';
// @ts-ignore -- browser ES module shared by desktop + mobile Settings
import { buildAccountGroups, roleLabel } from '../../web-ui/src/settings/provider-accounts-list.js';

function sample() {
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
  assert.equal(plan.nextConfigPatch.llm.providers.anthropic.defaultAccountId, 'a2');
  assert.equal(plan.nextConfigPatch.llm.accountId, 'a2');
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

// Remove last account: no default left.
{
  const cfg = sample();
  delete cfg.llm.providers.openai.accounts;
  cfg.llm.providers.openai.accounts = { o1: { id: 'o1', label: 'API' } };
  const plan = planRemoveProviderAccount(cfg, 'openai', 'o1');
  assert.equal(plan.ok, true);
  assert.equal(plan.nextDefaultAccountId, null);
  assert.equal('defaultAccountId' in plan.nextConfigPatch.llm.providers.openai, false);
  assert.deepEqual(plan.nextConfigPatch.llm.providers.openai.accounts, {});
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
  assert.equal(ok.nextConfigPatch.llm.providers.anthropic.accounts.a1.label, 'Renamed');
  assert.equal(planUpdateProviderAccount(cfg, 'anthropic', 'missing', { label: 'x' }).ok, false);
}

// Update: makeDefault sets defaultAccountId and llm.accountId when active.
{
  const cfg = sample();
  const plan = planUpdateProviderAccount(cfg, 'anthropic', 'a2', { makeDefault: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.nextConfigPatch.llm.providers.anthropic.defaultAccountId, 'a2');
  assert.equal(plan.nextConfigPatch.llm.accountId, 'a2');

  const inactive = planUpdateProviderAccount(cfg, 'openai', 'o1', { makeDefault: true });
  assert.equal(inactive.ok, true);
  assert.equal(inactive.nextConfigPatch.llm.accountId, 'a1');
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
  assert.equal(roleLabel('subagent-planner'), 'Planner');
  assert.equal(roleLabel('main_chat'), 'Main chat');
}

console.log('provider-accounts regression: ok');