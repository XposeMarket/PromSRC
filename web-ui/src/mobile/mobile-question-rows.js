// Pure helpers for assistant rows that carry an ask_prometheus_questions
// request on mobile.
//
// The composer question popover owns the visible question card. The chat row
// only has to keep the tool stream, the pre-tool preamble and the work timer
// visible so the user can see what the question is about. A row that carries
// nothing but the question is a compatibility placeholder and stays hidden.

const rowText = (row) => String(row?.body?.text || row?.content || '').trim();
const hasEntries = (value) => Array.isArray(value) && value.length > 0;
const isChatSteerUser = (row) => row?.role === 'user'
  && String(row.workflowPart || '') === 'interruption'
  && /^chat_steer_/i.test(String(row.workflowGroupId || ''));

export function isPendingMobileQuestion(question) {
  return !!question && typeof question === 'object'
    && String(question.status || 'pending').toLowerCase() === 'pending';
}

/** A row whose only content is a question: nothing to show besides the card. */
export function isMobileQuestionOnlyRow(row) {
  return !!row && row.role === 'ai' && !!row.questionRequest
    && row.streaming !== true
    && !hasEntries(row.liveTraceEntries)
    && !hasEntries(row.processEntries)
    && !rowText(row)
    && !row.approvalRequest;
}

const questionIds = (question) => ({
  qid: String(question?.id || question?.questionId || '').trim(),
  qcid: String(question?.clientRequestId || '').trim(),
});

/**
 * One assistant row judged as a host for a question: 'stop' (a completed turn
 * boundary), 'skip' (not this request's live row), or 'accept'. Shared by the
 * finder and the explicit-host check so both always agree.
 */
function classifyQuestionHostCandidate(row, { qid, qcid }) {
  if (row._pmFinalReceived === true || row._pmServerAuthoredFinal === true || row._pmAbortAcknowledged === true) return 'stop';
  if (row._steerFrozenTrace === true || String(row.workflowPart || '') === 'before_interruption') return 'skip';
  const otherQuestion = String(row.questionRequest?.id || '').trim();
  if (otherQuestion && otherQuestion !== qid) return 'skip';
  const own = String(row._clientRequestId || '').trim();
  if (qcid && own && qcid !== own) return 'skip';
  return row.streaming === true || hasEntries(row.liveTraceEntries) || hasEntries(row.processEntries) ? 'accept' : 'skip';
}

/**
 * The live row of the current request that should carry `question`: the
 * newest assistant row after the last real user row that is streaming or has
 * trace/process entries. Never an older turn, never a completed row.
 */
export function findMobileQuestionHostRow(thread, question = null, { exclude = null } = {}) {
  const list = Array.isArray(thread) ? thread : [];
  const ids = questionIds(question);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (!row || row === exclude) continue;
    if (row.role === 'user') {
      if (isChatSteerUser(row)) continue;
      return null;
    }
    if (row.role !== 'ai') continue;
    const verdict = classifyQuestionHostCandidate(row, ids);
    if (verdict === 'stop') return null;
    if (verdict === 'accept') return row;
  }
  return null;
}

/**
 * An explicit host (recovery passes its live row) must sit in the current
 * turn: no real user row and no completed assistant row may follow it.
 * Computed ONCE per fold pass (review round 2: no per-placeholder rescans).
 */
function explicitHostInCurrentTurn(thread, host) {
  const index = thread.indexOf(host);
  if (index < 0) return false;
  for (let i = index + 1; i < thread.length; i += 1) {
    const item = thread[i];
    if (item?.role === 'user' && !isChatSteerUser(item)) return false;
    if (item?.role === 'ai' && (item._pmFinalReceived === true || item._pmServerAuthoredFinal === true
      || item._pmAbortAcknowledged === true)) return false;
  }
  return true;
}

/**
 * Move pending question-only rows of the current request onto that request's
 * live row (or onto `host` when given and eligible) and drop the placeholder.
 * An ineligible explicit host leaves the placeholder untouched. Returns the
 * number of placeholder rows folded. Linear in the thread length.
 */
export function foldMobileQuestionOnlyRows(thread, host = null) {
  if (!Array.isArray(thread)) return 0;
  const hostUsable = !!host && host.role === 'ai' && explicitHostInCurrentTurn(thread, host);
  if (host && !hostUsable) return 0;
  let folded = 0;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const row = thread[i];
    if (row?.role === 'user' && !isChatSteerUser(row)) break;
    if (!isMobileQuestionOnlyRow(row) || !isPendingMobileQuestion(row.questionRequest)) continue;
    if (row.fileChanges || hasEntries(row.richArtifacts)) continue;
    const target = host
      ? (host !== row && classifyQuestionHostCandidate(host, questionIds(row.questionRequest)) === 'accept' ? host : null)
      : findMobileQuestionHostRow(thread, row.questionRequest, { exclude: row });
    if (!target || target === row) continue;
    target.questionRequest = { ...(target.questionRequest || {}), ...row.questionRequest };
    thread.splice(i, 1);
    folded += 1;
  }
  return folded;
}
