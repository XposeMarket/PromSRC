import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  assert.notEqual(end, -1, `${label}: missing end marker ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(source, markers, label) {
  let cursor = 0;
  for (const marker of markers) {
    const index = source.indexOf(marker, cursor);
    assert.notEqual(index, -1, `${label}: missing or out-of-order marker ${marker}`);
    cursor = index + marker.length;
  }
}

const ollamaClient = read('src/agents/ollama-client.ts');
const modelDispatcher = read('src/gateway/turn-workers/model-call-dispatcher.ts');
const modelHandler = read('src/gateway/turn-workers/model-call-handler.ts');
const turnExecution = read('src/gateway/turn-jobs/execution-context.ts');
const turnRuntime = read('src/gateway/turn-jobs/runtime.ts');
const turnStore = read('src/gateway/turn-jobs/store.ts');
const workerProcess = read('src/gateway/turn-workers/turn-worker-process.ts');
const fileChangeDispatcher = read('src/gateway/turn-workers/turn-file-change-dispatcher.ts');
const openAiOAuth = read('src/auth/openai-oauth.ts');
const xaiOAuth = read('src/auth/xai-oauth.ts');
const chatRouter = read('src/gateway/routes/chat.router.ts');
const blobRuntime = read('src/gateway/turn-jobs/blob-runtime.ts');
const blobStore = read('src/gateway/turn-jobs/blob-store.ts');
const boundedPayload = read('src/gateway/turn-delivery/bounded-payload.ts');
const gatewayAuth = read('src/gateway/gateway-auth.ts');
const cronScheduler = read('src/gateway/scheduling/cron-scheduler.ts');
const healthApp = read('src/gateway/core/app.ts');
const server = read('src/gateway/server-v2.ts');
const isolationDocs = read('workspace/self/30-runtime-process-isolation.md');

// Model/provider calls cross the process boundary, and a child must never
// recursively dispatch its own provider call into another worker.
const modelGuard = section(
  ollamaClient,
  'function shouldUseIsolatedModelWorkers()',
  'export interface GenerateOutput',
  'model-worker recursion guard',
);
assert.match(modelGuard, /PROMETHEUS_TURN_WORKER\s*!==\s*['"]1['"]/, 'worker children must bypass redispatch');
assert.match(modelGuard, /PROMETHEUS_DISABLE_MODEL_WORKERS\s*!==\s*['"]1['"]/, 'operators must retain an isolation kill switch');
assert.ok(
  (ollamaClient.match(/dispatchIsolatedModelCall</g) || []).length >= 2,
  'both chat and generate calls must dispatch through the model-worker boundary',
);
assert.ok(
  (ollamaClient.match(/accountId:\s*getProviderAccountId\(activeProvider\)/g) || []).length >= 2,
  'chat and generate worker requests must preserve the selected provider account identity',
);
assert.match(modelHandler, /buildProviderById\(request\.providerId, request\.accountId\)/,
  'the child must rebuild its provider with the selected account identity');
assert.match(modelHandler, /promptManifest:\s*isRecord\(value\.usageContext\.promptManifest\)/,
  'prompt-manifest attribution must survive request normalization in the child');
assert.match(modelHandler, /getConfig\(\)\.reloadConfig\(\)/,
  'reused model children must reload current provider settings before each call');
assertOrdered(
  modelDispatcher,
  ['await prepareModelWorkerCredentials(request)', 'putJsonAsync(await toTurnJsonValueAsync(request))', 'getPool().submit'],
  'rotating OAuth credentials must be refreshed by the gateway before parallel child dispatch',
);
const attachmentPersistence = section(chatRouter, 'async function persistTurnAttachmentRefs', 'function parseDurableHandleChatReplay', 'async turn attachment persistence');
assert.match(attachmentPersistence, /await blobs\.putBufferAsync/,
  'large request attachments must not be synchronously written/fsynced by the gateway');
assert.ok((chatRouter.match(/attachments:\s*await persistTurnAttachmentRefs/g) || []).length >= 2,
  'both durable chat entry points must await attachment persistence');
assert.match(modelHandler, /context\.callGateway\(['"]prepare_model_credentials['"]/,
  'queued rotating-OAuth calls must re-run gateway credential preflight when the child actually starts');
assert.match(modelDispatcher, /onRpc:[\s\S]{0,1600}prepareModelWorkerCredentials\(request\)/,
  'credential preflight RPC must be fulfilled by the gateway coordinator');
assert.match(openAiOAuth, /PROMETHEUS_RUNTIME_WORKER[\s\S]{0,300}read-only OAuth credential consumers/,
  'OpenAI OAuth writes and refreshes must be forbidden in runtime children');
assert.match(xaiOAuth, /PROMETHEUS_RUNTIME_WORKER[\s\S]{0,300}read-only OAuth credential consumers/,
  'xAI OAuth writes and refreshes must be forbidden in runtime children');
assert.match(modelDispatcher, /getPool\(\)\.submit/, 'model dispatch must submit through the bounded process pool');
assert.match(modelDispatcher, /handleModelStreamEvent\(message\.event as ModelCallStreamEvent, callbacks, durable\)/,
  'reused model-worker callbacks must use the turn captured at submission instead of inherited async-local state');
assert.match(modelDispatcher, /recordDurableTurnEvent\('model_worker_started',[\s\S]{0,120}, durable\)/,
  'model-worker lifecycle events must be fenced to their explicitly captured turn');
assert.match(modelDispatcher, /checkpointDurableTurn\([\s\S]{0,320}\{ metadata: \{ modelSequence \} \},\s*durable,/,
  'model-worker checkpoints must be fenced to their explicitly captured turn');
assert.match(
  modelDispatcher,
  /submitted\.cancel\([\s\S]{0,180}?\)\.catch\(/,
  'fire-and-forget model cancellation must observe submission failures',
);
assertOrdered(
  modelDispatcher,
  ['putJsonAsync(await toTurnJsonValueAsync(request))', 'requestRef: requestDescriptor.ref', 'getPool().submit'],
  'model requests must be persisted and passed to workers by reference',
);
assert.match(workerProcess, /PROMETHEUS_TURN_WORKER:\s*['"]1['"]/, 'spawned workers must receive the recursion-guard environment flag');
assert.match(workerProcess, /new AsyncResource\(['"]PrometheusTurnWorkerJob['"]\)/,
  'each submitted job must capture its own async-local callback scope even when a child process is reused');
assert.match(workerProcess, /callbackScope\.runInAsyncScope/,
  'reusable child listeners must invoke handlers inside the current job callback scope');

// Finalization git/stat/read work belongs in a bounded child. Optional metadata
// must degrade away on child failure rather than rerun synchronously in gateway.
assertOrdered(
  fileChangeDispatcher,
  ['putJsonAsync(request as unknown as JsonValue)', 'requestRef: requestDescriptor.ref', 'getPool().submit'],
  'file-change scans must cross IPC through blob references',
);
assert.match(fileChangeDispatcher, /PROMETHEUS_FILE_CHANGE_WORKER_COUNT\s*\|\|\s*2/,
  'parallel finalization must default to two file-change workers');
assert.match(fileChangeDispatcher, /PROMETHEUS_FILE_CHANGE_WORKER_OLD_SPACE_MB\s*\|\|\s*384/,
  'file-change children must have a bounded default old-space cap');
assert.match(fileChangeDispatcher, /execArgv:\s*buildTurnFileChangeWorkerExecArgv\(\)/,
  'file-change children must preserve inherited loaders while applying their heap cap');
assert.equal(
  (fileChangeDispatcher.match(/collectTurnFileChangesDirect/g) || []).length,
  2,
  'direct file-change collection must exist only as the import and explicit diagnostic/child branch, never as a production failure fallback',
);
assert.match(fileChangeDispatcher, /file_change_worker_degraded/,
  'worker failure must leave a durable degradation trace while omitting optional metadata');
assert.match(fileChangeDispatcher, /recordDurableTurnEvent\('file_change_worker_started',[\s\S]{0,120}, durable\)/,
  'reused file-change-worker callbacks must journal against their explicitly captured turn');
assert.match(fileChangeDispatcher, /checkpointDurableTurn\([\s\S]{0,320}\{ metadata: \{ sequence \} \},\s*durable,/,
  'file-change checkpoints must not rely on inherited async-local state from a reused child');
assert.ok((chatRouter.match(/collectTurnFileChangesIsolated\(/g) || []).length >= 2,
  'both handleChat and interactive finalization must use the isolated file-change boundary');

// Lease loss is a fatal fence, not a warning. It aborts in-flight tools/model
// calls and every durable boundary rejects continuation by the stale attempt.
assert.match(turnExecution, /class DurableTurnFenceError/, 'durable execution must expose a typed fence failure');
assert.match(turnExecution, /fenceController\.abort\(error\)/, 'lease loss must abort in-flight turn work');
assert.match(turnExecution, /heartbeatJob[\s\S]{0,400}fenceDurableTurnExecution/,
  'heartbeat renewal failure must fence the owning execution');
assert.match(turnExecution, /recordDurableTurnEvent[\s\S]{0,300}assertDurableTurnLease/,
  'event boundaries must reject work from a fenced execution');
assert.match(turnExecution, /prepareDurableToolEffect[\s\S]{0,350}assertDurableTurnLease/,
  'tool-effect boundaries must reject work from a fenced execution');
assert.match(
  workerProcess,
  /active\.abortController\.abort\(cancellationError\)[\s\S]{0,700}?type:\s*['"]cancel['"]/,
  'parent cancellation must abort gateway RPC work before waiting on child IPC',
);
assert.match(
  workerProcess,
  /message\.type === ['"]final['"][\s\S]{0,260}active\.abortController\.signal\.aborted[\s\S]{0,400}completeActive/,
  'a child final must not win a race against authoritative parent cancellation',
);
assertOrdered(
  section(workerProcess, 'async shutdown(graceMs = 2_000)', 'forceKill(): void', 'turn-worker shutdown'),
  ['const stopped = new Promise<void>', 'void this.send({', 'await stopped'],
  'worker shutdown must arm its kill deadline before an IPC send that can stall',
);

// Whole turns are journaled durably even though their gateway orchestration is
// intentionally still in-process. Final state is persisted before completion.
const handleWrapper = section(
  chatRouter,
  'const handleChat: typeof handleChatInGateway',
  '// Wire chat-helpers',
  'durable handleChat wrapper',
);
assertOrdered(
  handleWrapper,
  ['await beginDurableTurn({', 'if (execution.replayed)', 'runWithDurableTurn(execution', 'await persistDurableTurnFinal', 'completeDurableTurn(execution)'],
  'handleChat journal finalization',
);

const interactiveWrapper = section(
  chatRouter,
  'const runInteractiveTurn: typeof runInteractiveTurnInGateway',
  'function createSSESender',
  'durable interactive wrapper',
);
assertOrdered(
  interactiveWrapper,
  ['await beginDurableTurn({', 'if (execution.replayed)', 'runWithDurableTurn(execution', 'await persistDurableTurnFinal'],
  'interactive turn persistence',
);
assert.doesNotMatch(
  interactiveWrapper,
  /completeDurableTurn\(/,
  'interactive jobs must not complete before their client-facing terminal delivery path runs',
);
assert.match(chatRouter, /INLINE_DURABLE_TOOL_NAMES[\s\S]{0,500}['"]complete_goal['"]/,
  'goal completion must enter the inline durable-effect boundary');
assert.match(chatRouter, /INLINE_DURABLE_TOOL_NAMES[\s\S]{0,500}['"]subagent_spawn['"]/,
  'subagent spawn must enter the inline durable-effect boundary');
assert.match(chatRouter, /pendingInlineDurableEffect[\s\S]{0,900}completeDurableToolEffect/,
  'inline side effects must commit their outcome before publishing tool_result');
assert.match(chatRouter, /await completeDurableToolEffectAsync/,
  'central tool results must await the nonblocking durable blob path');
assertOrdered(
  section(turnExecution, 'export async function completeDurableToolEffectAsync', 'export function failDurableToolEffect', 'async tool-effect persistence'),
  ['toTurnJsonValueAsync(result)', 'putJsonAsync(normalized)', 'completeToolEffect(', "checkpointDurableTurn('tool_result'"],
  'large tool results must become durable before their effect/checkpoint is published',
);

const localFinalizer = section(
  chatRouter,
  'const completeLocalMainChatStream =',
  'const upstreamSendSSE =',
  'local stream finalizer',
);
assertOrdered(
  localFinalizer,
  ['await prepareDurableTurnFinal', 'await flushSessionForDelivery()', 'commitPreparedDurableTurnFinal', "appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, 'done'", 'completeDurableTurn(durableExecution)'],
  'local stream final-before-complete ordering',
);

const apiChatRoute = section(chatRouter, "router.post('/api/chat'", null, 'API chat delivery');
assertOrdered(
  apiChatRoute,
  ["sendSSE('final'", "sendSSE('done'", 'completeDurableTurn(durableExecution)'],
  'API chat terminal delivery-before-complete ordering',
);

// Oversized passive media receives a signed, hash-scoped GET URL. Active
// same-origin content remains a download even if a caller has a valid grant.
const safeTypes = section(
  blobRuntime,
  'const SAFE_INLINE_TURN_BLOB_TYPES',
  'let blobStore',
  'passive turn-blob content types',
);
assert.match(safeTypes, /['"]image\/png['"]/, 'PNG blobs should remain inline-renderable');
assert.match(safeTypes, /['"]video\/mp4['"]/, 'MP4 blobs should remain inline-renderable');
assert.doesNotMatch(safeTypes, /image\/svg\+xml|text\/html|application\/javascript/, 'active content must never be on the inline allowlist');
assert.match(blobRuntime, /createHmac\(['"]sha256['"]/, 'blob grants must be signed');
assert.match(blobRuntime, /timingSafeEqual/, 'blob grant verification must use a timing-safe signature comparison');
assertOrdered(
  section(blobRuntime, 'export function createTurnDeliveryReference', null, 'delivery blob references'),
  ['isSafeInlineTurnBlobContentType(descriptor.contentType)', 'createSignedTurnBlobUrl(descriptor.hash)'],
  'passive media signed-URL conversion',
);
assert.match(blobStore, /async putJsonAsync\(/, 'large durable JSON writes must expose an asynchronous path');
assert.match(blobStore, /async putChunkStreamAsync\(/, 'stream-decoded media must not require one complete gateway Buffer');
assert.match(blobStore, /await pipeline\([\s\S]*?createGzip\(/, 'large durable compression must stream outside the gateway event loop');
assert.match(blobStore, /await outputHandle\.sync\(\)/, 'the asynchronous path must still fsync before publication');
const asyncBlobPersistence = section(blobStore, 'private async putChunksAsync', '\n  has(ref:', 'cooperative blob persistence');
assert.doesNotMatch(asyncBlobPersistence, /Buffer\.concat\(/, 'the asynchronous path must not concatenate a complete envelope');
assert.match(asyncBlobPersistence, /hashState\.update\(chunk\)/, 'durable hashes must be computed from bounded chunks');
assert.doesNotMatch(
  section(blobStore, 'if (fs.existsSync(targetPath))', 'let encoding:', 'immutable blob reuse'),
  /getBuffer\(/,
  'immutable blob reuse must not reread/decompress/rehash the complete body',
);
const finalPersistence = section(turnExecution, 'export async function prepareDurableTurnFinal', 'export async function persistDurableTurnFinal', 'two-phase durable final persistence');
assertOrdered(
  finalPersistence,
  ['await boundTurnDeliveryFrameAsync', 'createTurnDeliveryReferenceAsync', 'await getTurnJobBlobStore().putJsonAsync', 'export function commitPreparedDurableTurnFinal', 'persistFinal('],
  'referenced content and final payload must be durable before the terminal journal transition',
);
assert.match(blobRuntime, /putChunkStreamAsync\(decodeDataUriChunks/, 'large data URIs must be decoded directly into async blob staging');
const asyncDataUriPersistence = section(blobRuntime, 'async function persistDataUriAsync', '\n}', 'async data-URI persistence');
assert.doesNotMatch(asyncDataUriPersistence, /decodeDataUri\(/, 'async data-URI persistence must not synchronously decode the complete body');
assert.match(boundedPayload, /export async function boundTurnDeliveryFrameAsync/, 'durable terminal bounding must have a cooperative implementation');
assert.match(boundedPayload, /MAX_SYNC_STRING_CODE_UNITS/, 'synchronous progress bounding must cap exact string work');
assert.match(boundedPayload, /sanitizeVeryLargeStringSync/, 'giant progress strings must use bounded previews without exact refs');
assert.match(chatRouter, /getDurableTurnFinalDeliveryPayload\(durableExecution\)/,
  'terminal stream publication must reuse the already-bounded durable payload');
assert.match(chatRouter, /createReference:\s*reuseExistingTurnDeliveryReference/,
  'stream replay must not introduce large synchronous blob writes');
const blobGrant = section(gatewayAuth, 'function hasValidTurnBlobGrant', 'export function evaluateGatewayRequest', 'blob grant authentication');
const normalizedBlobGrant = blobGrant.replaceAll('\\/', '/');
assert.match(blobGrant, /method[^\n]+GET/, 'blob capabilities must be GET-only');
assert.match(normalizedBlobGrant, /\/api\/turn-blobs\//, 'blob capabilities must be scoped to the blob route');
assert.match(normalizedBlobGrant, /\[a-f0-9\]\{64\}/, 'blob capabilities must be scoped to one content hash');
const blobRoute = section(chatRouter, "router.get('/api/turn-blobs/:hash'", 'function requireSafeSessionParam', 'turn-blob route');
assert.match(blobRoute, /isSafeInlineTurnBlobContentType/, 'the response route must re-check the passive-media allowlist');
assert.match(blobRoute, /Content-Disposition[^\n]+attachment/, 'non-passive blob responses must be downloads');
assert.match(blobRoute, /Content-Security-Policy/, 'non-passive blob responses must receive a restrictive CSP');

// Replay retention and each slow SSE consumer are byte/time bounded. The
// normal final -> done pair may be held, but the queue has an explicit cap.
assert.match(chatRouter, /MAIN_CHAT_STREAM_MAX_BYTES\s*=\s*16\s*\*\s*1024\s*\*\s*1024/, 'main-chat replay must have a byte ceiling');
assert.match(chatRouter, /stream\.eventBytes\s*>\s*MAIN_CHAT_STREAM_MAX_BYTES/, 'replay eviction must enforce its byte ceiling');
assert.match(chatRouter, /boundTurnDeliveryFrame/, 'frames must be bounded before replay and delivery');
const sseSender = section(chatRouter, 'function createSSESender', 'async function streamExistingMainChatToResponse', 'SSE backpressure sender');
assert.match(sseSender, /pendingTerminalFrames:\s*Array</, 'backpressure must use a dedicated terminal-only queue');
assert.match(sseSender, /while \(pendingTerminalFrames\.length\s*>\s*2\)\s*pendingTerminalFrames\.shift\(\)/, 'the final/done terminal queue must remain explicitly capped');
assert.match(sseSender, /if \(backpressured\)/, 'non-draining sockets must enter an explicit backpressure path');
assert.match(sseSender, /res\.destroy\(\)/, 'a persistently blocked SSE consumer must be disconnected');
assert.match(sseSender, /30_000/, 'SSE backpressure must have a finite drain deadline');
assert.match(sseSender, /flushTerminalFrames/, 'the bounded sender must expose its private terminal queue at response completion');
assertOrdered(
  apiChatRoute,
  ['httpSendSSE.flushTerminalFrames()', 'res.end()'],
  'queued final/done frames must be handed to Node before the HTTP response ends',
);

// Scheduled work must not globally pause unrelated threads.
assert.doesNotMatch(cronScheduler, /interruptTaskForSchedule\(/, 'scheduled jobs must not interrupt unrelated task runners');
assert.doesNotMatch(cronScheduler, /interruptedTasksBySchedule/, 'the scheduler must not own cross-task interruption state');

// Operations expose the implemented boundary and shut down every isolated
// helper. Keep the label precise: this is not full-turn redispatch.
assert.match(healthApp, /getModelTurnWorkerPoolStatus/, 'health must inspect the model-worker pool');
assert.match(healthApp, /getTurnFileChangeWorkerPoolStatus/, 'health must inspect the file-change worker pool');
assert.match(healthApp, /getTurnJobRuntimeStatus/, 'health must inspect the durable journal');
assert.match(healthApp, /isolation:\s*['"]model-process-pool\+file-change-process\+context-process\+observation-process\+durable-turn-journal['"]/, 'health must accurately name the current isolation boundary');
assert.match(healthApp, /workers:\s*turnWorkers\.workers\.map/, 'health must expose per-worker state');
assert.match(healthApp, /journal:\s*\{/, 'health must expose durable-journal state');
assert.match(server, /getTurnJobStore\(\)/, 'startup must open and reconcile the durable journal');
const shutdownHooks = section(server, 'stopRuntimeWorkers: async () =>', 'closeWebSocket:', 'runtime-worker shutdown hook');
assert.match(shutdownHooks, /shutdownModelTurnWorkerPool\(\)/, 'lifecycle shutdown must stop model workers');
assert.match(shutdownHooks, /shutdownTurnFileChangeWorkerPool\(\)/, 'lifecycle shutdown must stop file-change workers');
assert.match(shutdownHooks, /shutdownTurnJobRuntime\(\)/, 'lifecycle shutdown must close the journal');

// Recovery may settle only already-persisted, zero-outbox finals and expired
// leases. It must remain bounded and must never become an implicit dispatcher.
assert.match(turnStore, /reconcileFinalizedJobs\(/, 'the store must expose final-only crash-window reconciliation');
assert.match(turnStore, /state\s*=\s*'final_persisted'[\s\S]{0,300}NOT EXISTS[\s\S]{0,180}turn_deliveries/,
  'final recovery must require zero explicit delivery rows');
assert.match(turnRuntime, /PROMETHEUS_TURN_RECOVERY_INTERVAL_MS/, 'runtime recovery must have an operator-visible interval');
assert.match(turnRuntime, /PROMETHEUS_TURN_RECOVERY_BATCH/, 'runtime recovery must have a bounded batch');
assert.match(turnRuntime, /reconcileStaleLeases\(lastRecoveryStartedAt, recoveryBatchLimit\(\)\)/,
  'periodic stale-lease recovery must use the same explicit batch bound');
assert.match(turnRuntime, /if \(recoveryTimer\) clearTimeout\(recoveryTimer\)/,
  'journal shutdown must cancel periodic recovery');
assert.doesNotMatch(turnRuntime, /claimNextJob\(/, 'reconciliation must not silently redispatch queued/checkpointed turns');

assert.match(chatRouter, /async function handleChatInGateway/, 'the current gateway-owned orchestration boundary must remain explicit');
assert.match(chatRouter, /async function runInteractiveTurnInGateway/, 'the current gateway-owned interactive boundary must remain explicit');
assert.doesNotMatch(healthApp, /isolation:\s*['"][^'"]*full[- ]turn/i, 'health must not falsely claim full-turn process isolation');
assert.match(isolationDocs, /Remaining full-turn extraction plan/i, 'runtime docs must retain the unfinished full-turn extraction plan');
assert.match(isolationDocs, /orchestration does \*\*not\*\* yet run in a child/i, 'runtime docs must state that orchestration remains in the gateway');
assert.match(isolationDocs, /tool loop[\s\S]{0,180}remain gateway-owned/i, 'runtime docs must state the remaining gateway-owned tool-loop boundary');

const workerDirectory = path.join(root, 'src/gateway/turn-workers');
const workerSources = fs.readdirSync(workerDirectory)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => read(path.join('src/gateway/turn-workers', name)))
  .join('\n');
assert.doesNotMatch(
  workerSources,
  /handleChatInGateway|runInteractiveTurnInGateway/,
  'worker code must not be mistaken for a completed full-turn engine extraction',
);

console.log('PASS: durable turn runtime/process-boundary contract');
