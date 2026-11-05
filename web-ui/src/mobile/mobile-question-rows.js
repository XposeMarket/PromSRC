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

/**
 * The live row of the current request that should carry `question`: the
 * newest assistant row after the last real user row that is streaming or has
 * trace/process entries. Never an older turn, never a completed row.
 */
export function findMobileQuestionHostRow(thread, question = null, { exclude = null } = {}) {
  const list = Array.isArray(thread) ? thread : [];
  const qid = String(question?.id || question?.questionId || '').trim();
  const qcid = String(question?.clientRequestId || '').trim();
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (!row || row === exclude) continue;
    if (row.role === 'user') {
      if (isChatSteerUser(row)) continue;
      return null;
    }
    if (row.role !== 'ai') continue;
    if (row._pmFinalReceived === true || row._pmServerAuthoredFinal === true || row._pmAbortAcknowledged === true) return null;
    if (row._steerFrozenTrace === true || String(row.workflowPart || '') === 'before_interruption') continue;
    const otherQuestion = String(row.questionRequest?.id || '').trim();
    if (otherQuestion && otherQuestion !== qid) continue;
    const own = String(row._clientRequestId || '').trim();
    if (qcid && own && qcid !== own) continue;
    if (row.streaming === true || hasEntries(row.liveTraceEntries) || hasEntries(row.processEntries)) return row;
  }
  return null;
}

/**
 * Move pending question-only rows of the current request onto that request's
 * live row (or onto `host` when given) and drop the placeholder. Returns the
 * number of placeholder rows folded.
 */
export function foldMobileQuestionOnlyRows(thread, host = null) {
  if (!Array.isArray(thread)) return 0;
  let folded = 0;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const row = thread[i];
    if (row?.role === 'user' && !isChatSteerUser(row)) break;
    if (!isMobileQuestionOnlyRow(row) || !isPendingMobileQuestion(row.questionRequest)) continue;
    if (row.fileChanges || hasEntries(row.richArtifacts)) continue;
    const target = host && host !== row && !(host.questionRequest && host.questionRequest.id !== row.questionRequest.id)
      ? host
      : findMobileQuestionHostRow(thread, row.questionRequest, { exclude: row });
    if (!target || target === row) continue;
    target.questionRequest = { ...(target.questionRequest || {}), ...row.questionRequest };
    thread.splice(i, 1);
    folded += 1;
  }
  return folded;
}
