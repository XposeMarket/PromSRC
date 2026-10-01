---
name: architecture-deepening
description: Scan a codebase (weighted toward recent hot spots) for shallow modules and leaky seams, present ranked deepening candidates as a visual report, then work the chosen one through question cards while keeping a domain glossary and ADRs current. Use for "improve the architecture", "where is this codebase hard to change", "deepen these modules", or sharpening domain terms. Not for small cleanups of a recent diff (code-simplifier), bug fixing, or first-time orientation (codebase-onboarding).
---

# Architecture Deepening

Aim: make the code easier to change, test, and navigate (for humans and agents) by turning shallow modules into deep ones: a small interface hiding a lot of behavior.

## Vocabulary (use these words exactly)

- **Module**: any unit with an interface and an implementation (function, class, file, package).
- **Interface**: everything a caller must know to use it. **Depth**: behavior hidden per unit of interface. A shallow module has an interface nearly as complex as its body.
- **Seam**: a boundary where behavior can be observed or swapped without editing inside. **Adapter**: an implementation plugged into a seam. One adapter means a hypothetical seam; two means a real one.
- **Locality**: related logic and its bugs live together. **Leverage**: how much behavior one interface change affects.
- **Deletion test**: imagine deleting the module and inlining it into callers. If complexity concentrates, it was earning its keep; if it merely moves around, it was shallow.
- The interface is the test surface: tests belong at deep modules' interfaces.

Use the project's domain terms (from `GLOSSARY.md` or `CONTEXT.md` if present) for names, not generic words like "service" or "handler".

## 1. Scope before scanning

- If the user named an area or pain point, start there.
- Otherwise find hot spots: `workspace_git(action:"log")` over a long stretch, plus a `workspace_run` count of most-changed files (PowerShell: `git log --since=6.months --name-only --pretty=format: | ? { $_ } | Group-Object | Sort-Object Count -Descending | Select-Object -First 25 Count,Name`). Weight attention toward what keeps changing (YAGNI: deepening pays off only where change happens).
- Read the glossary and any ADRs (`docs/adr/`) in the area. Do not re-propose what an ADR rejected unless the friction is severe; mark such candidates clearly.

## 2. Explore for friction

Explore yourself or spawn 1 to 2 explorers with `background_ops(action:"spawn", provider:"openai_codex", model:"gpt-6-sol")` (never Anthropic workers from an Anthropic main chat), with a reporting contract of file:line evidence. Look for:

- Understanding one concept requires bouncing across many tiny modules.
- Interfaces nearly as complex as their implementations.
- Pure functions extracted for testability while the real bugs live in how they are called (no locality).
- Coupled modules leaking across seams; the same few parameters travelling together.
- Code that is untested or untestable through its current interface.

Apply the deletion test to every suspect.

## 3. Present candidates visually

Write a self-contained HTML report to `plans/architecture-review-<date>.html` (not in the repo) and report the absolute path; for a short list, an inline `html` or `mermaid` visual in chat also works. Use Prometheus theme tokens (`--prom-surface`, `--prom-text`, `--prom-accent`) rather than hardcoded colors. Per candidate:

- Files or modules involved; the problem (friction, in plain words); the proposed change in plain words.
- Benefits in terms of locality, leverage, and how tests improve.
- A before/after diagram (Mermaid for graph-shaped relationships, simple boxes otherwise).
- Strength badge: Strong, Worth exploring, or Speculative. ADR conflicts shown as a warning callout.

End with a top recommendation and why. Do not design interfaces yet. Then ask via `ask_prometheus_questions` which candidate to explore, recommended one first.

## 4. Work the chosen candidate

Run the decision tree with the `requirements-grilling` method (one card at a time, recommended answer first): constraints, dependents, the shape of the deepened module, what sits behind the seam, which tests survive or move. To compare interface shapes, spawn 2 to 3 openai_codex workers each designing a radically different interface for the same module, then compare them side by side.

Keep the domain model current as decisions land (domain-modeling discipline):

- Challenge terms that conflict with the glossary; propose precise terms for fuzzy ones; test boundaries with concrete edge-case scenarios; check the code agrees with what the user says.
- Update `GLOSSARY.md` immediately when a term is settled (create it lazily). Format: context heading, one-line description, then `**Term**: one to two sentence definition` with `_Avoid_: synonyms`. Only project-specific concepts; no implementation details.
- Offer an ADR (`docs/adr/NNNN-<slug>.md`: context, decision, consequences) only when the decision is hard to reverse, surprising without context, and the result of a real tradeoff. When a candidate is rejected for a lasting reason, offer an ADR so future reviews do not re-suggest it.

Glossary and ADR edits are repo writes: confirm with the user before committing them, and follow `promsrc-pr-worktree` for Prometheus source.

## 5. Hand off

Write the agreed design into `spec-writing` or straight into `implementation-plan-writing` (prefactor tasks first, expand then contract for wide changes). Record a `write_note` with the report path and decisions.

## Exit criteria

Report saved with ranked, evidence-backed candidates; the user chose one; its decisions, glossary updates, and any ADR are written; a spec or plan is the next artifact.

Lineage: Inspired by mattpocock/skills improve-codebase-architecture and domain-modeling, rewritten for Prometheus.
