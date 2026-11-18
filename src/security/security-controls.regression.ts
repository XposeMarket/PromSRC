/**
 * Security controls that SECURITY.md claims but no other regression pinned:
 *  - one-shot final-action grants (bound to session, tool and arguments; single use; expire)
 *  - public-distribution builds hide self-development tools
 *  - secret scrubbing of tool logs
 * Run: npm run test:security-controls
 */
import assert from 'node:assert/strict';
import {
  consumeFinalActionApproval,
  createFinalActionApprovalScope,
  grantFinalActionApproval,
} from '../gateway/final-action-approvals';
import {
  filterPublicBuildToolDefs,
  isPublicDistributionBuild,
  isToolCategoryHiddenInPublicBuild,
  isToolHiddenInPublicBuild,
} from '../runtime/distribution';
import { scrubSecrets } from './vault';
import { sanitizeToolLog } from './log-scrubber';

// ── Final-action grants ──────────────────────────────────────────────────────
{
  const scope = createFinalActionApprovalScope({
    actionKind: 'post',
    targetLabel: 'Post',
    summary: 'Post the drafted reply',
    nextToolName: 'browser_click',
    nextToolArgs: { ref: '@12' },
  });
  grantFinalActionApproval('session-a', 'fa-1', scope);

  // No id -> refused.
  assert.equal(consumeFinalActionApproval({ sessionId: 'session-a', toolName: 'browser_click', toolArgs: { ref: '@12' } }).ok, false);
  // Unknown id -> refused.
  assert.equal(consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'nope', toolName: 'browser_click', toolArgs: { ref: '@12' } }).ok, false);
  // Another session cannot use it.
  const otherSession = consumeFinalActionApproval({ sessionId: 'session-b', approvalId: 'fa-1', toolName: 'browser_click', toolArgs: { ref: '@12' } });
  assert.equal(otherSession.ok, false);
  assert.match(!otherSession.ok ? otherSession.message : '', /different session/);
  // Wrong tool -> refused.
  assert.equal(consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-1', toolName: 'desktop_click', toolArgs: { ref: '@12' } }).ok, false);
  // Changed target -> refused.
  const retargeted = consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-1', toolName: 'browser_click', toolArgs: { ref: '@13' } });
  assert.equal(retargeted.ok, false);
  assert.match(!retargeted.ok ? retargeted.message : '', /does not match/);
  // Exact call -> allowed once.
  assert.equal(consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-1', toolName: 'browser_click', toolArgs: { ref: '@12', final_action_approval_id: 'fa-1' } }).ok, true);
  // Replay of the same grant -> refused.
  const replay = consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-1', toolName: 'browser_click', toolArgs: { ref: '@12' } });
  assert.equal(replay.ok, false);
  assert.match(!replay.ok ? replay.message : '', /already used/);

  // Expired grant -> refused.
  const expired = { ...createFinalActionApprovalScope({ actionKind: 'purchase', nextToolName: 'browser_click' }), ttlMs: undefined, expiresAt: Date.now() - 1 };
  grantFinalActionApproval('session-a', 'fa-2', expired);
  const late = consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-2', toolName: 'browser_click', toolArgs: {} });
  assert.equal(late.ok, false);
  assert.match(!late.ok ? late.message : '', /expired/);

  // Unknown action kinds collapse to 'other'; TTL is clamped to at most an hour.
  const odd = createFinalActionApprovalScope({ actionKind: 'launch-missiles', ttlMs: 10 * 24 * 3600 * 1000 });
  assert.equal(odd.actionKind, 'other');
  assert.ok((odd.ttlMs || 0) <= 60 * 60 * 1000);
  // Pending scopes carry no expiry; a slow human answer must not pre-expire the grant.
  assert.equal(odd.expiresAt, undefined);

  // Regression (OUTSIDE TikTok, 2026-11-10): the card was answered >10 min after it was
  // requested, and the approved Post click was rejected as expired. The clock now starts at grant.
  const realNow = Date.now;
  try {
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    const slow = createFinalActionApprovalScope({ actionKind: 'post', nextToolName: 'browser_click', nextToolArgs: { ref: '@7' } });
    fakeNow += 45 * 60 * 1000; // human answers 45 min later
    grantFinalActionApproval('session-a', 'fa-slow', slow);
    fakeNow += 60 * 1000; // agent clicks a minute after approval
    assert.equal(consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-slow', toolName: 'browser_click', toolArgs: { ref: '@7' } }).ok, true);

    // But the post-approval window is still enforced.
    const stale = createFinalActionApprovalScope({ actionKind: 'post', nextToolName: 'browser_click' });
    grantFinalActionApproval('session-a', 'fa-stale', stale);
    fakeNow += 11 * 60 * 1000;
    const staleUse = consumeFinalActionApproval({ sessionId: 'session-a', approvalId: 'fa-stale', toolName: 'browser_click', toolArgs: {} });
    assert.equal(staleUse.ok, false);
    assert.match(!staleUse.ok ? staleUse.message : '', /expired/);
  } finally {
    Date.now = realNow;
  }
}

// ── Public distribution build ────────────────────────────────────────────────
{
  const prev = process.env.PROMETHEUS_PUBLIC_BUILD;
  try {
    process.env.PROMETHEUS_PUBLIC_BUILD = '1';
    assert.equal(isPublicDistributionBuild(), true);
    for (const name of ['dev_source_edit', 'read_source', 'self_update', 'prom_repo_push']) {
      assert.equal(isToolHiddenInPublicBuild(name), true, `${name} must be hidden in public builds`);
    }
    assert.equal(isToolCategoryHiddenInPublicBuild('prometheus_source_write') || isToolCategoryHiddenInPublicBuild('source_write'), true);
    const filtered = filterPublicBuildToolDefs([
      { function: { name: 'web_fetch' } },
      { function: { name: 'dev_source_edit' } },
    ]);
    assert.deepEqual(filtered.map((t) => t.function?.name), ['web_fetch']);
    // Ordinary tools stay visible.
    assert.equal(isToolHiddenInPublicBuild('web_fetch'), false);

    process.env.PROMETHEUS_PUBLIC_BUILD = '0';
    // The repo package is not a public build, so self-dev tools are not filtered by this predicate.
    assert.equal(isToolHiddenInPublicBuild('dev_source_edit'), false);
  } finally {
    if (prev === undefined) delete process.env.PROMETHEUS_PUBLIC_BUILD; else process.env.PROMETHEUS_PUBLIC_BUILD = prev;
  }
}

// ── Secret scrubbing ─────────────────────────────────────────────────────────
{
  const canaries = [
    'sk-ant-api03-' + 'A'.repeat(40),
    'ghp_' + 'B'.repeat(36),
    'sk-proj-' + 'C'.repeat(40),
    'github_pat_' + 'E'.repeat(50),
    'xai-' + 'F'.repeat(40),
    'AIza' + 'G'.repeat(35),
  ];
  for (const canary of canaries) {
    const out = sanitizeToolLog('run_command', { stdout: `token is ${canary}` });
    assert.ok(!out.includes(canary), `canary leaked through sanitizeToolLog: ${canary.slice(0, 8)}…`);
  }
  const assigned = scrubSecrets('ANTHROPIC_API_KEY=sk-ant-api03-' + 'D'.repeat(40));
  assert.ok(!assigned.includes('D'.repeat(40)), 'assigned key leaked');
  assert.match(assigned, /REDACTED/);
  // Ordinary text survives.
  assert.equal(scrubSecrets('build passed in 12s'), 'build passed in 12s');
}

console.log('security controls regression: final-action grants, public-build filter and secret scrubbing ok');
