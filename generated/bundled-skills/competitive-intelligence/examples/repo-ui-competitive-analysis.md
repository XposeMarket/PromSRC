# Repo UI Competitive Analysis Example

Use this example when the user asks to download or inspect a competitor/open-source repo and compare its UI/product surface against Prometheus.

## Evidence

Observed on 2026-05-13: the user asked Prometheus to download `https://github.com/outsourc-e/hermes-workspace` into `oss-agents` and examine it against the Prometheus web UI. The run recovered from blocked `git clone`/`tar` shell attempts by using URL download/extraction paths and native file/source readers, then compared Hermes Agent's React/Vite web dashboard against Prometheus's broader vanilla-JS web UI. Evidence: `Brain/skill-episodes/2026-05-13/episodes.jsonl:3-4`; `Brain/skill-gardener/2026-05-13/workflow-episodes.jsonl:8-9`.

## Fast Workflow

1. Clarify only if the requested comparison target or audience is missing. If the user names a repo and says “compare against Prometheus,” proceed.
2. Use safe repo acquisition in this order:
   - If a local mirror already exists under `oss-agents/`, inspect it first.
   - If shell clone is blocked or URL/path policy mangles `https://`, use a zip/download tool or web fetch path instead of looping on `git clone`.
   - If archive extraction through shell is blocked, use available download/extract tooling or report the exact blocker and inspect any already-extracted folder.
3. Identify the competitor UI/app entry points before reading deeply. Common candidates: `web/`, `frontend/`, `ui/`, `app/`, `package.json`, `README.md`, route files, pages, components.
4. Inspect Prometheus comparison surfaces with source tools, not guesses. For web UI, use `list_webui_source`, `grep_webui_source`, `webui_source_stats`, and `read_webui_source`.
5. Compare by product surfaces the user cares about:
   - navigation/pages
   - chat/session UX
   - tool/model state visibility
   - agents/teams/tasks/schedules/proposals/audit
   - plugin/skill/extension packaging
   - memory/context surfaces
   - local desktop/browser/Creative/connector surfaces
6. Separate “competitor is cleaner-packaged” from “competitor has deeper capability.” Prometheus often has broader system primitives but may need better product packaging.
7. End with concrete feature buckets, not vague admiration. Name what to steal/adapt, what Prometheus already beats, and what needs source scouting before proposal.

## Guardrails

- Do not keep retrying blocked shell commands with slightly different quoting. Switch path after one or two policy blocks.
- Do not rely on README marketing copy alone when local source exists.
- Do not claim a repo was cloned if it was downloaded/extracted by another route; report the actual path and method.
- Do not create source proposals unless current Prometheus source files and exact edit points were inspected.

## Output Shape

```markdown
Done — I inspected [repo/path].

## Competitor UI shape
- [framework/build]
- [main pages/routes]
- [notable components]

## Prometheus UI shape
- [current comparable surfaces]

## What they do better
1. ...

## What Prometheus already has stronger
1. ...

## Feature buckets worth adapting
- [bucket] — [why] — [likely Prometheus landing zone]

## Deferred / needs source scouting
- ...
```
