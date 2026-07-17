# Prometheus Tool Issues — Root-Cause Analysis and Fix Plan

**Date:** 2026-07-17  
**Scope:** Tool failures exposed while implementing Raul's X-bookmarks skill roadmap  
**Method:** Source inspection, current tool-schema inspection, fleet audit rerun, and comparison against the recorded failure evidence.

## Executive summary

| Issue | Verdict | Severity | Root cause | Recommended fix |
|---|---|---:|---|---|
| `skill_ops` trigger-evaluation inputs unavailable | Confirmed | High | Unified `skill_ops` schema omits `triggerPositivePrompts` and `triggerNegativePrompts`, although downstream executors already accept and forward them | Add both arrays to the unified schema and conditional descriptions/validation |
| Loop detector flags different reads as identical | Confirmed | High | Stable serialized arguments are truncated to the first 200 characters before comparison, so large wrapper calls that differ later (often in `path`/`files`) collide | Hash the complete normalized argument string; retain a bounded preview separately |
| `scroll_collect_v2` reports “Too many arguments” | Confirmed | High | Playwright `page.evaluate` is called with two positional arguments (`direction`, `multiplier`), while Playwright permits one serializable argument | Pass one object payload to `page.evaluate` and destructure inside the callback |
| Plain `scroll_collect` demanded structured schema | Partly confirmed / misleading surface | Medium | V2 intentionally requires a schema; the unified wrapper exposes V1 and V2 under similar names and one broad parameter bag, making incorrect routing/selection easy. V1 itself does not require a schema | Clarify action contracts, perform action-specific validation, and return an explicit “use scroll_collect for text collection” recovery message |
| 44 fleet metadata warnings | Mixed: real debt + false positives | Medium | 19 entries genuinely have no triggers; 25 descriptions fail an overly narrow regex that does not recognize phrases such as “Use only when” | Improve scoring grammar; exempt explicit-only/compatibility skills from trigger penalties; then preview targeted repairs |

## 1. Unified `skill_ops` trigger-evaluation schema gap

### Evidence

- `src/gateway/tools/defs/cis-system.ts:1315-1376` defines the unified `skill_ops` tool.
- Its schema exposes `triggers`, `addTriggers`, and `removeTriggers`, but not `triggerPositivePrompts` or `triggerNegativePrompts`.
- The same file exposes those fields for older individual skill tools around `:1520`, `:1543`, `:1654`, and `:1696`, proving the capability exists but is absent from the unified wrapper.
- `src/gateway/agents-runtime/subagent-executor.ts:2959-2996` maps `skill_ops` actions to the underlying skill tools without dropping other arguments.
- `src/gateway/agents-runtime/capabilities/skills-executor.ts:714-729` already forwards both prompt arrays for bundle creation.
- `src/gateway/agents-runtime/capabilities/skills-executor.ts:880-887` already forwards both arrays for metadata updates.
- `src/gateway/skills-runtime/skills-manager.ts:663-699` correctly enforces positive/negative evaluations on trigger changes.
- `src/gateway/skills-runtime/skills-manager.ts:833-849` correctly enforces them when creating a bundle.

### Root cause

The runtime and executor support is already implemented. Only the current public unified wrapper schema is incomplete. A model using `skill_ops` cannot legally supply the fields required by the manager, so valid trigger mutations fail and invite unsafe manifest workarounds.

### Exact fix

In `src/gateway/tools/defs/cis-system.ts`, inside the `skill_ops` properties:

```ts
triggerPositivePrompts: {
  type: 'array',
  items: { type: 'string' },
  description: 'Required when create/create_bundle supplies triggers or update_metadata/manifest_write changes triggers. Prompts that must rank the skill first with high confidence.',
},
triggerNegativePrompts: {
  type: 'array',
  items: { type: 'string' },
  description: 'Required when create/create_bundle supplies triggers or update_metadata/manifest_write changes triggers. Unrelated prompts that must not route to the skill.',
},
```

Also update the `triggers`/`addTriggers` descriptions to point to these required companion fields. Do not weaken manager-side enforcement.

