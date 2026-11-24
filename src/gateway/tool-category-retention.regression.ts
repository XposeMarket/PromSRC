import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findFileDir(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return dir;
    if (entry.isDirectory()) {
      const found = findFileDir(full, name);
      if (found) return found;
    }
  }
  return null;
}

// Warm tool-category retention: a category in use stays loaded between turns on
// every provider, and is unloaded only at a cold start once it has gone unused.
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-warm-tool-categories-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  try {
    const api = await import('./session');
    const retention = await import('./tool-category-retention');
    const { getConfig } = require('../config/config');
    const cfg = getConfig().getConfig() as any;
    const HOUR = 60 * 60_000;
    const has = (id: string, category: string) => api.getActivatedToolCategories(id).has(category);
    /** One user turn. `cold` puts the previous model activity past the prompt-cache lifetime. */
    const userTurn = (id: string, cold: boolean) => {
      const session = api.getSession(id);
      const last = cold ? Date.now() - HOUR : Date.now();
      session.lastAssistantAt = last;
      session.lastActiveAt = last;
      api.addMessage(id, { role: 'user', content: 'next', timestamp: Date.now() } as any, { disableAutoSave: true } as any);
    };

    for (const providerId of ['anthropic', 'openai']) {
      const id = `warm_retention_${providerId}`;
      const session = api.getSession(id);
      session.chatModelRoute = { version: 1, providerId, model: 'test-model', updatedAt: 0 };
      userTurn(id, true); // turn 1
      api.activateToolCategory(id, 'workspace_write', { scope: 'turn' });
      api.noteToolCategoryUse(id, 'workspace_write');
      assert.ok(has(id, 'workspace_write'), `${providerId}: active in the turn that requested it`);

      userTurn(id, false); // turn 2, cache warm: the turn scope has expired
      assert.equal((session.scopedToolCategoryActivations || []).some((entry) => entry.category === 'workspace_write' && entry.expiresAfterTurn >= 2), false);
      assert.ok(has(id, 'workspace_write'), `${providerId}: a used category survives its turn scope`);

      userTurn(id, true); // turn 3, cold, 2 idle turns: still inside the grace period
      assert.ok(has(id, 'workspace_write'), `${providerId}: kept for ${retention.WARM_CATEGORY_KEEP_TURNS} unused turns even when cold`);

      userTurn(id, false); // turn 4, 3 idle turns but the cache is warm
      assert.ok(has(id, 'workspace_write'), `${providerId}: never unloaded while the prompt cache is warm`);

      userTurn(id, true); // turn 5, stale and cold
      assert.equal(has(id, 'workspace_write'), false, `${providerId}: unloaded at the first cold start once stale`);

      // Using it again restarts the clock.
      api.activateToolCategory(id, 'workspace_write', { scope: 'turn' });
      api.noteToolCategoryUse(id, 'workspace_write');
      userTurn(id, true);
      userTurn(id, true);
      api.noteToolCategoryUse(id, 'workspace_write');
      userTurn(id, true);
      userTurn(id, true);
      assert.ok(has(id, 'workspace_write'), `${providerId}: each call refreshes the grace period`);
    }

    // Requested but never called: gone at the next cold start.
    const unused = 'warm_retention_unused';
    userTurn(unused, true);
    api.activateToolCategory(unused, 'browser_automation', { scope: 'turn' });
    userTurn(unused, false);
    assert.ok(has(unused, 'browser_automation'), 'an unused category is still not dropped while the cache is warm');
    userTurn(unused, true);
    assert.equal(has(unused, 'browser_automation'), false, 'an unused category does not get the grace period');

    // Connector/MCP surfaces and source access are never kept implicitly.
    const never = 'warm_retention_never';
    userTurn(never, true);
    for (const category of ['external_apps', 'mcp_server_tools', 'prometheus_source_read', 'prometheus_source_write']) {
      api.activateToolCategory(never, category, { scope: 'turn' });
      api.noteToolCategoryUse(never, category);
    }
    assert.ok(has(never, 'external_apps'));
    userTurn(never, false);
    for (const category of ['external_apps', 'mcp_server_tools', 'prometheus_source_read', 'prometheus_source_write']) {
      assert.equal(has(never, category), false, `${category} expires with its scope`);
    }

    // A tool call never loads a category, and never creates a session.
    api.noteToolCategoryUse(never, 'desktop_automation');
    assert.equal(has(never, 'desktop_automation'), false, 'use of an unloaded category does not load it');
    api.noteToolCategoryUse('warm_retention_missing_session', 'workspace_write');
    assert.equal(fs.existsSync(path.join(root, 'sessions', 'warm_retention_missing_session.json')), false);

    // A workflow-pack tool keeps the automations superset warm.
    const packs = 'warm_retention_packs';
    userTurn(packs, true);
    api.activateToolCategory(packs, 'automations', { scope: 'turn' });
    api.noteToolCategoryUse(packs, 'automation_scheduling');
    userTurn(packs, true);
    userTurn(packs, true);
    assert.ok(has(packs, 'automations'), 'a pack tool call counts as use of the automations category');

    // Explicit removal, reset and failed provisioning still win.
    const control = 'warm_retention_control';
    userTurn(control, true);
    api.activateToolCategory(control, 'workspace_write', { scope: 'turn' });
    api.noteToolCategoryUse(control, 'workspace_write');
    api.deactivateToolCategory(control, 'workspace_write');
    assert.equal(has(control, 'workspace_write'), false, 'explicit removal wins');
    api.activateToolCategory(control, 'browser_automation', { scope: 'turn' });
    api.setActivatedToolCategories(control, []);
    assert.equal(api.getActivatedToolCategories(control).size, 0, 'reset clears warm state');
    const before = api.captureToolCategoryActivationState(control, 'browser_automation');
    api.activateToolCategory(control, 'browser_automation', { scope: 'turn' });
    api.restoreToolCategoryActivationState(control, before);
    assert.equal(has(control, 'browser_automation'), false, 'failed provisioning rolls back warm state');

    // Most-recently-used cap, and stable model-facing order.
    const cap = 'warm_retention_cap';
    userTurn(cap, true);
    const many = ['workspace_write', 'browser_automation', 'desktop_automation', 'agents_and_teams', 'advanced_memory', 'media_assets', 'media_generation', 'runtime_admin'];
    for (const category of many) { api.activateToolCategory(cap, category, { scope: 'turn' }); api.noteToolCategoryUse(cap, category); }
    userTurn(cap, false);
    for (const category of many.slice(1)) api.noteToolCategoryUse(cap, category);
    assert.deepEqual([...api.getActivatedToolCategories(cap)], many, 'warm categories keep the order they were first loaded in');
    api.activateToolCategory(cap, 'skills', { scope: 'turn' });
    const capped = [...api.getActivatedToolCategories(cap)];
    assert.equal(capped.includes('workspace_write'), false, 'the least recently used category is evicted at the cap');
    assert.deepEqual(capped, [...many.slice(1), 'skills'], 'a new category appends after the kept ones');
    assert.equal(capped.length, retention.WARM_CATEGORY_LIMIT);

    // Review finding: a failed ninth activation must not cost a working category.
    const full = [...api.getActivatedToolCategories(cap)];
    const failed = api.captureToolCategoryActivationState(cap, 'model_management');
    api.activateToolCategory(cap, 'model_management', { scope: 'turn' });
    assert.equal(api.getActivatedToolCategories(cap).has(full[0]), false, 'the ninth activation evicts the least recently used');
    api.restoreToolCategoryActivationState(cap, failed);
    assert.deepEqual([...api.getActivatedToolCategories(cap)], full, 'rollback restores the evicted category and the order');

    // Review finding: an expired scope is not "loaded", so a late tool call cannot bring a category back.
    const late = 'warm_retention_late_call';
    userTurn(late, true);
    api.activateToolCategory(late, 'browser_automation', { scope: 'turn' });
    userTurn(late, true); // never called: the warm entry is pruned, the expired scope entry is still stored
    api.noteToolCategoryUse(late, 'browser_automation');
    assert.equal(has(late, 'browser_automation'), false, 'a tool call after unload does not resurrect the category');
    assert.equal((api.getSession(late).warmToolCategories || []).length, 0);

    // Sessions saved by the previous build (Anthropic-only string list) keep their tools.
    const legacyId = 'warm_retention_legacy';
    await api.flushPendingSessionWrites();
    const sessionDir = findFileDir(root, `${cap}.json`);
    assert.ok(sessionDir, 'the regression must find where sessions are stored');
    fs.writeFileSync(path.join(sessionDir!, `${legacyId}.json`), JSON.stringify({ id: legacyId, history: [], userTurnCounter: 7, anthropicCachedToolCategories: ['workspace_write', 'file_ops', 'external_apps'] }));
    const legacy = api.getSession(legacyId);
    assert.equal(legacy.userTurnCounter, 7, 'the legacy session file was loaded');
    assert.deepEqual(legacy.warmToolCategories, [{ category: 'workspace_write', lastUsedTurn: 7, used: true }], 'legacy list is read once, deduplicated, without connector surfaces');
    assert.equal((legacy as any).anthropicCachedToolCategories, undefined);

    // New main chats start with the file tools and lose them if they go unused.
    const fresh = 'warm_retention_fresh';
    userTurn(fresh, true);
    api.seedDefaultWarmToolCategories(fresh);
    assert.ok(has(fresh, 'workspace_write'), 'new chat starts with the file tools');
    api.seedDefaultWarmToolCategories(fresh);
    assert.equal(api.getSession(fresh).warmToolCategories?.length, 1, 'seeding is idempotent');
    userTurn(fresh, true); userTurn(fresh, true);
    assert.ok(has(fresh, 'workspace_write'), 'still loaded for the first three turns');
    userTurn(fresh, true);
    assert.equal(has(fresh, 'workspace_write'), false, 'a chat that never uses them unloads them');
    api.seedDefaultWarmToolCategories(fresh);
    assert.equal(has(fresh, 'workspace_write'), false, 'seeding only applies to the first turn');

    // The existing Anthropic opt-out still restores plain scope expiry.
    const optOut = 'warm_retention_opt_out';
    api.getSession(optOut).chatModelRoute = { version: 1, providerId: 'anthropic', model: 'test-model', updatedAt: 0 };
    getConfig().updateConfig({ llm: { ...cfg.llm, providers: { ...cfg.llm.providers, anthropic: { ...cfg.llm.providers.anthropic, sticky_tool_categories: false } } } } as any);
    userTurn(optOut, true);
    api.activateToolCategory(optOut, 'workspace_write', { scope: 'turn' });
    api.noteToolCategoryUse(optOut, 'workspace_write');
    assert.ok(has(optOut, 'workspace_write'));
    userTurn(optOut, false);
    assert.equal(has(optOut, 'workspace_write'), false, 'config opt-out restores expiry');

    // Pure helpers.
    assert.equal(retention.isPromptCacheCold(undefined), true);
    assert.equal(retention.isPromptCacheCold(Date.now() - 1000), false);
    assert.equal(retention.isPromptCacheCold(Date.now() - retention.PROMPT_CACHE_COLD_MS - 1000), true);
    const list = [{ category: 'a', lastUsedTurn: 1, used: true }];
    assert.equal(retention.pruneWarmToolCategories(list, 9, false), list, 'warm cache returns the same list');
    assert.equal(retention.touchWarmToolCategory(list, 'a', 1, true), list, 'no-op touch returns the same list');

    // Extraction contract: malformed persisted scopes, alias dedupe, and expiry boundaries.
    const state = await import('./session-tool-categories');
    assert.equal(state.normalizeToolCategoryActivationScope('unknown'), 'session');
    assert.deepEqual(state.normalizeScopedToolCategoryActivations(null), []);
    const scoped = state.normalizeScopedToolCategoryActivations([
      { category: 'file_ops', scope: 'turn', activatedAtTurn: 4, expiresAfterTurn: 3, activatedAt: 1 },
      { category: 'workspace_write', scope: 'turn', activatedAtTurn: 9, activatedAt: 2 },
      { category: 'browser', scope: 'ttl', turns: -2, activatedAt: 3 },
      { category: 'skills', scope: 'session' },
    ], 5);
    assert.deepEqual(scoped, [
      { category: 'workspace_write', scope: 'turn', activatedAtTurn: 4, expiresAfterTurn: 4, turns: undefined, activatedAt: 1 },
      { category: 'browser_automation', scope: 'ttl', activatedAtTurn: 5, expiresAfterTurn: 5, turns: 1, activatedAt: 3 },
    ]);
    const scopedState = { scopedToolCategoryActivations: scoped };
    assert.equal(state.pruneScopedToolCategoryActivations(scopedState, 5), true);
    assert.equal(state.pruneScopedToolCategoryActivations(scopedState, 5), false);
    assert.deepEqual(scopedState.scopedToolCategoryActivations, [scoped[1]]);
    assert.deepEqual(state.loadWarmToolCategories({ warmToolCategories: [], anthropicCachedToolCategories: ['skills'] }), [], 'explicit warm state wins over legacy data');
    assert.equal(state.refreshLoadedWarmToolCategories(list, [], 'a', 1), list, 'no-op refresh preserves identity');
    const newer = { category: 'skills', lastUsedTurn: 9, used: true };
    const restored = state.restoreWarmToolCategories([newer, { category: 'business', lastUsedTurn: 9, used: true }], {
      category: 'business', persistent: false, scoped: [], warm: [list[0], { ...newer, lastUsedTurn: 2 }],
    }, 'business');
    assert.deepEqual(restored, [list[0], newer], 'rollback restores evicted entries and retains newer surviving state');
    assert.equal(restored[1], newer);
    console.log('warm tool category retention and extracted session-state regression passed');
  } finally {
    try {
      const api = await import('./session');
      await api.flushPendingChatAuditWrites();
      await api.flushPendingSessionWrites();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
