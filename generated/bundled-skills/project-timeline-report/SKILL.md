---
name: "project-timeline-report"
description: "Reconstruct a project's history from Prometheus memory, intraday notes, transcripts, and artifacts, then write either a short status digest (what happened since a date, what is open, what is next) or a long-form journey report with phases, turning points, dead ends, and lessons. Use when the user asks for a project timeline, history, journey report, recap of the last week or month, or progress digest for a named project. Do not use for a single recall question (use memory search directly), writing a handoff (session-handoff), or memory writes and pruning (memory-governance-playbook)."
---

# Project Timeline Report

Turn scattered memory into a dated, sourced story. Retrieval is layered: search wide and cheap, filter hard, then read in full only what survives. Every claim in the report points to the record it came from.

## 1. Scope the report

Pin: the project or entity name (and aliases), the date range (default: all history for a journey, last 7 days for a digest), and the format:

- **Digest** (300 to 800 words): done, in progress, blocked, decisions, next.
- **Journey** (2,000 to 5,000 words): the full narrative.

If the project name or format is ambiguous, ask with `ask_prometheus_questions`. Done when name, range, and format are fixed.

## 2. Search wide, cheaply

1. `memory(action:"search", query:"<project>", mode:"timeline", date_from, date_to, limit:50)`; repeat with each alias and with key subtopics (launch, bug, client, deploy). Use `mode:"project"` with `project_id` when the project is registered.
2. If `advanced_memory` helps, load it and pull the timeline and related records for the strongest hits.
3. Also check: `workspace/entities/` files for the project, intraday notes in `memory/` for the range, `Brain/` dreams and thoughts that mention it, and project artifacts (plans, reports, repos) by name with `workspace_read(action:"grep")`.

Keep only the index (date, source path or id, one-line title) at this stage. Done when the index covers the whole range with no unexplained gaps; name any gap you could not fill.

## 3. Filter, then read in full

Pick the records that carry decisions, turning points, failures, deliveries, and open items. Discard duplicates and chatter. Read those in full (memory records, transcript windows around the anchor, the artifact itself). Read raw tool output only when an exact figure or error is needed.

If the source volume is large (more than about 150 records or a very long range), estimate the reading size, tell the user, and either narrow the range or fan out per time window with `parallel-agent-fanout`, each worker returning a dated event list with sources.

## 4. Build the event table

One row per event: `date | event | type (decision, build, fix, failure, delivery, pivot, open) | source`. Sort chronologically. Mark inferred dates as inferred. Done when every row has a source.

## 5. Write the report

**Digest:** headline status in one sentence; done (with dates); in progress; blocked and why; decisions made; open items with owners; next steps. Close each open item with its note id if one exists.

**Journey:** cover the full arc in order, not just recent work.
1. Origins: why it started and the first plan.
2. Phases: name each, with its goal and outcome.
3. Turning points: where direction changed and why.
4. Dead ends: what failed and what it taught, stated honestly.
5. Key decisions and their later consequences.
6. Current state and open threads.
7. Lessons about the process itself (tooling, workflow, collaboration).

Use inline source references `[date, source]` for factual claims. Separate what the records show from your interpretation.

## 6. Save and deliver

Save to `reports/<project-slug>-<digest|journey>-<yyyy-mm-dd>.md`. Tell the user the path, the date range covered, the number of records used, and any gaps. Offer `session-retro` follow-ups if the report surfaced recurring failures. Do not write the report's conclusions into memory unless the user asks.

## Exit criteria

Every event has a source; the range is fully covered or gaps are named; the format matches the request; the file exists and was reread.

Lineage: inspired by thedotmack/claude-mem timeline-report and mem-search (layered search, filter, fetch), rewritten for Prometheus.
