---
name: "bookmark-to-skill-distiller"
description: "Audit X bookmarks or saved-link corpora, extract repeated operational workflows, compare them with the installed Prometheus skill catalog, and produce ranked evidence-backed new-skill and improvement recommendations. Use for bookmark audits and saved-idea operationalization."
---

# Bookmark-to-Skill Distiller

## 1. Collect

Collect canonical URLs and visible text to a stable-no-new cutoff. Dedupe and record count, boundaries, collection method, and verification drift. Persist raw evidence so later recommendations can be checked.

## 2. Extract

For each candidate, extract workflow, inputs, outputs, tools, checks, failures, and evidence strength. Group duplicates and reject vague inspiration without an operational procedure.

## 3. Dedupe and overlap check

Use `capability-finder` to search installed skill IDs, descriptions, triggers, and resources. Classify each idea as new gap, improve existing, covered, or reject. Record overlap evidence rather than proposing duplicate skills.

## 4. Score

Score frequency, Raul fit, novelty, specificity, leverage, evidence, and maintenance cost using `2*fit + 2*leverage + novelty + frequency + specificity + evidence - maintenance`. Rank recommendations using that same formula.

## 5. Deliver

Deliver the method, ranked evidence links, overlap analysis, input/output contracts, triggers, resources, tests, implementation order, and a rejected appendix. Route approved building through `skill-creator` and baseline/with-skill testing and trigger tuning through `skill-evaluator`.

## 6. Rules

Never auto-install third-party text; adapt useful procedures to current Prometheus policies. Keep the underlying links and extraction evidence attached to each recommendation.
