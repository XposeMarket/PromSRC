# 27) Stage 4 Tool-Menu Trigger Benchmark

Verified 2026-07-12 against canonical `C:\Users\rafel\PromSRC`.

## Scope

Stage 4 conditionally includes five previously always-on menu sections:

| Segment | Trigger | Current savings when omitted |
|---|---|---:|
| `tools.file_edit_routing` | Actual file/source mutation or write-category state | 785 chars / ~197 tokens |
| `tools.run_command_routing` | Actual command/process/test execution | 312 chars / ~78 tokens |
| `tools.proposal_lanes` | Prometheus runtime proposal workflow | 755 chars / ~189 tokens |
| `tools.search_strategy` | Web/current/high-stakes/recommendation research | 1,558 chars / ~390 tokens |
| `tools.business_context` | BUSINESS.md or structured entity workflow | 701 chars / ~176 tokens |
| **Total ordinary unrelated turn** | none | **4,111 chars / ~1,028 tokens** |

The remaining menu is 8,765 characters before activated category policies and tool schemas.

## Inputs

The detector uses no model call. It considers:

- Current user message.
- Four recent user messages.
- Execution mode.
- Active tool categories.
- Required/allowlisted tools.
- Caller requirements.
- Business-context state.

## Modes and rollback

- `PROMETHEUS_STAGE4_INSTRUCTION_MODE=legacy`: include all five sections.
- `PROMETHEUS_STAGE4_INSTRUCTION_MODE=shadow`: preserve legacy output and record decisions.
- `PROMETHEUS_STAGE4_INSTRUCTION_MODE=active`: use deterministic decisions.
- `PROMETHEUS_STAGE4_SEGMENTS`: optional comma-separated segment allowlist for sequential activation.

Default source mode is `active`. Legacy output remains byte-identical when all five intents are true or legacy mode is selected.

## Benchmark

Current suite: 712 labeled prompts.

- 670 synthetic, mixed, adversarial, typo, collision, and high-stakes cases.
- 20 sanitized recent typed examples.
- 22 sanitized recent voice/transcription examples.
- 425 design cases.
- 138 validation cases.
- 149 holdout cases.

Current result: zero false positives and zero false negatives for all five labels across the checked corpus.

The PromSRC-specific holdout added current phrasing such as:

- Retesting after another tool changed code.
- “Make whatever source edits improve it, restart, and keep benchmark testing.”
- Looking for a benchmark file without treating the lookup as a mutation.
- Starting a new Codex chat without mistaking “test message” for a shell test.
- Direct X posting without unnecessarily injecting web-research strategy.
- Marketplace/current-price requests.
- Business-record updates.
- An explicit no-tool instruction even when the legacy auto-activator exposes `workspace_write`.
- File-only routing without leaking command guidance from the broad write category.
- A mixed proposal sentence where the implementation edit appears before the proposal phrase.

## Live canonical gateway validation

The canonical gateway was gracefully restarted from `C:\Users\rafel\PromSRC` and verified healthy under a new PID before the live matrix.

Seven isolated, no-action chat sessions then verified the prompt manifest immediately before provider dispatch:

- Neutral: no conditional section.
- File: file-edit routing only.
- Command: command routing only.
- Runtime proposal: proposal lanes only.
- Current web research: search strategy only.
- Business record: business context only.
- Mixed: all five sections.

The first live pass exposed and fixed three interactions not represented in the original corpus: negated tool use inherited a broad write category, generic turn-origin metadata was mistaken for a command requirement because it mentioned the local shell, and proposal phrasing could mask an earlier implementation edit. The affected cases were added to the holdout suite and passed after restart/retest.

## Verification gates

- Intent benchmark.
- Sequential positive/negative segment activation.
- Exact legacy restoration.
- All-positive legacy parity.
- Instruction resolver regression.
- Prompt-manifest regression.
- Tool-category manifest/parity regression.
- Static private/public category validation.
- Full TypeScript build.
- Canonical live gateway restart and active trigger matrix; exact legacy restoration remains covered by byte-parity regression.
