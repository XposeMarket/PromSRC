/**
 * Regression: final-action approval used to be optional at the interaction
 * handler. Omitting final_action_approval_id clicked "Post"/"Buy" directly
 * (audit 2026-10-14, B-H2). And a narrowed agent could spawn a worker with the
 * full main-chat tool surface (subagent privilege expansion).
 */
import assert from 'node:assert/strict';
import { enforceFinalActionGate, somLabelFromSourceNote, buildUiActionIntent } from './final-action-gate';
import { grantFinalActionApproval } from './final-action-approvals.js';
import {
  DENY_ALL_TOOLS,
  getSessionToolCeiling,
  intersectToolCeiling,
  recordSessionToolCeiling,
  clearSessionToolCeiling,
} from './agents-runtime/tool-ceiling';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
}

const base = { sessionId: 's1', toolName: 'browser_click', surface: 'browser' as const, mode: 'enforce' as const };

check('omitted approval on a Post button fails closed', () => {
  const r = enforceFinalActionGate({ ...base, args: { ref: 12 }, intent: 'button "Post"' });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.actionKind, 'final_submit');
    assert.match(r.message, /request_final_action_approval/);
  }
});

check('purchase, delete and send targets are blocked without a grant', () => {
  for (const intent of ['button "Place order"', 'button "Delete account"', 'button "Send"', 'button "Buy now"']) {
    assert.equal(enforceFinalActionGate({ ...base, args: {}, intent }).ok, false, intent);
  }
});

check('ordinary navigation is allowed', () => {
  for (const intent of ['button "Continue"', 'link "Docs"', 'tab "Settings"', 'link "Bank of America"', '']) {
    assert.equal(enforceFinalActionGate({ ...base, args: {}, intent }).ok, true, intent || '(empty)');
  }
});

check('captcha is a hand-off, not an approvable action', () => {
  const r = enforceFinalActionGate({ ...base, args: {}, intent: 'checkbox "I\'m not a robot" recaptcha' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /Hand this step to the user/);
});

check('a valid one-shot grant allows the exact call once', () => {
  grantFinalActionApproval('s1', 'fa-gate-1', {
    actionKind: 'post',
    targetLabel: 'Post',
    summary: 'Post the drafted reply',
    nextToolName: 'browser_click',
    nextToolArgs: { ref: 12 },
    expiresAt: Date.now() + 60_000,
  } as any);
  const first = enforceFinalActionGate({ ...base, args: { ref: 12, final_action_approval_id: 'fa-gate-1' }, intent: 'button "Post"' });
  assert.deepEqual(first, { ok: true, approved: true });
  const replay = enforceFinalActionGate({ ...base, args: { ref: 12, final_action_approval_id: 'fa-gate-1' }, intent: 'button "Post"' });
  assert.equal(replay.ok, false);
});

check('a grant cannot be retargeted to another element', () => {
  grantFinalActionApproval('s1', 'fa-gate-2', {
    actionKind: 'post', targetLabel: 'Post', summary: 'x',
    nextToolName: 'browser_click', nextToolArgs: { ref: 12 }, expiresAt: Date.now() + 60_000,
  } as any);
  const r = enforceFinalActionGate({ ...base, args: { ref: 99, final_action_approval_id: 'fa-gate-2' }, intent: 'button "Buy"' });
  assert.equal(r.ok, false);
});

check('owner off switch disables classification but not grant validation', () => {
  assert.equal(enforceFinalActionGate({ ...base, mode: 'off', args: {}, intent: 'button "Post"' }).ok, true);
  assert.equal(enforceFinalActionGate({ ...base, mode: 'off', args: { final_action_approval_id: 'bogus' }, intent: '' }).ok, false);
});

check('desktop SOM labels are extracted from runtime source notes only', () => {
  assert.equal(somLabelFromSourceNote('[SOM #4 button "Send" -> virtual (10, 20)]'), 'button "Send"');
  assert.equal(somLabelFromSourceNote('[window Gmail - Send (1, 2) -> virtual (3, 4)]'), '');
  const r = enforceFinalActionGate({ ...base, toolName: 'desktop_click', surface: 'desktop', args: {}, intent: somLabelFromSourceNote('[SOM #4 button "Send" -> virtual (10, 20)]') });
  assert.equal(r.ok, false);
  assert.equal(buildUiActionIntent([null, ' a ', '', 'b']), 'a | b');
});

check('worker ceiling: unrestricted parent keeps child request', () => {
  assert.equal(intersectToolCeiling(undefined, undefined), undefined);
  assert.deepEqual(intersectToolCeiling(['web_search'], undefined), ['web_search']);
});

check('worker ceiling: restricted parent caps an unrestricted child', () => {
  assert.deepEqual(intersectToolCeiling(undefined, ['web_search', 'web_fetch']), ['web_search', 'web_fetch']);
});

check('worker ceiling: intersection honours wildcards and never widens', () => {
  const r = intersectToolCeiling(['browser_click', 'workspace_run'], ['browser_*']);
  assert.deepEqual(r, ['browser_click']);
  assert.deepEqual(intersectToolCeiling(['workspace_run'], ['web_search']), [DENY_ALL_TOOLS]);
});

check('worker ceiling is recorded per session and propagates', () => {
  recordSessionToolCeiling('parent-1', ['web_search']);
  assert.deepEqual(getSessionToolCeiling('parent-1'), ['web_search']);
  recordSessionToolCeiling('parent-2', []);
  assert.equal(getSessionToolCeiling('parent-2'), undefined);
  clearSessionToolCeiling('parent-1');
  assert.equal(getSessionToolCeiling('parent-1'), undefined);
});

console.log(`final-action-gate regression: ${passed} passed`);
