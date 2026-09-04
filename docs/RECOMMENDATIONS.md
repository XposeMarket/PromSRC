# Recommendations

Prometheus recommendations are next-action objects, not presentation cards.

The recommendation model lives in `src/gateway/recommendations/recommendation-service.ts` and is designed to aggregate candidates from Brain, GitHub, tasks, schedules, sessions, and projects. Candidate providers should emit a concise user-visible `label`, a hidden execution `prompt`, source metadata, confidence, and freshness. The shared ranker removes expired/duplicate entries and prefers high-confidence, fresh, actionable sources.

Brain Pulse Cards remain a compatibility input. `recommendationFromBrainPulseCard()` converts them into the new model without requiring the recommendation UI to inherit the old title/body card presentation.

UI surfaces should render at most three recommendations as flat source-icon + action-label rows. Explanatory body copy belongs in metadata or the hidden prompt, not on the empty-chat surface.

Follow-up integration should wire provider-specific live validation before display (for example, merged PRs and completed tasks should be removed rather than resurfaced) and should record impression/tap/dismiss/completion feedback for ranking.
