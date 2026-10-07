// First-start onboarding tracking. Guarantees:
//  - a fresh install gets onboarding exactly once, with first start stamped
//  - boots/restarts/reloads never re-trigger or reset it
//  - existing installs (chats, credentials, old account-era record) are grandfathered
//  - skipping the model step persists (no re-prompt loop)
//  - a corrupt onboarding.json does not re-onboard an existing user
//  - the Claude CLI output parser finds the token and the sign-in URL
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-first-start-'));
  const oldData = process.env.PROMETHEUS_DATA_DIR;
  process.env.PROMETHEUS_DATA_DIR = root;
  const file = path.join(root, 'onboarding.json');
  const fresh = { version: '9.9.9', surface: 'electron', detectExisting: () => null };

  try {
    const store = await import('./onboarding-store.js');
    const U = store.LOCAL_ONBOARDING_USER;

    // ── Fresh install ───────────────────────────────────────────────────────
    const first = store.recordBoot(U, fresh);
    assert.equal(first.firstStart?.source, 'fresh');
    assert.equal(first.firstStart?.version, '9.9.9');
    assert.equal(first.firstStart?.surface, 'electron');
    assert.equal(first.boots?.count, 1);
    assert.equal(store.nextStep(first), 'model', 'fresh install starts at model step');
    const firstAt = first.firstStart!.at;

    // ── Restarts never reset or advance ────────────────────────────────────
    for (let i = 0; i < 5; i++) store.recordBoot(U, { ...fresh, version: '9.9.10' });
    let rec = store.getRecord(U, fresh);
    assert.equal(rec.boots?.count, 6);
    assert.equal(rec.boots?.lastVersion, '9.9.10');
    assert.equal(rec.firstStart?.at, firstAt, 'first start is stamped once');
    assert.equal(store.nextStep(rec), 'model', 'boots alone do not change the step');

    // ── Model skip persists; flow goes to tour, not meet ───────────────────
    store.markModelSkipped(U);
    store.recordBoot(U, fresh);
    assert.equal(store.nextStep(store.getRecord(U)), 'tutorial', 'skipped model is not re-prompted');
    store.markTutorialComplete(U, true);
    rec = store.getRecord(U);
    assert.equal(store.nextStep(rec), 'done');
    assert.ok(rec.completedAt, 'completion is stamped');
    store.recordBoot(U, fresh);
    assert.equal(store.nextStep(store.getRecord(U)), 'done', 'restart after completion stays done');

    // ── Full happy path on a clean record ──────────────────────────────────
    store.reset(U);
    store.recordBoot(U, fresh);
    store.markModelConnected(U, 'anthropic', 'claude-sonnet-5-5');
    assert.equal(store.nextStep(store.getRecord(U)), 'meet');
    store.startMeet(U, 's1');
    store.completeMeet(U);
    assert.equal(store.nextStep(store.getRecord(U)), 'memory_confirm');
    store.markMemorySeeded(U);
    assert.equal(store.nextStep(store.getRecord(U)), 'tutorial');
    store.markTutorialComplete(U);
    assert.equal(store.nextStep(store.getRecord(U)), 'done');

    // ── Dismiss stops auto-show for good ───────────────────────────────────
    store.reset(U);
    store.recordBoot(U, fresh);
    store.dismissOnboarding(U);
    store.recordBoot(U, fresh);
    assert.equal(store.nextStep(store.getRecord(U)), 'done');

    // ── Replay re-opens guidance but keeps first start + model ─────────────
    store.reset(U);
    store.recordBoot(U, fresh);
    const stamped = store.getRecord(U).firstStart!.at;
    store.markModelConnected(U, 'openai_codex', 'gpt-5.5');
    store.dismissOnboarding(U);
    store.replayTutorial(U);
    rec = store.getRecord(U);
    assert.equal(store.nextStep(rec), 'meet');
    assert.equal(rec.firstStart?.at, stamped);
    assert.ok(rec.model.firstConnectedAt);

    // ── Existing install is grandfathered (no onboarding on upgrade) ───────
    fs.rmSync(file, { force: true });
    const existing = store.recordBoot(U, { ...fresh, detectExisting: () => 'chat_history:42' });
    assert.equal(existing.firstStart?.source, 'existing_install');
    assert.equal(existing.firstStart?.existingReason, 'chat_history:42');
    assert.equal(store.nextStep(existing), 'done');

    // ── Account-era record migrates to local key ───────────────────────────
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      installId: 'abc',
      users: {
        'uuid-account': {
          firstSeenAt: '2026-06-03T13:27:29.944Z',
          tutorial: { shownAt: 'x', completedAt: '2026-06-03T13:27:40.872Z', version: 1 },
          migration: { completedAt: null, skippedAt: 'x', sourceId: '' },
          model: { firstConnectedAt: '2026-06-03T13:28:07.253Z', provider: 'openai_codex', model: 'gpt-5.5' },
          meetAndGreet: { startedAt: 'x', completedAt: 'x', sessionId: 's', memorySeededAt: null },
        },
      },
    }));
    const migrated = store.recordBoot(U, fresh);
    assert.equal(migrated.firstStart?.existingReason, 'prior_onboarding_record');
    assert.equal(migrated.model.provider, 'openai_codex');
    assert.equal(store.nextStep(migrated), 'done');
    assert.equal(store.getInstallId(), 'abc', 'install id is preserved');

    // ── Corrupt file does not re-onboard an existing install ───────────────
    fs.writeFileSync(file, '{ not json');
    const afterCorrupt = store.recordBoot(U, { ...fresh, detectExisting: () => 'model_credential' });
    assert.equal(store.nextStep(afterCorrupt), 'done');
    assert.ok(fs.readdirSync(root).some((n) => n.startsWith('onboarding.json.corrupt-')), 'corrupt copy kept');

    // ── Existing-install detector ──────────────────────────────────────────
    const { detectExistingInstall } = await import('./existing-install.js');
    const sess = path.join(root, 'sessions');
    fs.mkdirSync(sess, { recursive: true });
    const probe = { sessionsDirs: [sess], legacyOnboardingFiles: [], hasModelCredential: () => false, hasAccountSession: () => false };
    assert.equal(detectExistingInstall(probe), null, 'empty install is fresh');
    for (const n of ['_index.json', 'tool_category_activation_regression.json', 'a.json']) fs.writeFileSync(path.join(sess, n), '{}');
    assert.equal(detectExistingInstall(probe), null, 'index/regression files and 1 chat do not count');
    for (const n of ['b.json', 'c.json']) fs.writeFileSync(path.join(sess, n), '{}');
    assert.equal(detectExistingInstall(probe), 'chat_history:3');
    assert.equal(detectExistingInstall({ ...probe, sessionsDirs: [], hasModelCredential: () => true }), 'model_credential');

    // ── Claude CLI output parsing ──────────────────────────────────────────
    const cli = await import('../../auth/anthropic-cli-connect.js');
    const token = 'sk-ant-oat01-' + 'A'.repeat(60) + '_b-C';
    const painted = `\x1b[2J\x1b[1;1H✓ Long-lived authentication token created successfully!\r\n\x1b[1m${token.slice(0, 40)}\r\n${token.slice(40)}\x1b[22m\r\nStore this token securely.`;
    assert.equal(cli.extractSetupToken(painted), token, 'token is reassembled across wrapped lines');
    assert.equal(cli.extractSetupToken('no token here'), null);
    const urlOut = 'Browser didn\'t open?Use the urlbelowtosignin\x1b[0m https://claude.com/cai/oauth/authorize?code=true&client_id=x&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s \x1b[2mPastecodehereifprompted>';
    assert.equal(cli.extractAuthUrls(urlOut).length, 1);
    assert.equal(cli.needsPastedCode(urlOut), true);

    console.log('first-start onboarding regression passed');
  } finally {
    if (oldData === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = oldData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
