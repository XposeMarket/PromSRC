import assert from 'node:assert/strict';
import { resolveAgentBrowserProfileSetting, SHARED_SUBAGENT_BROWSER_PROFILE } from './browser-tools';

const meta = (sessionId: string, ownerType: any, ownerId: string) => ({
  sessionId,
  ownerType,
  ownerId,
  workspacePath: '',
  label: '',
  taskPrompt: '',
  spawnerSessionId: '',
  createdAt: 0,
  updatedAt: 0,
}) as any;

const subagentChat = meta('subagent_chat_radar_x', 'background', 'radar_x');
const background = meta('background_bg_1', 'background', 'bg_1');

// Default: subagents share the main Prometheus in-house profile (same logins as main chat).
assert.equal(SHARED_SUBAGENT_BROWSER_PROFILE, 'main');
assert.equal(resolveAgentBrowserProfileSetting(subagentChat, { agents: [] }), 'main');
assert.equal(resolveAgentBrowserProfileSetting(background, {}), 'main');

// Global override.
assert.equal(resolveAgentBrowserProfileSetting(background, { subagent_browser_profile: 'isolated' }), 'isolated');
assert.equal(resolveAgentBrowserProfileSetting(background, { subagent_browser_profile: 'Work Profile' }), 'work-profile');

// Per-agent override wins over the global setting.
const cfg = { subagent_browser_profile: 'isolated', agents: [{ id: 'radar_x', browser_profile: 'main' }] };
assert.equal(resolveAgentBrowserProfileSetting(subagentChat, cfg), 'main');
const cfg2 = { agents: [{ id: 'radar_x', browserProfile: 'own' }] };
assert.equal(resolveAgentBrowserProfileSetting(subagentChat, cfg2), 'isolated');

console.log('subagent-browser-profile regression: ok');
process.exit(0);
