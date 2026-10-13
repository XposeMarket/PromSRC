import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-anthropic-tool-cache-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  try {
    const api = await import('./session');
    const { getConfig } = require('../config/config');
    const cfg = getConfig().getConfig() as any;
    const session = api.getSession('anthropic_cache_regression');
    session.chatModelRoute = { version: 1, providerId: 'anthropic', model: 'claude-opus-5-5', updatedAt: 0 };
    api.activateToolCategory(session.id, 'workspace_write', { scope: 'turn' });
    assert.ok(api.getActivatedToolCategories(session.id).has('workspace_write'));
    // Simulate the normal pruning boundary without depending on a turn clock.
    session.scopedToolCategoryActivations = [];
    assert.ok(api.getActivatedToolCategories(session.id).has('workspace_write'), 'warmed category survives expiry');
    assert.deepEqual(session.anthropicCachedToolCategories, ['workspace_write']);
    api.deactivateToolCategory(session.id, 'workspace_write');
    assert.equal(api.getActivatedToolCategories(session.id).has('workspace_write'), false, 'explicit removal wins');
    api.activateToolCategory(session.id, 'browser_automation', { scope: 'turn' });
    api.getActivatedToolCategories(session.id);
    api.setActivatedToolCategories(session.id, []);
    assert.equal(api.getActivatedToolCategories(session.id).size, 0, 'reset clears warm state');
    api.activateToolCategory(session.id, 'workspace_write', { scope: 'turn' });
    const before = api.captureToolCategoryActivationState(session.id, 'browser_automation');
    api.activateToolCategory(session.id, 'browser_automation', { scope: 'turn' });
    api.getActivatedToolCategories(session.id);
    api.restoreToolCategoryActivationState(session.id, before);
    assert.equal(api.getActivatedToolCategories(session.id).has('browser_automation'), false, 'failed provisioning rolls back warm state');
    session.chatModelRoute.providerId = 'openai';
    session.scopedToolCategoryActivations = [];
    assert.equal(api.getActivatedToolCategories(session.id).has('workspace_write'), false, 'other providers preserve expiry');
    assert.deepEqual(session.anthropicCachedToolCategories, []);
    session.chatModelRoute.providerId = 'anthropic';
    getConfig().updateConfig({ llm: { ...cfg.llm, providers: { ...cfg.llm.providers, anthropic: { ...cfg.llm.providers.anthropic, sticky_tool_categories: false } } } } as any);
    api.activateToolCategory(session.id, 'workspace_write', { scope: 'turn' });
    api.getActivatedToolCategories(session.id);
    session.scopedToolCategoryActivations = [];
    assert.equal(api.getActivatedToolCategories(session.id).has('workspace_write'), false, 'config opt-out restores expiry');
    console.log('Anthropic session tool cache regression passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
