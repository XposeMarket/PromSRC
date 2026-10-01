---
name: "skill-evaluator"
description: "Test whether a Prometheus skill actually changes agent behavior: run with-skill versus baseline A/B evals through background agents, grade outputs against assertions, tune triggers with should-fire and near-miss prompts, and tighten the skill text. Use when the user asks to test, benchmark, evaluate, A/B, or tune triggering for a skill, or before activating a new or rewritten skill. Do not use for first-draft skill design (skill-creator) or safety vetting of an external bundle (external-skill-vetting)."
---

# Skill Evaluator

A skill is untested until an agent has been watched failing without it and succeeding with it. This is test-first development for instructions: the baseline run is the failing test, the skill is the fix, and every edit afterward is a refactor that must keep the tests green.

## 1. Frame the eval

1. `skill_read(id)` the skill under test. If improving an existing skill, copy its folder to `reviews/skill-evals/<id>/snapshot/` first; the snapshot is the baseline.
2. Classify the skill, because the test shape follows from it:
   - **Discipline** (a rule agents skip under pressure): test with pressure scenarios that stack time pressure, sunk cost, and a plausible excuse.
   - **Technique** (a how-to): test with an application case, a variation, and a case with missing information.
   - **Pattern** (when to apply a mental model): include counter-examples where it should not apply.
   - **Reference** (lookup material): test retrieval and correct application.
3. Write 2 to 4 realistic prompts, the way Raul would actually type them, with concrete paths, names, and casual phrasing. Save to `reviews/skill-evals/<id>/evals.json` as `{id, name, prompt, expected_output, assertions: []}`.

Done when each prompt has a descriptive name and a one-line statement of what good output looks like.

## 2. Run with-skill and baseline in the same turn

For every prompt, spawn two workers in one tool-call block with `background_ops(action:"spawn")`:

- **with_skill:** the prompt plus "First call skill_read('<id>') and follow it."
- **baseline:** the identical prompt with no skill pointer (new skill), or pointed at the snapshot path (revised skill).

Route both with the same model so the skill is the only variable: `provider:"openai_codex"`, `model:"openai_codex/gpt-6-sol"`, `reasoning_effort:"medium"`. Never spawn Anthropic models while the main chat runs on Anthropic. Pass `tool_categories` the task needs. Each prompt must be fully self-contained and must say where to write outputs: `reviews/skill-evals/<id>/iteration-<N>/<eval-name>/<with_skill|baseline>/`.

While they run, draft assertions: objectively checkable, named so a glance explains them ("cites at least two fetched URLs", "asks via ask_prometheus_questions, not prose"). Subjective qualities (tone, design taste) get human review instead of forced assertions.

Then `background_ops(action:"wait")`. Record each worker's duration and token figures from its result into `timing.json` the moment it lands; that data is not kept elsewhere.

## 3. Grade and compare

1. Grade each run against its assertions into `grading.json` with fields `text`, `passed`, `evidence`. Script any check that can be scripted.
2. Read transcripts, not only final outputs. Wasted steps the skill caused are findings.
3. Summarize per configuration: pass rate, time, tokens, and the delta. Flag assertions that pass in both arms (they do not discriminate) and evals with high variance (flaky).
4. For a contested "is v2 better?", spawn a blind judge: give it both outputs labelled A and B, never which is which, and ask for a verdict with reasons.
5. Show the user a compact table plus the notable outputs, then collect feedback with `ask_prometheus_questions` (per-eval: good / needs work / wrong, with an Other field).

## 4. Improve, then rerun

Match the fix to the failure observed in the baseline or the failing arm:

| Failure seen | Right form of fix |
|---|---|
| Agent knew the rule but skipped it under pressure | Firm rule plus the exact excuses it used, each answered |
| Right behavior, wrong output shape | A positive output contract: the parts, in order |
| A required element left out | A required slot in the template, not a prose reminder |
| Behavior should depend on a condition | A conditional keyed to an observable fact |

Writing rules while editing: explain why instead of shouting MUST; state the target behavior positively; cut sentences that do not change behavior versus the default; end each step on a checkable completion criterion; keep SKILL.md lean and move branch-only material to `references/`. Generalize from the evals; never patch narrowly to pass one prompt.

Rerun everything into `iteration-<N+1>`. Stop when the user is satisfied, feedback is empty, or two iterations show no meaningful gain.

## 5. Tune triggering

1. Write about 16 to 20 queries: 8 to 10 should-fire with varied phrasing and no skill name, and 8 to 10 near misses that share keywords but need a neighboring skill. Obvious non-matches teach nothing.
2. Run each through `skill_list(query)` and record whether the skill ranks first with high confidence.
3. Adjust `description`, `triggers`, and `promptSignals` (phrases, allOf, anyOf, noneOf, minScore) in `skill.json`. The description says when to use and when not to; it must not summarize the workflow, or agents follow the summary and skip the body. Add neighbor-specific terms to `noneOf` to stop collisions.
4. Re-run the query set. Target: every should-fire ranks first; no near miss ranks the skill first.

## Authority

Editing the skill under test needs a direct user request. When the user did not ask for edits, deliver findings and file them with `skill_candidate_submit` for Curator review. Trigger changes made through `skill_ops` require `triggerPositivePrompts` and `triggerNegativePrompts`; reuse the step 5 sets.

## Exit criteria

- Every eval has with-skill and baseline outputs on disk for the final iteration.
- A results table shows pass rate and time/token deltas, with non-discriminating assertions named.
- The trigger query set and its pass/fail results are saved next to the evals.
- The report states plainly whether the skill beats baseline, and by how much.

Lineage: inspired by anthropics/skills skill-creator (eval and description-optimization loop), obra/superpowers writing-skills (test-first skill writing), and mattpocock writing-for-agents (pruning and completion criteria), rewritten for Prometheus.