### Tests

1. Schema test: `skill_ops` exposes both fields as string arrays.
2. Create-bundle success with valid positive/negative cases.
3. Create-bundle rejection when either set is absent.
4. Metadata trigger update success with valid evaluations.
5. Negative-routing failure remains enforced.
6. Non-trigger metadata updates remain unaffected.

### Risk

Low. The executor path already supports these inputs; this is primarily a schema correction.

---

## 2. Loop-detector false positives for different wrapper calls

### Evidence

`src/gateway/routes/chat.router.ts:3625-3639` normalizes the argument object, serializes it, and then does:

```ts
return JSON.stringify(normalize(args || {})).slice(0, 200);
```

`checkLoopDetection` at `:3641-3653` treats this truncated string as the argument identity. Calls are considered identical when `toolName` and this 200-character prefix match.

Large unified wrappers such as `workspace_read` carry many default fields. Alphabetical key sorting means distinguishing keys or later array entries can occur beyond character 200. Different file paths can therefore receive the same identity.

### Root cause

The value named `argsHash` is not a hash. It is a 200-character prefix. This produces deterministic prefix collisions for structurally similar calls.

### Exact fix

1. Build the complete stable JSON string.
2. Compute a real fixed-length digest over the entire string, for example SHA-256.
3. Store only `{ name, argsDigest }` for comparison.
4. Keep a separately bounded, redacted preview only for diagnostics.

Illustrative shape:

```ts
const stableArgs = (args: unknown): string => JSON.stringify(normalize(args ?? {}));
const hashArgs = (args: unknown): string =>
  createHash('sha256').update(stableArgs(args)).digest('hex');
```

If importing crypto in this route is undesirable, a deterministic non-cryptographic full-string hash is sufficient for loop identity, but SHA-256 is already standard, cheap at this scale, and collision-resistant.

Optional hardening:

- Canonicalize wrapper aliases before hashing only when they are semantically equivalent.
- Do not remove meaningful falsy values such as `false`, `0`, or empty arrays.
- Include the entire ordered files/path payload.
- Add a tool-specific semantic identity hook later only if full argument identity proves too sensitive.

### Tests

1. Two `workspace_read` calls whose first 200 serialized characters match but whose paths differ must not increment the same repeat counter.
2. Two calls with identical deeply nested objects but different key insertion order must count as identical.
3. Identical calls still warn on call 5 and block on call 8.
4. Different entries late in a `files` array remain distinct.
5. `tool_loop_continue` still authorizes the exact digest only.

### Risk

Low to medium. The safety behavior remains intact, but tests must cover the continuation signature and warning thresholds.

---

## 3. `browser_scroll_collect_v2` “Too many arguments” failure

### Evidence

`src/gateway/browser-tools.ts:6220-6411` implements V2. At `:6266-6271` it calls:

```ts
await session.page.evaluate((dir: 'down' | 'up', mult: number) => {
  const pageGlobal = globalThis as any;
  const distance = Number(pageGlobal.innerHeight || 0) * mult;
  pageGlobal.scrollBy(0, dir === 'up' ? -distance : distance);
}, direction, multiplier);
```

Playwright's `page.evaluate` accepts one optional serializable argument after the callback, not multiple positional values. This directly explains the recorded “Too many arguments” runtime error. The literal message is emitted by the Playwright dependency, which is why a search of Prometheus-owned source does not find the string.

### Root cause

A Playwright API contract violation in V2's scrolling branch. The failure appears only after the first extraction pass, when `pass > 0`.

### Exact fix

Pass one object:

```ts
await session.page.evaluate(
  ({ dir, mult }: { dir: 'down' | 'up'; mult: number }) => {
    const pageGlobal = globalThis as any;
    const distance = Number(pageGlobal.innerHeight || 0) * mult;
    pageGlobal.scrollBy(0, dir === 'up' ? -distance : distance);
  },
  { dir: direction, mult: multiplier },
);
```

Search the browser runtime for any other `page.evaluate(fn, arg1, arg2)` patterns and correct them in the same scoped pass if found.

### Tests

