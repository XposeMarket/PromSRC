---
name: "skill-creator"
description: "Create, revise, review, validate, and benchmark Prometheus skills and bundles, including SKILL.md instructions, resources, manifests, tool contracts, recovery paths, verification, and structured prompt routing. Use for explicit requests to make, update, improve, recreate, repair, or test a skill or its triggers."
---

# Skill Creator

Use this skill only after an explicit user request to create, change, review, or test a skill. The outcome is a focused, discoverable, executable skill whose instructions, metadata, resources, routing, and verification agree.

## Authority and evidence

- A direct user request authorizes the requested skill edit. Inspect overlap, make the smallest coherent change, and validate it.
- A reusable lesson noticed during ordinary work is not authorization. Identify the owning skill and ask through `ask_prometheus_questions`; submit `skill_candidate_submit` only when the user asks to capture the lesson. Use `skill_curator` for review or governed application.
- Treat user messages as evidence of preferences and approval. Do not infer approval from assistant summaries, successful tool calls, or repeated wording.
- Decline skills that would enable unauthorized access, deception, malware, exfiltration, or other surprising behavior.

## Creation workflow

1. **Capture the contract.** Extract the job, inputs, observable outcome, output/artifact, dependencies, platform limits, examples, success criteria, and likely positive and negative trigger prompts. Ask only for missing decisions.
2. **Search overlap.** Call `skill_list` with a task-shaped query, then `skill_read` for the strongest candidate and `skill_inspect` when metadata, health, ownership, or resources matter. Prefer narrowing an existing skill, adding a resource, or merging work over creating a broad duplicate.
3. **Design the playbook.** State the outcome, preflight gates, exact tool/category contract, numbered primary path, evidence and success condition for every step, known recovery branches, final verification, delivery, and cleanup. Use imperative instructions and explain why a fragile step matters.
4. **Choose the package.** Use `skill_create` for a genuinely self-contained one-file skill. Use `skill_create_bundle` when schemas, examples, scripts, templates, or references are needed; write them with `skill_resource_write`. Give `SKILL.md` as much space as the workflow needs; use one-level-deep linked resources when selective loading, reuse, or maintenance benefits from separation. Keep frontmatter to `name` and `description`, and do not add README, changelog, or setup-guide clutter.
5. **Implement with the native contract.** For an existing skill use `skill_update_from_source` for an upstream refresh, `skill_update_metadata` for a metadata overlay, or `skill_manifest_write` for a reviewed manifest patch. Use `skill_resource_list`/`skill_resource_read` before changing resources and `skill_resource_delete` only when removal is authorized. Preserve upstream source and record local overlays.
6. **Author routing as policy.** Keep legacy `triggers` to high-confidence multiword phrases (maximum 12). In `skill.json`, use `promptSignals` with `phrases`, alternative `allOf` groups, `anyOf`, vetoing `noneOf`, and `minScore`. A phrase scores 4, each term in a matched `allOf` group scores 2, each `anyOf` term scores 1, and any `noneOf` match excludes; matching requires `score >= minScore`. Use `implicitInvocation: false` for broad, role, style, or manual skills. Test positive, negative, and near-miss prompts before widening routing.
7. **Validate and iterate.** Call `skill_read`, `skill_inspect`, and `skill_audit_all`; verify frontmatter, manifest parity, resource paths, limits, ownership, health, and the final artifact. For metadata or routing changes, provide `triggerPositivePrompts` and `triggerNegativePrompts` (or the prompt-signal aliases) to the mutation tool. For `skill_repair_metadata`, preview first and apply only with reviewed repairs and `confirm:true`. Use the [evaluation loop](references/evaluation-loop.md) for baseline/with-skill comparisons, objective assertions, qualitative review, timing, tokens, and variance; never claim an untested dependency-backed path is ready.

## Tool contract

The normal authoring surface is `skill_list` → `skill_read`/`skill_inspect` → `skill_create` or `skill_create_bundle` → `skill_resource_write` → `skill_manifest_write`/`skill_update_metadata` → `skill_audit_all`. Use `skill_import_bundle`, `skill_export_bundle`, or `skill_update_from_source` only when the source boundary is explicit. Keep `skill_candidate_submit`, `skill_curator`, and `skill_repair_metadata` inside their evidence and confirmation gates.

## Completion

Report the skill ID and exact changed resources, the routing tests and validation gates run, any known limitations or unverified paths, and whether the change is a direct user-authorized edit or a Curator candidate. Leave no disposable eval artifacts in the skill directory.
