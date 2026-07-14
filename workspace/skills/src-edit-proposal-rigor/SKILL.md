---
name: "src-edit-proposal-rigor"
description: "Apply Prometheus self-source approval, proposal, scope, sandbox, verification, and promotion policy to changes under the Prometheus codebase. Use when governance of a Prometheus source edit is the primary concern; use file-surgery for ordinary workspace edits."
---

# Prometheus source-edit rigor

Treat self-source work as an engineering change with an explicit authority boundary.

1. Confirm the requested behavior, canonical source path, mutation scope, and whether the route is direct, approval-gated, proposal-based, or sandboxed.
2. Inspect current source, repository instructions, related runtime paths, and dirty state. Preserve unrelated changes.
3. Choose the smallest coherent patch and state its acceptance evidence.
4. Edit canonical source, not generated copies; regenerate through supported commands where required.
5. Run the narrowest relevant lint/test/build, then expand when risk warrants it.
6. Compare failures with the pre-change baseline and repair only regressions caused by the patch.
7. Promote sandboxed work only after scope and validation gates pass.
8. Report changed paths, tests, baseline issues, and remaining risks.

Never bypass approval, broaden scope silently, or equate a successful write with a working feature.

Read [detailed-guide.md](references/detailed-guide.md) for proposal lanes, tool routing, repo architecture facts, sandbox/promotion rules, and validation matrices. Load a background note only for the matching historical edge case.
