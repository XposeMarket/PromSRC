import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captureTurnRouteSnapshot } from './turn-route-snapshot';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const route = read('src/gateway/chat/chat-model-route.ts');
const session = read('src/gateway/session.ts');
const router = read('src/gateway/routes/chat.router.ts');

assert.match(session, /chatModelRoute\?: ChatModelRoute/);
assert.match(session, /export function setChatModelRoute/);
assert.match(session, /export function clearChatModelRoute/);
assert.match(route, /mode: 'explicit' \| 'inherited'/);
assert.match(route, /ChatModelRouteUnavailableError/);
assert.match(router, /captureChatTurnRouteSnapshot\(sessionId\)/);
assert.match(router, /\/api\/sessions\/:id\/model-route/);
assert.doesNotMatch(route, /pinnedAt|setSessionPinned/);

const config = {
  llm: {
    provider: 'openai',
    providers: {
      openai: { model: 'gpt-5.6-terra', defaultAccountId: 'terra', accounts: { terra: {} }, context_window: 128000 },
      openai_codex: { model: 'gpt-5.6-sol', defaultAccountId: 'sol', accounts: { sol: {} }, context_window: 272000 },
    },
  },
  agent_model_default_reasoning: { main_chat: 'high' },
};
const fakeFactory = () => ({}) as any;
const inherited = captureTurnRouteSnapshot({ config, providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high' }, { buildProvider: fakeFactory });
const explicit = captureTurnRouteSnapshot({ config, providerId: 'openai_codex', model: 'gpt-5.6-sol', reasoningEffort: 'medium', accountId: 'sol' }, { buildProvider: fakeFactory });

// Explicit routes are independent of a later global Main Chat selection.
config.llm.provider = 'openai_codex';
config.agent_model_default_reasoning.main_chat = 'medium';
assert.deepEqual([inherited.providerId, inherited.model, inherited.reasoningEffort], ['openai', 'gpt-5.6-terra', 'high']);
assert.deepEqual([explicit.providerId, explicit.model, explicit.reasoningEffort, explicit.accountId], ['openai_codex', 'gpt-5.6-sol', 'medium', 'sol']);
assert.notEqual(inherited.provider, explicit.provider);

// A sticky route update during an active turn cannot mutate an already captured client.
const activeBeforeChange = explicit.provider;
const nextTurn = captureTurnRouteSnapshot({ config, providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high', accountId: 'terra' }, { buildProvider: fakeFactory });
assert.equal(explicit.provider, activeBeforeChange);
assert.equal(nextTurn.model, 'gpt-5.6-terra');

console.log('chat model route lifecycle/concurrency regression passed');
