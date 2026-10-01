---
name: "skill-creator"
description: "Design or revise a focused Prometheus skill when the user asks to create, update, improve, review, or troubleshoot a skill, or asks to turn what was just done into a reusable skill. Do not fire after ordinary workflows the user did not ask to capture; route inferred lessons through candidate submission and Brain Curator review instead."
---

# Skill Creator

Design small, precise skills without recreating the catalog feedback loop.

## Authority boundary

There are two distinct paths:

1. **Direct user request:** the user explicitly asks to create or edit a skill. Inspect overlap, propose the focused change, then perform the authorized mutation and validate it.
2. **Learned candidate:** a workflow, Thought, Dream, cleanup, or normal chat suggests a reusable lesson. Submit a structured candidate with `skill_candidate_submit`. Do not create or update skill files.

Brain Curator (the `skill_curator` tool: status, run, apply, reject) is the sole automatic writer. Candidate approval for a new skill authorizes design/proposal work only; it does not itself create the skill. Instruction, trigger, resource, and new-skill changes remain pending review unless the user directly requested the edit. Exact non-behavioral metadata repairs may use the Curator's safe path.

## Evidence gate

Treat only user messages as evidence of user preference or approval. Assistant summaries, praise, completion claims, tool count, and repeated assistant wording are not evidence. Do not infer approval from assistant summaries, successful tool calls, or the absence of an objection.

Submit a learned candidate only when supported by either:

- explicit user language such as “remember this” or “use this next time”; or
- repeated evidence across distinct sessions.

Record tool failures and successful validation as separate signals. Attach source session IDs and concise evidence; never infer confidence from the number of tool calls.

## Design workflow

1. Define one focused job and its observable output.
2. Search the catalog for overlap. Prefer narrowing, merging into, or adding a resource to an existing skill over creating another broad entrypoint.
3. Write a narrow, third-person description saying when to use the skill and when not to use it, with concrete symptoms and likely user phrasings. Be somewhat assertive because skills under-trigger. Do not summarize the procedure in the description: agents can follow that summary and skip the body. Avoid generic single-word triggers.
4. Structure the body as a 2 to 3 sentence intro, When to use / Do not use, numbered Procedure (each step ends with a checkable completion criterion), Guardrails, and Exit criteria. Explain why rules matter instead of stacking MUST; state target behavior positively, reserving prohibitions for hard guardrails. Use one strong leading word per rule, remove no-op instructions, and maintain one source of truth per rule. Name real Prometheus tools rather than raw shell equivalents; omit machine-local paths. A skill consisting only of pointers to other skills is a router, not a useful skill. Keep `SKILL.md` around 500-750 words where practical. Move schemas, background, detailed examples, and provider variants into stable canonical resources such as a real, bundled topic-specific reference file.
5. Set broad role, style, and manually invoked skills to `implicitInvocation: false`.
6. Test positive and negative prompts before activating triggers. For any behavioral skill, hand the draft to `skill-evaluator` for baseline vs with-skill evaluation and trigger tuning before marking a new skill `lifecycle: active`. Reuse its query set as `triggerPositivePrompts` and `triggerNegativePrompts`; `skill_ops(action:"create_bundle")` requires both prompt sets and rejects single generic words in `promptSignals.anyOf`. At most one high-confidence match should be mandatory; other matches remain suggestions.
7. Run any bundled script or dependency against a disposable fixture. If it fails, record the failure and exact correction needed; do not claim the capability works.
8. Validate frontmatter, manifest parity, resource paths, routing, and catalog health.

For a direct "turn this into a skill" request, draft from the current session's successful procedure first: capture actual tools used, step order, corrections, checks, and observed failure modes. Ask only about remaining gaps with `ask_prometheus_questions`; do not make the user reconstruct the workflow. Before creating or revising, use `skill_list` and `skill_read` to check overlap, then use `skill_ops(action:"create_bundle")`, `skill_ops(action:"update_metadata")`, `skill_ops(action:"manifest_write")`, or `skill_ops(action:"repair_metadata")` as appropriate. A skill inspired by an external source must pass `external-skill-vetting` and carry a `Lineage:` line.


## Candidate shape

For inferred improvements, call `skill_candidate_submit` with:

- candidate type;
- existing skill ID when applicable;
- concrete observed problem;
- proposed focused change;
- evidence/session references;
- confidence and trigger context.

Use `create_new_skill_candidate` only after overlap analysis shows no existing skill can absorb the job. Curator clusters equivalent candidates and suppresses rejected or duplicate suggestions.

## Do not

- Create or update a skill after every successful workflow.
- Use assistant text as user approval or preference evidence.
- add dated resource filenames for recurring lessons;
- activate broad triggers without positive and negative routing tests;
- duplicate instructions across `SKILL.md` and references;
- auto-apply behavioral changes merely because they look harmless;
- mark an untested dependency-backed skill ready.
