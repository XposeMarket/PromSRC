import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const session = read('src/gateway/session.ts');
const chat = read('src/gateway/routes/chat.router.ts');
const mobileSettings = read('web-ui/src/mobile/mobile-settings.js');

// The main model path must use the entire active post-compaction history. A
// rolling/message-count policy must never decide how many conversation turns
// the admitted model gets to see.
assert.match(session, /export function getActiveHistoryForApiCall\(/,
  'session.ts must expose an unbounded active-history API-call view');
assert.match(chat, /getActiveHistoryForApiCall\(sessionId\)/,
  'main chat must load the full active history for the model');
assert.match(chat, /getActiveHistoryForApiCall\(id\)/,
  'context-window diagnostics must inspect the same full active history');
assert.doesNotMatch(chat, /activeHistoryMessageCount\s*=\s*resolveRollingCompactionPolicy\(\)\.messageCount/,
  'rollingCompactionMessageCount must not cap model history');
assert.doesNotMatch(chat, /maxMessages:\s*activeHistoryMessageCount/,
  'main chat must not pass a message-count cap into model history selection');

// Compaction is a token-budget decision. A huge first/second message must be
// eligible immediately; number-of-messages is not a safety boundary.
assert.doesNotMatch(session, /realMessageCount\s*>=\s*sessionPolicy\.compactionMinMessages/,
  'compaction/memory maintenance must not be blocked by a minimum message count');
assert.match(chat, /disableCompactionCheck:\s*true/,
  'interactive persistence must leave context compaction to the model-call boundary');
assert.match(chat, /if \(round === 0[\s\S]{0,1400}maybeRunMidWorkflowCompaction\(/,
  'the first provider call must run the token-budget compaction preflight');
assert.doesNotMatch(chat, /midWorkflowCompactionsThisTurn\s*<\s*3\s*&&\s*messages\.length\s*>\s*3/,
  'mid-workflow compaction must not require an arbitrary message count');
assert.doesNotMatch(chat, /rollingCompactionEnabled\s*===\s*false[^\n]*compacted:\s*false/,
  'legacy rolling-compaction settings must not disable hard model-call token-window safety');

// The rolling summary must cover all active conversation being retired, not
// only an arbitrary last-N message tail. The compactor itself can use the
// model's hard context window while the normal call retains output/reasoning
// headroom.
assert.doesNotMatch(chat, /nonSystemMessages\.slice\(-18\)/,
  'token-triggered compaction must not summarize only the last 18 messages');
assert.match(chat, /numCtx:\s*profile\.contextWindowTokens/,
  'the compactor should use the live model hard context window for summary input');
assert.match(session, /contextSummaryUpdatedAt\s*=\s*Date\.now\(\);[\s\S]{0,260}contextTokenEstimate\s*=\s*estimateActiveContextTokens\(session\)/,
  'recording compaction must immediately recalculate persisted active-context pressure');

// Context diagnostics are a complete active-prompt view, not a user-message
// counter. Messages include user + assistant history; tool observations/results
// and non-conversation prompt surfaces are accounted separately.
for (const token of ["id: 'messages'", "id: 'system_tools'", "id: 'system_prompt'", "id: 'skills'"]) {
  assert.ok(chat.includes(token), `context-window rows must retain ${token}`);
}
assert.match(chat, /getRecentToolObservationsForContext\(/,
  'context-window diagnostics must include reinjected tool observations');
assert.match(chat, /const toolTokens\s*=\s*Math\.round\(estimateTextTokensForModel\(recentToolContext/,
  'reinjected tool observations must contribute tokens to active context');
assert.match(chat, /role:\s*'tool'/,
  'current-turn tool results must remain part of the iterative model message context');

// Retire the misleading message-count controls from the mobile settings surface.
// Old config keys may remain readable for backwards compatibility, but they no
// longer define the active model context.
assert.doesNotMatch(mobileSettings, /Rolling message count/,
  'mobile settings must not present rolling message count as a context control');
assert.doesNotMatch(mobileSettings, /Max messages/,
  'mobile settings must not present max messages as a context-window control');

console.log('token-window-native context regression passed');
