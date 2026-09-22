import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── Mobile restart-spanning turn: the final answer must survive the merge ────
//
// Repro of the observed defect: after `gateway_restart` inside a turn, the
// session record holds
//
//   [user prompt] → [restart_checkpoint] → [restart_checkpoint] → [final answer]
//
// The drawer preview reads the session record directly and showed the real
// answer, but opening the thread showed only the pre-restart tool stream.
//
// Cause: `_mergeMobileAssistantTurnDetails` only replaces existing target text
// when the incoming text *extends* it (`sourceText.startsWith(targetText)`).
// Restart checkpoint rows carry no `_clientRequestId`, so a checkpoint banner
// can occupy the target first; the post-restart answer does not textually
// extend that banner, so the answer was silently discarded.
//
// These assertions pin the source so the checkpoint-supersede branch cannot be
// removed without failing.

const pagesPath = path.join(__dirname, '..', '..', 'web-ui', 'src', 'mobile', 'mobile-pages.js');
const source = readFileSync(pagesPath, 'utf8');

// Guard 1: the supersede predicate exists and is derived from both sides.
assert.ok(
  source.includes('const targetIsRestartCheckpoint = _isMobileGatewayRestartCheckpointMessage(target);'),
  'merge must classify whether the target row is a restart checkpoint',
);
assert.ok(
  source.includes('const sourceIsRestartCheckpoint = _isMobileGatewayRestartCheckpointMessage(source);'),
  'merge must classify whether the incoming row is a restart checkpoint',
);
assert.ok(
  source.includes('const sourceSupersedesCheckpoint = targetIsRestartCheckpoint && !sourceIsRestartCheckpoint;'),
  'a non-checkpoint source must be allowed to supersede checkpoint target text',
);

// Guard 2: the predicate is actually wired into the text-adoption condition.
// Without this the branch would compute a value nobody reads.
const adoptionIdx = source.indexOf('|| sourceSupersedesCheckpoint)');
assert.ok(adoptionIdx > 0, 'sourceSupersedesCheckpoint must gate the copy-text adoption branch');
const extendsIdx = source.indexOf('|| sourceExtendsTarget');
assert.ok(
  extendsIdx > 0 && extendsIdx < adoptionIdx,
  'the supersede clause must sit alongside the existing sourceExtendsTarget clause',
);

// Guard 3: `preserveTargetText` still wins. Callers use it to protect a
// locally-authored row; restart recovery must not override that contract.
const conditionStart = source.lastIndexOf('if (!preserveTargetText && (!targetText', adoptionIdx);
assert.ok(
  conditionStart > 0 && conditionStart < adoptionIdx,
  'the adoption branch must remain guarded by !preserveTargetText',
);

// Guard 4: the helper used by the predicate must be defined before use,
// since mobile-pages.js is evaluated top-to-bottom as a classic script.
const helperIdx = source.indexOf('function _isMobileGatewayRestartCheckpointMessage');
assert.ok(helperIdx > 0, '_isMobileGatewayRestartCheckpointMessage must exist');
assert.ok(
  helperIdx < conditionStart,
  '_isMobileGatewayRestartCheckpointMessage must be declared before the merge uses it',
);

// ── Behavioural check against the real defect shape ──────────────────────────
// Faithful port of the adoption rule, exercised with the exact row shapes taken
// from a real restart-spanning session record.
function adoptsText(target: any, source_: any, preserveTargetText = false): boolean {
  const targetText = String(target.content || '').replace(/\s+/g, ' ').trim();
  const sourceText = String(source_.content || '').replace(/\s+/g, ' ').trim();
  const sourceExtendsTarget = !!targetText
    && !!sourceText
    && sourceText.length > targetText.length
    && sourceText.startsWith(targetText);
  const isCheckpoint = (m: any) => String(m.messageKind || '') === 'restart_checkpoint'
    || /Hot restart checkpoint/i.test(String(m.content || ''));
  const sourceSupersedesCheckpoint = isCheckpoint(target) && !isCheckpoint(source_);
  return !preserveTargetText
    && (!targetText || sourceExtendsTarget || sourceSupersedesCheckpoint)
    && !!sourceText;
}

const checkpointRow = {
  role: 'assistant',
  messageKind: 'restart_checkpoint',
  _clientRequestId: '',
  content: '[Hot restart checkpoint: planned by this chat]\nGateway restart successful. Prometheus is back online.',
};
const finalAnswerRow = {
  role: 'assistant',
  messageKind: '',
  _clientRequestId: 'mobile_session_abc_v0rchgum',
  content: 'Done. Everything you asked for landed, and the restart itself just served as a live test of the fix.',
};

// The answer does not extend the checkpoint banner — this is the exact
// condition that used to drop it.
assert.equal(
  finalAnswerRow.content.startsWith(checkpointRow.content),
  false,
  'precondition: the final answer must not textually extend the checkpoint banner',
);
assert.equal(
  adoptsText(checkpointRow, finalAnswerRow),
  true,
  'the post-restart final answer must replace checkpoint banner text',
);

// A checkpoint must never overwrite a real answer (the reverse direction).
assert.equal(
  adoptsText(finalAnswerRow, checkpointRow),
  false,
  'a restart checkpoint must never overwrite a real answer',
);

// preserveTargetText still wins.
assert.equal(
  adoptsText(checkpointRow, finalAnswerRow, true),
  false,
  'preserveTargetText must still suppress adoption',
);

// Ordinary streaming growth is unchanged.
assert.equal(
  adoptsText({ content: 'Partial ans' }, { content: 'Partial answer complete.' }),
  true,
  'normal streaming extension must still adopt the longer text',
);
assert.equal(
  adoptsText({ content: 'A finished answer.' }, { content: 'Unrelated shorter text.' }),
  false,
  'unrelated non-extending text must still be rejected for ordinary rows',
);

console.log('mobile-restart-answer-merge regression: ok');
