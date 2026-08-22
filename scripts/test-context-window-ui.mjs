import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('web-ui/src/pages/ChatPage.js');
const router = read('src/gateway/routes/chat.router.ts');
const mobile = read('web-ui/src/mobile/mobile-context-window.js');
const performance = read('web-ui/src/performance.js');
const liveTracking = read('web-ui/src/context-window-live-tracking.js');
const promptManifest = read('src/runtime/prompt-manifest.ts');
const modelUsage = read('src/providers/model-usage.ts');
const providerAdapter = read('src/agents/ollama-client.ts');

assert.match(router, /deriveContextWindowUsage\(currentStateTokens, contextLimitTokens\)/, 'the API must derive one authoritative context usage contract');
assert.match(router, /router\.get\('\/api\/sessions\/:id\/context-window'/, 'the same contract must be available for every session id, including agent/subagent sessions');
assert.match(router, /contextUsage,\s*\n\s*nextCallEstimateTokens/, 'the API must expose the contract to every session consumer');
assert.match(page, /function getChatContextWindowUsage\(/, 'the UI must retain overflow-aware fallback semantics');
assert.match(page, /\$\{base\} · \$\{formatContextTokenCount\(usage\.overflowTokens\)\} over/, 'the UI must state overflow beside the real percentage');
assert.doesNotMatch(page, /currentStateTokens:\s*Math\.max\(0, Number\(currentState\.currentStateTokens[^\n]+\+ liveTokens/, 'the authoritative desktop snapshot must not be mutated by transient tool payloads');
assert.doesNotMatch(page, /id: 'live_tool_results'/, 'transient tool payloads must stay visually separate from the authoritative breakdown');
assert.match(page, /usage\.progressPercent/, 'only the visual progress bar may clamp to 100%');
assert.match(page, /Side chat context is inherited from the parent chat\./, 'side-chat variants must continue to use their parent context metric rather than a second counter');
assert.match(router, /id: 'cached', label: 'Cached'/, 'the API must expose the cached-token metric');
assert.match(router, /id: 'total_thread_tokens', label: 'Stored thread footprint'/, 'stored-thread footprint must remain visible as a separate out-of-band storage metric');
assert.match(router, /id: 'compaction_trigger', label: 'Model compaction trigger'/, 'the model compaction threshold must remain distinct from whole-thread accounting');
assert.doesNotMatch(router, /label: 'MCP tools \(deferred\)'/, 'obsolete MCP rows must not be exposed in the breakdown');
assert.match(mobile, /function _scheduleFreshnessRefresh\(/, 'mobile must refresh the authoritative context snapshot while the chat is visible');

assert.match(router, /const fullMessageTokens = Math\.round\(estimateMessagesTokensForModel\(session\.history as any, profile\) \* calibrationFactor\)/, 'whole-thread message usage must be derived from the complete stored session history');
assert.match(router, /id: 'messages\.current_model_slice', label: 'Current model slice'/, 'messages must retain a current rolling-model-slice child');
assert.match(router, /id: 'messages\.earlier_thread', label: 'Earlier thread'/, 'messages must expose earlier thread history separately');
assert.match(router, /function buildPreviousTurnsContextRow\(/, 'the gateway must aggregate historical dynamic context into a previous-turn ledger');
assert.match(router, /id: 'previous_turns',\s*\n\s*label: 'Previous turns'/, 'the historical dynamic ledger must be an expandable Previous turns row');
assert.match(router, /id: 'previous_turns\.atomic_memory'/, 'Previous turns must contain deduplicated atomic-memory references');
assert.match(router, /id: 'previous_turns\.thought_context_packets'/, 'Previous turns must contain deduplicated thought-context packets');
assert.match(router, /id: 'previous_turns\.tool_categories'/, 'Previous turns must contain deduplicated historical tool categories');
assert.match(router, /id: 'previous_turns\.tool_results'/, 'Previous turns must preserve historical tool-result footprint');
assert.match(router, /currentReferenceIds\.has\(reference\.id\)/, 'historical references that are active on the current turn must not be double-counted');
assert.match(router, /currentCategories\.has\(category\)/, 'historical tool categories that are active on the current turn must not be double-counted');
assert.match(router, /\{ id: 'system_prompt'[^\n]+\n\s*\.\.\.\(input\.previousTurnsRow \? \[input\.previousTurnsRow\] : \[\]\)/, 'Previous turns must render immediately beneath the current System prompt row');

assert.match(promptManifest, /export interface RuntimePromptContextReference/, 'runtime prompt manifests must define durable dynamic-context reference telemetry');
assert.match(promptManifest, /contextReferences: RuntimePromptContextReference\[\]/, 'runtime prompt manifests must retain the exact dynamic references actually injected');
assert.match(promptManifest, /line === '\[MEMORY_REFERENCE\]'/, 'prompt telemetry must recognize atomic-memory reference sections');
assert.match(promptManifest, /line\.startsWith\('\[BRAIN_ACTIVE_CONTEXT'/, 'prompt telemetry must recognize thought-context packet sections');
assert.match(promptManifest, /atom=\(matom_\[a-z0-9\]\+\)/i, 'atomic-memory telemetry must use stable matom ids for deduplication');
assert.match(modelUsage, /contextReferences\?: Array<\{/, 'model-usage events must carry prompt context-reference metadata');
assert.match(modelUsage, /contextReferences: Array\.isArray\(event\.contextReferences\)/, 'model-usage persistence must not discard context-reference metadata');
assert.match(modelUsage, /activeToolCategories: Array\.isArray\(event\.activeToolCategories\)/, 'model-usage persistence must retain active tool categories for historical deduplication');
assert.equal((providerAdapter.match(/contextReferences: promptManifest\.contextReferences/g) || []).length, 2, 'both provider call paths must persist the manifest references that were actually sent');

assert.match(performance, /import '\.\/context-window-live-tracking\.js';/, 'the shared live tracker must load on both desktop and mobile entry paths');
assert.match(performance, /prometheus:client-performance-mark/, 'desktop tool telemetry must be published to the live tracker without exposing message content');
assert.match(liveTracking, /const SEMANTIC_LABEL = 'Thread context'/, 'the primary gauge must describe whole-thread context rather than a per-turn active slice');
assert.match(liveTracking, /Whole thread · prior dynamic context is deduplicated/, 'the popover must explain the full-thread accounting model');
assert.match(liveTracking, /chat_tool_result_received/, 'desktop tool-result telemetry must advance the live estimate');
assert.match(liveTracking, /__pmMobileContextStreamEvent/, 'mobile tool-result telemetry must advance the same live estimate');
assert.match(liveTracking, /Math\.max\(\s*state\.authoritativeTokens,\s*state\.baselineTokens \+ state\.liveToolTokens/s, 'live estimates must never move backward or double-add an authoritative server snapshot');
assert.match(liveTracking, /\+\$\{formatTokens\(unreflectedTokens\)\} live est/, 'the UI must mark unreflected live tokens as an estimate instead of presenting them as authoritative');

// CI refresh after review against current main.
console.log('context-window UI contract: ok');
