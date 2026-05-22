# Example: Source Proposal — Convert a Special Runtime into a Normal Tool Category

Use this example when Raul asks for a concrete `src/` proposal that removes an over-specialized runtime/mode and folds the capability back into normal Prometheus main-chat tool routing.

## Scenario

Raul identified that Creative Mode had become too much of a separate assistant/runtime: `switch_creative_mode` changed persistent session state, prompt profiles, context injection, isolated runtime behavior, and tool availability. The desired product direction was to make Creative behave like a normal main-chat tool category, with behavior guided by skills instead of special prompt/runtime swaps.

## Investigation pattern

Before writing the proposal, inspect exact source surfaces instead of relying on memory:

1. Read `SELF.md` Creative Modes section to understand documented architecture and expected behavior.
2. Grep source for creative runtime switches and mode state, for example:
   - `isolatedCreativeRuntime`
   - `creativeMode`
   - `switch_creative_mode`
   - `creativePromptProfile`
   - `creative-handoff`
3. Read exact source files and line ranges where runtime routing occurs.
4. Identify which code should change now versus which tool/editor code should remain intact.

Example evidence targets from the May 2026 Creative proposal:

- `src/gateway/routes/chat.router.ts`
  - Chat-context assembly detects `isolatedCreativeRuntime` and alters normal chat behavior.
  - Creative sessions use special creative prompt profiles/tool routing rather than plain main-chat category use.
- `src/gateway/prompt-context.ts`
  - Creative runtime prompt/profile injection adds separate Creative instructions/context.
- Creative editor/tool files
  - Should generally remain intact; the goal is not to delete Creative tools, but to remove special runtime identity/routing.

## Proposal shape

Use the required `src-edit-proposal-rigor` sections exactly:

```md
## Why this change
- Problem statement: Creative currently behaves like a separate runtime/mode instead of a normal tool category.
- Why current behavior is insufficient: it creates prompt/context leakage, competing routing systems, and confusing mode-state failures.
- Source evidence: cite `SELF.md`, `chat.router.ts`, `prompt-context.ts`, and any related tool-builder/runtime files with line ranges.

## Exact source edits
- `src/gateway/routes/chat.router.ts`:
  - Remove/neutralize creative-mode prompt-profile/runtime branching from normal `handleChat` flow.
  - Preserve regular tool-category activation so `creative_mode` tools remain available when requested.
- `src/gateway/prompt-context.ts`:
  - Remove special Creative prompt-profile injection as a runtime identity switch.
  - Keep normal main-chat instructions and rely on skills for Creative workflows.
- Any compatibility surface:
  - Keep `switch_creative_mode` only as a workspace/editor compatibility shim if necessary, or replace its behavior with editor-state-only semantics.

## Deterministic behavior after patch
- Main chat remains the assistant runtime for Creative tasks.
- Creative tools can be activated/used as a normal category.
- Skills guide whether to use `generate_image`, Creative HTML Motion, HyperFrames, Remotion, etc.
- No separate Creative prompt profile or isolated creative chat context is injected.
- Existing Creative editor state, saved scenes, assets, templates, QA, and exports remain available.

## Acceptance tests
1. Build/typecheck succeeds.
2. Start/restart gateway.
3. Ask a normal architecture/product question after a Creative task; response should stay in main-chat behavior.
4. Ask for a small Creative/HyperFrames video; assistant should use skills + Creative tools without entering a separate runtime persona.
5. Verify `switch_creative_mode` no longer causes prompt-mode drift, or is clearly editor-state-only if retained for compatibility.

## Risks and compatibility
- Risk: existing UI flows may expect `creativeMode` session state.
- Risk: tools may assume a mode-specific runtime context.
- Mitigation: preserve editor/workspace state APIs while removing only prompt/runtime identity switching.
- Rollback: restore prior runtime branch if Creative tools fail to activate in main chat.
```

## Executor prompt guidance

The executor prompt should be action-oriented and deterministic:

- Apply only the listed source edits.
- Do not delete Creative tools/editor/export systems.
- Preserve `creative_mode` as a tool category.
- Remove prompt/runtime/persona switching from chat flow.
- Run build/tests.
- Report exact files changed and any compatibility shims retained.
- Stop and report if source evidence contradicts the proposed line ranges or if tool activation depends on the runtime branch being removed.

## Why this example matters

When removing an over-specialized runtime, the desired result is not “delete the feature.” It is “collapse the feature back into normal Prometheus architecture.” The proposal must be precise about preserving functional tools while removing identity/context/mode switching.