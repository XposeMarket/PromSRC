---
name: "skill-creator"
description: "Design or revise a focused Prometheus skill when the user explicitly asks to create, update, improve, review, or troubleshoot a skill. Route inferred reusable lessons through candidate submission and Brain Curator review; do not mutate skills after ordinary workflows."
---

# Skill Creator

Design small, precise skills without recreating the catalog feedback loop.

## Authority boundary

There are two distinct paths:

1. **Direct user request:** the user explicitly asks to create or edit a skill. Inspect overlap, propose the focused change, then perform the authorized mutation and validate it.
2. **Learned candidate:** a workflow, Thought, Dream, cleanup, or normal chat suggests a reusable lesson. Submit a structured candidate with `skill_candidate_submit`. Do not create or update skill files.

Brain Curator is the sole automatic writer. Candidate approval for a new skill authorizes design/proposal work only; it does not itself create the skill. Instruction, trigger, resource, and new-skill changes remain pending review unless the user directly requested the edit. Exact non-behavioral metadata repairs may use the Curator's safe path.

## Evidence gate

Treat only user messages as evidence of user preference or approval. Assistant summaries, praise, completion claims, tool count, and repeated assistant wording are not evidence.

Submit a learned candidate only when supported by either:

- explicit user language such as “remember this” or “use this next time”; or
- repeated evidence across distinct sessions.

Record tool failures and successful validation as separate signals. Attach source session IDs and concise evidence; never infer confidence from the number of tool calls.

## Design workflow

1. Define one focused job and its observable output.
2. Search the catalog for overlap. Prefer narrowing, merging into, or adding a resource to an existing skill over creating another broad entrypoint.
3. Write a narrow description with clear positive and negative scope. Avoid generic single-word triggers.
4. Keep `SKILL.md` around 500–750 words where practical. Move schemas, background, detailed examples, and provider variants into stable canonical resources such as `references/recovery.md` or topic-specific files.
5. Set broad role, style, and manually invoked skills to `implicitInvocation: false`.
6. Test positive and negative prompts before activating triggers. At most one high-confidence match should be mandatory; other matches remain suggestions.
7. Run any bundled script or dependency against a disposable fixture. If it fails, record the failure and exact correction needed; do not claim the capability works.
8. Validate frontmatter, manifest parity, resource paths, routing, and catalog health.

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
