import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captureTurnRouteSnapshot } from './turn-route-snapshot';

function routeConfig(provider: string, model: string, reasoning: string, accountId?: string, contextWindow = 128000): any {
  return {
    llm: {
      provider,
      ...(accountId ? { accountId } : {}),
      providers: {
        openai: { model: 'gpt-5.6-terra', defaultAccountId: 'terra-account', context_window: contextWindow, accounts: { 'terra-account': {} } },
        openai_codex: { model: 'gpt-5.6-sol', defaultAccountId: 'sol-account', context_window: 272000, accounts: { 'sol-account': {} } },
        other: { model: 'gpt-5.6-sol', accounts: { 'other-account': {} }, context_window: 64000 },
      },
    },
    agent_model_default_reasoning: { main_chat: reasoning },
  };
}

const calls: Array<{ providerId: string; accountId?: string; client: object }> = [];
const fakeFactory = (llm: any): any => {
  const client = { id: `client-${calls.length + 1}` };
  calls.push({ providerId: llm.provider, accountId: llm.accountId, client });
  return client;
};
const snapshot = (config: any, providerId?: string, model?: string) => captureTurnRouteSnapshot(
  { config, providerId, model, reasoningEffort: config.agent_model_default_reasoning.main_chat },
  { buildProvider: fakeFactory },
);

// 1. Deferred Terra/high turn survives a global Main Chat change; next turn sees Sol.
let durable = routeConfig('openai', 'gpt-5.6-terra', 'high');
const terraTurn = snapshot(durable);
const ordinaryRounds = [terraTurn, terraTurn];
const compactorRoutes = [terraTurn];
durable = routeConfig('openai_codex', 'gpt-5.6-sol', 'medium');
ordinaryRounds.push(terraTurn);
compactorRoutes.push(terraTurn);
assert.deepEqual(ordinaryRounds.map((item) => [item.providerId, item.model, item.reasoningEffort]), [
  ['openai', 'gpt-5.6-terra', 'high'],
  ['openai', 'gpt-5.6-terra', 'high'],
  ['openai', 'gpt-5.6-terra', 'high'],
]);
assert.equal(compactorRoutes[1].provider, terraTurn.provider);
const nextTurn = snapshot(durable);
assert.deepEqual([nextTurn.providerId, nextTurn.model, nextTurn.reasoningEffort], ['openai_codex', 'gpt-5.6-sol', 'medium']);

// 2. A provider/account change cannot carry the old account into the running route.
assert.equal(terraTurn.accountId, 'terra-account');
assert.equal(nextTurn.accountId, 'sol-account');
const noDefaultTarget = snapshot(routeConfig('openai', 'gpt-5.6-terra', 'high', 'terra-account'), 'other', 'gpt-5.6-sol');
assert.equal(noDefaultTarget.accountId, undefined);

// 3. Reasoning-only change during a retry does not alter the admitted effort.
durable.agent_model_default_reasoning.main_chat = 'low';
assert.equal(terraTurn.reasoningEffort, 'high');
assert.equal(terraTurn.provider, ordinaryRounds[0].provider);

// 4. Concurrent sessions have independently instantiated client snapshots.
const sessionA = snapshot(routeConfig('openai', 'gpt-5.6-terra', 'high'));
const sessionB = snapshot(routeConfig('openai_codex', 'gpt-5.6-sol', 'medium'));
assert.notEqual(sessionA.provider, sessionB.provider);
assert.deepEqual([sessionA.model, sessionB.model], ['gpt-5.6-terra', 'gpt-5.6-sol']);

// 5. switch_model uses a distinct turn-owned route and does not mutate durable Main Chat.
const mainBeforeSwitch = routeConfig('openai', 'gpt-5.6-terra', 'high');
const activeTurn = snapshot(mainBeforeSwitch);
const switchRoute = snapshot(mainBeforeSwitch, 'openai_codex', 'gpt-5.6-sol');
mainBeforeSwitch.llm.provider = 'openai';
mainBeforeSwitch.llm.providers.openai.model = 'gpt-5.6-terra';
mainBeforeSwitch.agent_model_default_reasoning.main_chat = 'low';
assert.deepEqual([activeTurn.providerId, activeTurn.model, activeTurn.reasoningEffort], ['openai', 'gpt-5.6-terra', 'high']);
assert.deepEqual([switchRoute.providerId, switchRoute.model], ['openai_codex', 'gpt-5.6-sol']);
assert.equal(switchRoute.provider, switchRoute.provider); // retry/continuation reuses this exact client.

// 6. Context profile/budget are frozen with the route, including compaction inputs.
assert.equal(terraTurn.contextProfile.contextWindowTokens, 128000);
assert.equal(terraTurn.contextBudget.contextWindowTokens, 128000);
assert.equal(nextTurn.contextProfile.contextWindowTokens, 272000);
assert.ok(Object.isFrozen(terraTurn.contextProfile));

// Router integration contract: all active interactive routes flow into ordinary
// calls and mid-workflow compaction as an explicit provider/client snapshot.
const router = fs.readFileSync(path.resolve(__dirname, '../routes/chat.router.ts'), 'utf8');
assert.match(router, /captureChatTurnRouteSnapshot\(sessionId\)/);
assert.match(router, /provider: input\.routeSnapshot\?\.provider/);
assert.match(router, /routeSnapshot: activeGenerationRouteSnapshot/);
assert.match(router, /provider: generationOverride\.provider/);
assert.match(router, /turnRouteSnapshot,/);

console.log(`turn-route snapshot regression passed (${calls.length} deterministic snapshots)`);
