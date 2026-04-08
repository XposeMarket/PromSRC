# Legacy Reference Sweep (2026-03-27)

Scope: hardcoded `*.md` references found under `src/`, cross-checked against files present under `workspace/`.

## Likely Stale References (missing anywhere in workspace)
- IDENTITY.md — refs: 19 — samples: src\config\soul-loader.ts:251, src\config\soul-loader.ts:251, src\tools\memory-file-search.ts:5, src\tools\memory-file-search.ts:51
- ROUTING.md — refs: 5 — samples: src\config\config.ts:584, src\config\config.ts:585, src\config\config.ts:588, src\gateway\prompt-context.ts:462

## Missing Anywhere (review required: some may be generated/optional)
- CHANGELOG.md — refs: 3 — samples: src\gateway\agents-runtime\subagent-executor.ts:292, src\gateway\agents-runtime\subagent-executor.ts:424, src\gateway\tools\defs\file-web-memory.ts:146
- findings-backlinks.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:88, src\tools\deploy-analysis-team.ts:111, src\tools\deploy-analysis-team.ts:289
- findings-content.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:102, src\tools\deploy-analysis-team.ts:112, src\tools\deploy-analysis-team.ts:289
- findings-geo.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:76, src\tools\deploy-analysis-team.ts:110, src\tools\deploy-analysis-team.ts:289
- findings-performance.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:62, src\tools\deploy-analysis-team.ts:109, src\tools\deploy-analysis-team.ts:289
- findings-seo.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:45, src\tools\deploy-analysis-team.ts:108, src\tools\deploy-analysis-team.ts:289
- full-report.md — refs: 3 — samples: src\tools\deploy-analysis-team.ts:114, src\tools\deploy-analysis-team.ts:145, src\tools\deploy-analysis-team.ts:228
- HEARTBEAT.md — refs: 52 — samples: src\agents\reactor.ts:534, src\agents\reactor.ts:549, src\config\config.ts:170, src\config\config.ts:563
- history.md — refs: 7 — samples: src\gateway\agents-runtime\agent-builder-integration.ts:627, src\gateway\agents-runtime\agent-builder-integration.ts:632, src\gateway\agents-runtime\agent-builder-integration.ts:655, src\gateway\agents-runtime\agent-builder-integration.ts:669
- HOOK.md — refs: 1 — samples: src\gateway\hook-loader.ts:56
- intraday-notes.md — refs: 9 — samples: src\gateway\boot.ts:49, src\gateway\agents-runtime\subagent-executor.ts:2448, src\tools\memory-file-search.ts:57, src\tools\write-note.ts:38
- MEMORY.md — refs: 24 — samples: src\config\config.ts:575, src\config\soul-loader.ts:16, src\config\soul-loader.ts:17, src\config\soul-loader.ts:253
- nHEARTBEAT.md — refs: 1 — samples: src\gateway\agents-runtime\subagent-executor.ts:2907
- notes.md — refs: 1 — samples: src\gateway\teams\team-dispatch-runtime.ts:190
- output.md — refs: 1 — samples: src\gateway\teams\team-dispatch-runtime.ts:190
- PIPELINE_STATUS.md — refs: 3 — samples: src\gateway\teams\team-dispatch-runtime.ts:464, src\gateway\teams\team-dispatch-runtime.ts:530, src\gateway\teams\team-dispatch-runtime.ts:534
- post.md — refs: 3 — samples: src\gateway\teams\team-workspace.ts:202, src\gateway\teams\team-workspace.ts:203, src\gateway\teams\team-workspace.ts:470
- PROMPT.md — refs: 3 — samples: src\config\soul-loader.ts:114, src\skills\processor.ts:419, src\skills\processor.ts:435
- template.md — refs: 1 — samples: src\gateway\conversation-learning.ts:104
- topics.md — refs: 7 — samples: src\gateway\agents-runtime\agent-builder-integration.ts:593, src\gateway\agents-runtime\agent-builder-integration.ts:626, src\gateway\agents-runtime\agent-builder-integration.ts:631, src\gateway\agents-runtime\agent-builder-integration.ts:662
- YYYY-MM-DD.md — refs: 1 — samples: src\config\config.ts:579
- YYYY-MM-DD-intraday-notes.md — refs: 2 — samples: src\tools\write-note.ts:5, src\tools\write-note.ts:69

## Present in Workspace (but not at root)
- README.md — refs: 4
- SKILL.md — refs: 22
- system_prompt.md — refs: 30

## Notes
- `HEARTBEAT.md`, `system_prompt.md`, and `SKILL.md` are often per-agent/per-subagent files, so not being in workspace root is usually expected.
- `intraday-notes.md`, `YYYY-MM-DD.md`, `YYYY-MM-DD-intraday-notes.md` are template/pattern references (date-based), not literal files.
- `nHEARTBEAT.md` appears to be a likely typo token in code/comments and should be manually reviewed.