1. Unit/static regression check rejects `page.evaluate` calls with more than one post-callback argument.
2. Browser smoke fixture with repeated list items: V2 completes at least two scroll passes.
3. Verify both up and down directions.
4. Verify multiplier affects the expected scroll distance.
5. Verify max-scroll, bottom, timeout, and limit stop reasons.
6. Live smoke on a virtualized feed after build/restart.

### Risk

Low. This is a narrow API-correctness patch.

---

## 4. V1/V2 scroll-collection contract confusion

### Evidence

- `browserScrollCollect` begins at `src/gateway/browser-tools.ts:5957`; it is the generic text/dedupe collector and does not require a structured schema.
- `browserScrollCollectV2` at `:6220` calls `resolveBrowserExtractionSchemaForUrl` and intentionally fails without a schema.
- The resolver at `:9060-9140` returns messages phrased as `browser_extract_structured requires...`, even when called by `browser_scroll_collect_v2`.
- The unified wrapper at `:6523-6574` exposes both `scroll_collect` and `scroll_collect_v2` in one action enum and one shared property bag.
- `src/gateway/agents-runtime/subagent-executor.ts:2403-2451` maps those action strings to different underlying tools.

### Root cause

There are two separate effects:

1. V2's requirement is legitimate, but its resolver emits another tool's name in the error, obscuring which contract failed.
2. The unified wrapper does not explain which action is text-first versus schema-first, and its broad parameter bag makes model/provider argument selection harder.

The recorded statement that plain V1 “demanded structured extraction configuration” is not supported by the current V1 implementation. The likely failure was wrapper action selection/routing confusion or a stale tool definition, not V1's core function.

### Exact fix

1. Give the action enum a detailed description:
   - `scroll_collect`: generic text collection, no schema required.
   - `scroll_collect_v2`: repeated structured item collection, schema or saved schema required.
2. Add action-aware validation in `normalizeBrowserWrapperTool`:
   - If V2 has no `schema`, `schema_name`, `use_schema`, `container_selector`+`fields`, or resolvable item root, return a direct wrapper error before execution.
   - Error should say: “For schema-free text collection, use action=scroll_collect.”
3. Allow the schema resolver to receive a caller label so errors say `browser_scroll_collect_v2 requires...` when invoked from V2 and `browser_extract_structured requires...` for direct extraction.
4. Consider renaming the V2 action in a backwards-compatible way to `scroll_collect_structured`, retaining `scroll_collect_v2` as an alias.
5. Log normalized wrapper target/action in tool telemetry for easier diagnosis.

### Tests

1. Wrapper mapping tests for both actions.
2. V1 succeeds without schema.
3. V2 fails early with a precise recovery message when schema is absent.
4. V2 accepts inline schema, saved schema name, and saved item root.
5. Resolver errors identify the actual caller.
6. Compatibility alias continues to work.

### Risk

Medium if renaming; low if only descriptions, validation, and caller-specific errors are changed.

---

## 5. Forty-four skill metadata warnings

### Current audit breakdown

Rerunning `skill_ops.audit_all` produced:

- **153 scanned**
- **136 active/discoverable**
- **44 flagged**
- **Average score 92**
- **19 skills** with `no_triggers` (eight also lack usage guidance)
- **25 additional skills** flagged only for `description_missing_usage_guidance`

### Evidence for scoring behavior

`src/gateway/agents-runtime/capabilities/skills-executor.ts:81-137` scores metadata. Its usage-guidance check is:

```ts
/\b(use (this|it)|triggers? on|use when|use for)\b/i
```

This misses normal, valid wording such as:

- “Use only when...”
- “Use this skill when...”
- “Use for requests that...” only if punctuation/wording differs
- “Invoke when...”
- “Designed for...”

For example, `x-browser-automation-playbook` has clear usage guidance (“Use only when the user requests live X interaction”) but is still scored as missing guidance.

### Root cause

This is not one homogeneous defect:

