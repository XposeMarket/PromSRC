---
name: "skill-creator"
description: "Create and revise executable Prometheus workflow skills: concrete fast paths with required tools, exact sequencing, recovery, verification, and artifacts. Use when a user asks to create, update, improve, review, or troubleshoot a skill."
---

# Skill Creator

Skills are **operational fast paths**, not lightweight descriptions of a job. A person or agent reading one should be able to execute the workflow without guessing which tools, category activations, files, checks, or recovery path to use.

A narrow skill means **narrow entry conditions and routing scope**. It does **not** mean vague, skeletal, or under-specified execution instructions. Once the skill matches, it should be concrete and complete for its job.

## Authority boundary

Two paths exist:

1. **Direct user request:** When the user explicitly asks to create, change, or improve a skill, inspect overlap, implement the requested change, and validate it.
2. **Learned candidate:** When normal work reveals a reusable lesson without an explicit skill-edit request, submit an evidence-backed `skill_candidate_submit` candidate. Do not silently modify skill files.

Brain Curator is the only automatic writer. User-directed skill edits are allowed immediately; learned behavior changes remain candidates unless the user authorizes the edit.

## What every execution skill must contain

Write the skill as a runnable playbook. Include all items that materially affect a successful run:

- **Outcome:** what done looks like and the expected artifact, state change, or user-facing result.
- **Preflight:** required access, input, local files, browser/app state, environment, platform limits, and decision gates.
- **Tool contract:** exact Prometheus tool categories to activate and exact tool names to use. Name ordered calls, important arguments, paths, URLs, and any required tool output to inspect. Do not make the reader infer “use browser tools” or “edit the file somehow.”
- **Primary workflow:** numbered steps in actual execution order. Each step says what to do, with what tool, what evidence to read, and the success condition before advancing.
- **Recovery:** known failures, likely causes, exact alternative tool/path, and when to stop versus retry. A skill must preserve proven workarounds, not merely say “troubleshoot.”
- **Verification:** concrete checks for the final artifact or live state. For visual/browser/desktop work, specify fresh screenshot or snapshot proof. For code, specify the relevant tests/build/sync gates. For delivery, verify the exact target and exact artifact path.
- **Completion and hygiene:** durable notes, entity/document updates if applicable, delivery/reporting, and browser/session cleanup when relevant.

Use specific values only when they are stable and verified. Put provider variants, long command templates, schemas, API payloads, sample prompts, and detailed error tables in named resources, then link them from the exact step that uses them.

## Design workflow

1. **Define the job and contract.** State the input, outcome, and boundaries. Search the catalog first with `skill_list`; merge into an existing skill or add a resource when it already owns the workflow.
2. **Map the real fast path.** Base the playbook on an actually executed or source-verified workflow. List every required tool/category, app surface, file path convention, and validation gate. If the route is unproven, label it as unverified rather than inventing instructions.
3. **Write the execution path.** Use numbered, imperative steps. Each operational step follows this shape: **tool/action → input/state to inspect → expected result → next action**. Include commands or exact tool-call patterns where they eliminate ambiguity.
4. **Encode recovery and verification.** Capture the failures that caused detours in real runs and the path that fixed them. Define objective acceptance checks, not “make sure it works.”
5. **Keep routing precise, not execution thin.** Give the description and triggers clear positive and negative scope. Avoid generic single-word triggers. Broad role/style/manual skills should set `implicitInvocation: false`.
6. **Package detail correctly.** Keep `SKILL.md` readable, usually 500–1,200 words when practical. Split genuinely large or volatile content into stable `references/`, `examples/`, `templates/`, `schemas/`, or `scripts/` resources. Do not duplicate the same instructions in both places.
7. **Validate the skill.** Test positive and negative prompts, frontmatter, manifest parity, resource paths, and catalog health. Run any dependency-backed script or procedure against a disposable fixture. Record exact failures and recovery conditions; never claim an untested path is ready.

## Tool-contract standard

A good skill tells the executor something like:

> Activate `browser_automation`; call `browser_session` for the existing Chrome session; use `browser_observe` to anchor on the target page; perform the named click/fill; capture `browser_vision_screenshot` after the state changes; use `delivery_send` only after the exact exported path exists.

A bad skill says:

> Open the browser, process the video, and verify it.

The first is reusable execution. The second just relocates the guesswork.

## Evidence and safety

Only user messages prove user preferences or direct authorization. Assistant summaries, tool-call volume, and completion text do not. For candidate submissions, include concrete user language or repeated cross-session evidence, plus source-session references.

Never activate broad triggers without positive and negative routing tests. Do not create a new skill merely because a workflow succeeded once. Do not mark dependency-backed capabilities ready before they have been exercised. Do not use dated resource filenames for recurring guidance.

The standard is simple: **a matching skill should let Prom move immediately through the known best path, with the necessary tools, proof, and recovery already spelled out.**