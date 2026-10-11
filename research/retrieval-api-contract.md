# Context receipt API (implemented)

All routes inherit audit-router gateway authentication/account workspace isolation.
- GET `/api/context-receipts/:id`: `{success:boolean,receipt:Receipt|null}`; 404 missing, 400 invalid ID.
- GET `/api/context-receipts`: existing `{success,settings,records,skipped,limits,captureCoverage}` unchanged. Use `detail=true` to include fields below.
- POST `/api/context-receipts/:id/review`: `{relevance:'useful'|'redundant'|'irrelevant'|'unknown',reason:string}` (reason <=4000 input chars); returns `{success,saved,receipt}`. 400 invalid, 404 missing.

Receipt additions:
```
retrieval: {state:'available',traces:[{source:'atomic'|'auto'|'recall',state:'available'|'unavailable'|'skipped',reason?,thresholds:{[key]:number|string|boolean},candidateCount:number,truncated:boolean,candidates:[{sourceId,source,rank?,score?,matchedTerms?,selected:boolean,reason}]}],truncated:boolean}
// alternatively {state:'unavailable',reason:'caller_did_not_supply_producer_trace'}
outcome: {state:'unavailable',reason:'response_not_joined'}
// joined: {state:'available',status:'completed'|'cancelled'|'failed',timestamp,response,responseHash,truncated,reason,efficacy:'unknown_without_review_or_measurement'}
review: {state:'not_reviewed',relevance:'unknown',reason:''}
// saved: {state:'reviewed',relevance,reason,truncated,timestamp,basis:'reviewer_judgment_not_measured_efficacy'}
```
Outcome completion is not retrieval efficacy. Response/reason and all stored strings are redacted and bounded. Existing `gatewayTurnId`, `userInput`, `providerBoundUserInput` remain available. Atomic retrieval exposes `.retrieval`; prompt producer emits `onMemorySearchTelemetry({retrieval})`; manifest accepts `context.retrieval:RetrievalTrace[]`. Join function is `recordContextReceiptOutcome({sessionId,gatewayTurnId,status,response?,reason?},root?)`. Main coordinator owns chat.router.ts integration overlap.

Final integration: normal chat now collects request-local producer callbacks through chat-helpers/context-build-worker-client and passes `usageContext.promptManifest.retrieval`. Worker-disabled path captures a serialized snapshot with the same callback. Hybrid producer emits actual hybrid candidate gates/MMR/selection, marks lexical selection superseded when replacing prompt text. Completion/cancel/failure joins in normal handleChat finally. No dashboard/voice changes. Each trace bounded to96 candidates/6000 serialized chars; up to8 traces retained; truncation explicit. Section inventory includes every system/developer message plus named ranges/unlabelled prefixes (hashes, not full text). 12KB receipt headroom reserved for response/review updates. Native configure excludes destructive reset; HTTP settings retains prior reset behavior.
