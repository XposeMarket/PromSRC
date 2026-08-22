from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_bytes().decode('utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_bytes(text.encode('utf-8'))


def newline_for(text: str) -> str:
    crlf = text.count('\r\n')
    bare_lf = text.count('\n') - crlf
    return '\r\n' if crlf > bare_lf else '\n'


def block(text: str, value: str) -> str:
    return value.replace('\n', newline_for(text))


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old = block(text, old)
    new = block(text, new)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


# Idempotent on the product patch.
chat_now = read('src/gateway/routes/chat.router.ts')
if 'getActiveHistoryForApiCall(sessionId)' in chat_now:
    print('PR171 runtime patch already present')
    raise SystemExit(0)

# session.ts
path = 'src/gateway/session.ts'
text = read(path)
text = replace_once(
    text,
    "  session.contextSummaryUpdatedAt = Date.now();\n  appendCompactionArtifacts(sessionId, kind, session.latestContextSummary, session.contextStartIndex, extra);",
    "  session.contextSummaryUpdatedAt = Date.now();\n  // Reconcile persisted pressure immediately after compaction so diagnostics\n  // and the next preflight reflect the new active context rather than the old peak.\n  session.contextTokenEstimate = estimateActiveContextTokens(session);\n  appendCompactionArtifacts(sessionId, kind, session.latestContextSummary, session.contextStartIndex, extra);",
    'compaction pressure reconciliation',
)
text, count = re.subn(
    r"(\r?\n)    const realMessageCount = session\.history\.filter\(isRealContextMessage\)\.length \+ 1;",
    r"\1",
    text,
)
if count != 2:
    raise SystemExit(f'message-count declarations: expected 2 removals, found {count}')
text = replace_once(
    text,
    "    const shouldCompact = realMessageCount >= sessionPolicy.compactionMinMessages\n      && projectedTokens >= compactionThresholdTokens\n      && !recentlyCompacted;",
    "    const shouldCompact = projectedTokens >= compactionThresholdTokens\n      && !recentlyCompacted;",
    'compaction message-count gate',
)
text = replace_once(
    text,
    "    const shouldInject = realMessageCount >= sessionPolicy.compactionMinMessages\n      && projectedTokens >= thresholdTokens\n      && !recentlyPrompted;",
    "    const shouldInject = projectedTokens >= thresholdTokens\n      && !recentlyPrompted;",
    'memory-flush message-count gate',
)
text = replace_once(
    text,
    "  options?: { maxMessages?: number },\n): ChatMessage[] {\n  const session = getSession(id);\n  const maxMessages = Number.isFinite(Number(options?.maxMessages))\n    ? Math.max(1, Math.floor(Number(options?.maxMessages)))\n    : maxTurns * 2;",
    "  options?: { maxMessages?: number; fullActiveHistory?: boolean },\n): ChatMessage[] {\n  const session = getSession(id);\n  const maxMessages = options?.fullActiveHistory === true\n    ? Number.POSITIVE_INFINITY\n    : Number.isFinite(Number(options?.maxMessages))\n      ? Math.max(1, Math.floor(Number(options?.maxMessages)))\n      : maxTurns * 2;",
    'full active history option',
)
text = replace_once(
    text,
    "    if (messages.length > maxMessages) {",
    "    if (Number.isFinite(maxMessages) && messages.length > maxMessages) {",
    'finite history trim',
)
marker = block(text, "/**\n * Builds a legacy [RECENT_TOOL_LOG] block")
helper = block(text, "export function getActiveHistoryForApiCall(id: string): ChatMessage[] {\n  return getHistoryForApiCall(id, 60, { fullActiveHistory: true });\n}\n\n")
if marker not in text:
    raise SystemExit('active history helper insertion marker missing')
text = text.replace(marker, helper + marker, 1)
write(path, text)

# chat.router.ts
path = 'src/gateway/routes/chat.router.ts'
text = read(path)
text = replace_once(
    text,
    "getSession, addMessage, getHistory, getHistoryForApiCall, getRecentToolObservationsForContext",
    "getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getRecentToolObservationsForContext",
    'session import',
)
text = replace_once(
    text,
    "  const activeHistoryMessageCount = resolveRollingCompactionPolicy().messageCount;\n  htime('before getHistoryForApiCall');\n  const rawHistory = executionMode === 'cron'\n    ? []\n    : getHistoryForApiCall(sessionId, Math.ceil(activeHistoryMessageCount / 2), { maxMessages: activeHistoryMessageCount });\n  htime('after getHistoryForApiCall');",
    "  htime('before getHistoryForApiCall');\n  const rawHistory = executionMode === 'cron'\n    ? []\n    : getActiveHistoryForApiCall(sessionId);\n  htime('after getHistoryForApiCall');",
    'main model full active history',
)
text = replace_once(
    text,
    "    const messageCount = resolveRollingCompactionPolicy().messageCount;\n    const history = getHistoryForApiCall(id, Math.ceil(messageCount / 2), { maxMessages: messageCount });",
    "    const history = getActiveHistoryForApiCall(id);",
    'context diagnostics full active history',
)
text = replace_once(text, "    const rollingCompactionApplied = false;\n\n", "", 'dead rolling flag')
text = replace_once(
    text,
    "        disableCompactionCheck: rollingCompactionApplied || isSubagentChatSession,",
    "        // The actual model-call boundary owns token-aware compaction.\n        // Persisting a message must never impose a message-count context policy.\n        disableCompactionCheck: true,",
    'legacy persistence compaction',
)
text = replace_once(
    text,
    "  const nonSystemMessages = input.messages.filter((m) => m?.role !== 'system');\n  const recentWindow = nonSystemMessages.slice(-18);",
    "  const nonSystemMessages = input.messages.filter((m) => m?.role !== 'system');\n  // Token pressure decides when to compact; message count must not decide what\n  // context is preserved. Retire the entire active conversation, while the\n  // previous rolling summary is supplied separately as previousSummary.\n  const recentWindow = nonSystemMessages.filter((m) => !/^\\[Rolling context summary\\]/i.test(String(m?.content || '').trim()));",
    'full compaction retirement window',
)
text = replace_once(
    text,
    "      numCtx: Math.min(profile.contextWindowTokens, Math.max(4096, budget.inputBudgetTokens)),",
    "      // Compaction output is tightly bounded, so the compactor can use\n      // the model's hard window to ingest the active conversation being retired.\n      numCtx: profile.contextWindowTokens,",
    'compactor hard model window',
)
text = replace_once(
    text,
    "    if ((!sessionId.startsWith('subagent_') || isDirectSubagentChatTurn) && midWorkflowCompactionsThisTurn < 3 && messages.length > 3) {",
    "    if ((!sessionId.startsWith('subagent_') || isDirectSubagentChatTurn) && midWorkflowCompactionsThisTurn < 3) {",
    'post-tool arbitrary message gate',
)
generation_marker = block(text, "      const generationPromise = ollama.chatWithThinking(messages, 'executor', {")
preflight = block(text, """      // The first provider call gets the same token-budget guard as later
      // rounds. A single huge first turn can therefore compact immediately.
      if (round === 0 && (!sessionId.startsWith('subagent_') || isDirectSubagentChatTurn) && midWorkflowCompactionsThisTurn < 3) {
        const preflightCompact = await maybeRunMidWorkflowCompaction({
          sessionId,
          messages,
          toolResults: allToolResults,
          reasoningTrail: normalizeReasoningSummary(allReasoningSummary),
          sendSSE,
          abortSignal,
          reasonHint: 'pre_model_token_budget',
          routeSnapshot: activeGenerationRouteSnapshot,
        });
        if (preflightCompact.compacted) {
          midWorkflowCompactionsThisTurn++;
          sendSSE('info', { message: 'Context compacted. Continuing the active workflow...' });
        }
        if (abortSignal?.aborted) return { type: 'chat', text: '', reasoningSummary: normalizeReasoningSummary(allReasoningSummary) };
      }

""")
if generation_marker not in text:
    raise SystemExit('provider generation marker missing')
text = text.replace(generation_marker, preflight + generation_marker, 1)
write(path, text)

# mobile settings: retire misleading message-count context controls.
path = 'web-ui/src/mobile/mobile-settings.js'
text = read(path)
pattern = re.compile(r"\$\{card\('Session Compaction', `.*?`, 'clipboard'\)\}", re.S)
replacement = "${card('Context Window', `\n      <div class=\"pm-card-body\">Prometheus uses the selected model's token window automatically. Full active conversation context is retained until token pressure requires rolling compaction; there is no message-count context limit.</div>\n    `, 'clipboard')}"
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'mobile context card: expected 1 replacement, found {count}')
write(path, text)

print('PR171 runtime patch applied')
