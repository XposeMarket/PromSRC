# Skill evaluation loop

Use this reference when the skill has objective outputs, non-trivial routing, dependencies, or a meaningful revision history. The goal is evidence about whether the skill improves real execution, not a benchmark whose assertions merely repeat the skill text.

## Routing set

Build a small, realistic set before activation:

- 4–6 positive prompts covering direct, casual, typo-tolerant, and indirect formulations;
- 4–6 negative prompts from adjacent skills, including keyword-sharing near misses;
- at least one explicit skill mention and one prompt that should be rejected by `noneOf`.

Evaluate the structured `promptSignals` result and the final ranked route. Record score, matched phrases/groups, vetoes, confidence, and the selected skill. A positive test should meet `minScore`; a negative should be excluded or lose to the correct owner. Re-run the set after every trigger or description change.

## Workflow set

For a substantive skill, save prompts and expected outcomes outside the skill directory. Run the same task with the candidate skill and a baseline: no skill for a new skill, or a snapshot of the prior skill for a revision. Keep inputs identical and inspect raw artifacts, transcripts, tool usage, and errors. Use disposable fixtures and remove generated outputs after review.

Assertions should be objective and discriminating: exact file type, required fields, valid schema, correct values, required tool or script use, verification evidence, and recovery behavior. Do not treat a filename, a copied phrase, or a confident final sentence as proof. Keep visual, stylistic, or otherwise subjective judgments as human review notes rather than pretending they are binary facts.

When possible, repeat important cases. Record duration, token use, tool calls, failures, and workarounds. Compare mean and variance, not only pass rate. Flag assertions that pass in both configurations, fail in both, or vary widely; these are non-discriminating, broken, or flaky. Read transcripts to find repeated improvised work that belongs in a reusable script or reference.

## Iteration gate

Revise from observed failure modes, then rerun the same cases before expanding coverage. Prefer a general instruction, a stable resource, or a deterministic helper over an overfit example or a pile of rigid MUST/NEVER rules. Preserve the previous version until the new one has passed routing, package, and workflow checks. Report what was measured, what changed, and what remains unverified.
