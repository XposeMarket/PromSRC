import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTools } from './tool-builder';
import {
  TOOL_CATEGORY_REPRESENTATIVE_TOOLS,
  verifyToolCategorySurface,
} from './tool-category-provisioning';

const toolBuilderDeps = {
  getMCPManager: () => ({ getAllTools: () => [] }),
  skipDynamicExtensionTools: true,
};

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-tool-category-activation-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const sessionApi = await import('./session');
    const { handleRequestToolCategory } = await import('./tool-category-request');
    const sessionId = 'tool_category_activation_regression';
    const category = 'browser_automation';
    const representative = TOOL_CATEGORY_REPRESENTATIVE_TOOLS[category]?.[0];
    assert.ok(representative, 'browser automation must have a representative tool');

    // This simulates an earlier explicit session activation. The later
    // request_tool_category call is allowed to add a turn scope, but a failed
    // provider rebuild must not erase the older session-level activation.
    sessionApi.activateToolCategory(sessionId, category, { scope: 'session' });
    const stateBeforeRequest = sessionApi.captureToolCategoryActivationState(sessionId, category);
    const requestResult = handleRequestToolCategory(
      { category, scope: 'turn' },
      sessionId,
    );
    assert.equal(requestResult.error, false, 'the real request_tool_category execution must succeed');
    assert.equal(sessionApi.getSession(sessionId).scopedToolCategoryActivations?.some((entry) => entry.category === category), true);

    const activated = sessionApi.getActivatedToolCategories(sessionId);
    const activatedSurface = buildTools(toolBuilderDeps, activated);
    const providerMissingRepresentative = activatedSurface.filter(
      (tool: any) => tool?.function?.name !== representative,
    );
    const failed = verifyToolCategorySurface(category, providerMissingRepresentative, {
      unboundedTools: activatedSurface,
    });
    assert.equal(failed.ok, false, 'provider removal must fail provisioning closed');

    // This is the same rollback boundary used by the chat route after the
    // actual request_tool_category tool has mutated session state.
    sessionApi.restoreToolCategoryActivationState(sessionId, stateBeforeRequest);
    const restoredSession = sessionApi.getSession(sessionId);
    assert.deepEqual(restoredSession.activatedToolCategories, [category], 'failed provisioning must preserve the prior session activation');
    assert.equal(
      restoredSession.scopedToolCategoryActivations?.some((entry) => entry.category === category),
      false,
      'failed provisioning must remove only the temporary turn activation',
    );

    // A healthy same-turn rebuild keeps the activation and exposes the
    // callable category before activation evidence is considered complete.
    const successfulRequest = handleRequestToolCategory(
      { category, scope: 'turn' },
      sessionId,
    );
    assert.equal(successfulRequest.error, false);
    const successfulSurface = buildTools(toolBuilderDeps, sessionApi.getActivatedToolCategories(sessionId));
    const successful = verifyToolCategorySurface(category, successfulSurface, {
      unboundedTools: successfulSurface,
    });
    assert.equal(successful.ok, true, 'same-turn provider rebuild must expose the activated representative');
    assert.equal(sessionApi.getActivatedToolCategories(sessionId).has(category), true);

    // Automatic keyword activation has a second verification after the
    // provider cap/filter is applied. A failed final verification must restore
    // the exact pre-activation state and rebuild without advertising the
    // category. This mirrors the initial Chat route provisioning boundary.
    const automaticSessionId = 'tool_category_automatic_activation_regression';
    const automaticStateBefore = sessionApi.captureToolCategoryActivationState(automaticSessionId, category);
    sessionApi.activateToolCategory(automaticSessionId, category, { scope: 'turn' });
    const automaticSurface = buildTools(toolBuilderDeps, sessionApi.getActivatedToolCategories(automaticSessionId));
    const automaticProviderMissingRepresentative = automaticSurface.filter(
      (tool: any) => tool?.function?.name !== representative,
    );
    const automaticVerification = verifyToolCategorySurface(category, automaticProviderMissingRepresentative, {
      unboundedTools: automaticSurface,
      requestFilterActive: true,
    });
    assert.equal(automaticVerification.ok, false, 'the final capped provider surface must fail automatic provisioning');
    let automaticProvisioningRolledBack = false;
    if (!automaticVerification.ok) {
      sessionApi.restoreToolCategoryActivationState(automaticSessionId, automaticStateBefore);
      automaticProvisioningRolledBack = true;
    }
    assert.equal(automaticProvisioningRolledBack, true);
    assert.equal(
      sessionApi.getActivatedToolCategories(automaticSessionId).has(category),
      false,
      'failed automatic provisioning must not leave the category active',
    );
    const rebuiltAfterAutomaticRollback = buildTools(
      toolBuilderDeps,
      sessionApi.getActivatedToolCategories(automaticSessionId),
    );
    assert.equal(
      verifyToolCategorySurface(category, rebuiltAfterAutomaticRollback, {
        unboundedTools: rebuiltAfterAutomaticRollback,
      }).ok,
      false,
      'the rebuild after automatic rollback must no longer advertise the failed category',
    );

    console.log('tool category activation regression passed');
  } finally {
    try {
      const sessionApi = await import('./session');
      await sessionApi.flushPendingChatAuditWrites();
      await sessionApi.flushPendingSessionWrites();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