1. **Real catalog debt:** 19 entries have no discovery triggers and some descriptions are weak.
2. **Audit false positives:** the regex is too narrow.
3. **Policy ambiguity:** explicit-only, compatibility, low-level, or deprecated skills should not necessarily be penalized for no triggers.
4. **Repair-path contract gap:** bulk `skill_repair_metadata` trigger changes do not currently carry the positive/negative evaluation arrays into `writeManifestOverlay`, so trigger-changing repairs cannot satisfy the manager gate safely.
5. **Duplicated implementation:** audit/repair behavior exists in both the capability executor and the large subagent executor, creating drift risk.

### Exact fix

First fix scoring, then repair metadata. Do not bulk-edit all 44 under the current heuristic.

#### Scoring changes

- Replace the narrow regex with a helper that recognizes at least:
  - `use when`, `use only when`, `use this skill when`, `use it when`
  - `use for`, `use this for`
  - `invoke when`, `trigger when`, `triggers on`, `designed for`
- If `implicitInvocation === false`, do not apply the full `no_triggers` penalty; report an informational `explicit_only_no_triggers` status instead.
- Exclude deprecated/archived/compatibility entries from active-discovery quality totals, or score them under a separate compatibility rubric.
- Return issue counts grouped by actionable debt versus informational status.

#### Metadata repair flow

1. Extend each trigger-changing repair entry with `triggerPositivePrompts` and `triggerNegativePrompts`, and pass them into `writeManifestOverlay`.
2. In preview mode, mark trigger-changing repairs as blocked until both evaluation sets are present.
3. Consolidate audit/scoring/repair execution into one shared module used by both executor paths.
4. Rerun `audit_all` after scorer correction.
5. Preview `repair_metadata`; do not auto-apply generated descriptions/triggers.
6. For each truly active discoverable skill with no triggers, add focused multiword triggers plus positive/negative routing tests.
7. For weak descriptions, edit wording without changing the skill contract.
8. Re-run discovery tests against the complete catalog to check collisions before applying trigger changes.

### Tests

1. “Use only when...” passes guidance scoring.
2. “Use this skill when...” passes.
3. A generic description with no invocation guidance still fails.
4. Explicit-only skills without triggers are informational, not severe.
5. Active discoverable skills without triggers remain actionable failures.
6. Compatibility/deprecated entries are reported separately.
7. A trigger-changing repair without evaluation prompts fails before any write.
8. A repair with passing positive/negative prompts succeeds atomically.
9. Fleet score and flagged counts are deterministic.

### Risk

Medium. Trigger additions can alter routing, so all repairs need positive/negative prompt evaluations. Scorer changes are low risk but affect audit metrics.

---

## Recommended implementation order

1. **Fix the Playwright V2 argument bug.** Narrow, confirmed runtime failure.
2. **Fix loop identity hashing.** Prevents false safety gates across all large wrappers.
3. **Expose trigger evaluation arrays on unified `skill_ops`.** Removes the manifest-edit workaround while retaining safety checks.
4. **Clarify and validate browser collection actions.** Improves recovery and prevents routing confusion.
5. **Correct skill audit scoring.** Then rerun the fleet audit.
6. **Repair only the remaining true metadata debt in reviewed batches.**

## Suggested source scope

Primary code files:

- `src/gateway/browser-tools.ts`
- `src/gateway/routes/chat.router.ts`
- `src/gateway/tools/defs/cis-system.ts`
- `src/gateway/agents-runtime/subagent-executor.ts`
- `src/gateway/agents-runtime/capabilities/skills-executor.ts`

Tests should be added in the repository's existing gateway/tool test surfaces after locating the nearest current suites. Documentation sync:

- `workspace/self/04-browser.md`
- `workspace/self/05-tools.md`
- `workspace/self/14-skills-and-frontend.md`

## Overall conclusion

These failures are worth fixing. The three most important issues are not user error:

- V2 has a concrete Playwright call bug.
- The loop detector compares truncated prefixes instead of full argument identities.
- The unified skill wrapper hides inputs that its own backend requires.

The 44-warning fleet count should not be treated as 44 equally broken skills. Correct the scorer first; then repair the smaller, genuine discovery-metadata backlog under routing tests.
