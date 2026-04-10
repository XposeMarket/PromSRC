# Prometheus Memory System - Final Implementation Plan

Prepared for: Prometheus / Codex
Date: 2026-04-10
Status: Final planning spec for implementation
Goal: make `memory_search` reliable enough to function as Prometheus's operational memory, not just archive lookup.

---

## 1. Executive Summary

The current memory index is a useful evidence store, but it is not yet a dependable operational memory system.

Right now Prometheus indexes audit artifacts mainly as:
- one record per source file
- raw text chunks
- token and embedding-like search features
- lightweight metadata
- mostly generic record-to-record links

That works for broad forensic search, but it is weak for questions like:
- "What did Raul want changed about X?"
- "What did we decide last time about proposals?"
- "What project was this tied to?"
- "What was the final outcome?"
- "Is this a stable user preference or just a temporary note?"

### Core diagnosis
The current system indexes documents reasonably well, but not canonical memory units such as:
- decisions
- preferences
- outcomes
- bugs and fixes
- proposal lifecycle state
- project facts

### Core fix
Split the memory system into two clearly separated layers:

1. Evidence Lake
   - raw audit mirror
   - transcripts
   - tasks
   - proposals
   - schedules
   - notes
   - project artifacts
   - full provenance

2. Operational Memory
   - normalized extracted records
   - canonical decisions, preferences, outcomes, facts, and summaries
   - deduplicated and ranked for retrieval
   - linked back to evidence

`memory_search` should search operational memory first and fall back to evidence only when needed.

---

## 2. What Exists Today

Based on the current codebase and memory index:

### Existing strengths
- Audit mirroring is already strong.
- Multiple useful source families already exist in `workspace/audit/`.
- `memory_search`, `memory_read_record`, and graph helpers are already wired into the runtime.
- The current system already tracks timestamps, source paths, source types, durability, and project IDs in some cases.

### Current implementation shape
The current memory index is implemented around:
- file-level records
- chunk-level token index
- lightweight vector-style term embedding
- generic relation generation

The core implementation currently lives in:
- [index.ts](/D:/Prometheus/src/gateway/memory-index/index.ts)

Current record shape is effectively:
- `id`
- `sourcePath`
- `sourceType`
- `title`
- `timestampMs`
- `day`
- `projectId`
- `durability`

Current relations are mainly:
- `record_family`
- `same_project`
- `shared_terms`
- `semantic_neighbor`

### Current problems
1. Record granularity is too file-centric.
2. Retrieval returns discussion snippets instead of durable answers.
3. There is not enough typed metadata.
4. Duplicate mirrored forms pollute ranking.
5. Graph links are too generic to support reasoning over outcomes.
6. There is no canonical "final memory object" for a decision, preference, or completed task.
7. Ranking is not explainable enough for debugging failures.

---

## 3. Guiding Principles

These principles should govern the rebuild:

1. Durable answers beat transcript excerpts.
2. Provenance must never be lost.
3. Exact identifiers should beat semantic fuzziness.
4. Canonical records should beat mirrored duplicates.
5. Deterministic extraction should come before LLM-assisted extraction.
6. Operational retrieval should be explainable and measurable.
7. Build this as an extension of the current system, not a replacement of audit mirroring.

---

## 4. Target Architecture

## 4.1 Layer A - Evidence Lake

Keep the current audit-derived index, with only modest cleanup.

Purpose:
- preserve raw source material
- support evidence-grounded follow-up reads
- maintain traceability
- remain the fallback search layer

Suggested source families:
- chats/transcripts
- chats/compactions
- chats/sessions
- tasks/state
- proposals/state
- schedules/state
- memory/files
- memory/root
- projects/state
- teams/state
- system state artifacts

Rules:
- preserve source fidelity
- allow chunking
- allow embeddings / token index
- do not treat evidence records as the primary answer unit

## 4.2 Layer B - Operational Memory

Add a second store containing normalized memory objects extracted from evidence.

This becomes the main target of `memory_search`.

Purpose:
- represent the durable memory unit
- collapse repeated mentions
- surface final answers before raw discussion
- support stronger exact matching and entity-aware ranking

---

## 5. Canonical Operational Record Model

The system should introduce a strict operational record schema.

### Initial record types
- `decision`
- `preference`
- `project_fact`
- `task_outcome`
- `proposal`
- `bug`
- `fix`
- `research_finding`
- `workflow_rule`
- `entity_fact`
- `status_snapshot`
- `conversation_summary`

### Required shape

```ts
type OperationalRecordType =
  | 'decision'
  | 'preference'
  | 'project_fact'
  | 'task_outcome'
  | 'proposal'
  | 'bug'
  | 'fix'
  | 'research_finding'
  | 'workflow_rule'
  | 'entity_fact'
  | 'status_snapshot'
  | 'conversation_summary';

interface OperationalMemoryRecord {
  id: string;
  canonicalKey: string;
  recordType: OperationalRecordType;

  title: string;
  summary: string;
  body: string;

  createdAt: string;
  updatedAt: string;
  day: string;

  sourceRefs: Array<{
    sourceType: string;
    sourcePath: string;
    evidenceRecordId?: string;
    evidenceChunkId?: string;
    evidenceSpan?: string;
    confidence: number;
  }>;

  entities: {
    people: string[];
    projects: string[];
    features: string[];
    files: string[];
    tools: string[];
    externalSystems: string[];
    aliases: string[];
  };

  projectId: string | null;
  sessionIds: string[];
  taskIds: string[];
  proposalIds: string[];

  status?: 'proposed' | 'active' | 'completed' | 'denied' | 'superseded' | 'open' | 'resolved';
  outcome?: string;
  owner?: string;
  subject?: string;

  confidence: number;
  durability: number;
  sourceReliability: number;
  recencyWeightHint: number;

  supersedes: string[];
  supersededBy: string[];
  relatedIds: string[];

  exactTerms: string[];
  tags: string[];
}
```

### Important constraint
`body` must be concise normalized memory prose, not raw transcript dump.

Bad:
- large excerpts from conversation

Good:
- "On 2026-04-08 Raul asked Prometheus to update the X posting flow to use the verified inline composer path. Result: posting succeeded and the posting composite was updated to reflect the confirmed flow."

---

## 6. Canonical Keys and Dedup Strategy

This is a major improvement to the original plan and should be treated as foundational.

Every operational record should have a deterministic `canonicalKey`.

Examples:
- `preference:raul:proposal_quality`
- `proposal:prop_1774488760222_0c7f91`
- `task_outcome:68f787a1-7250-440e-a00d-f55584f63b6e`
- `decision:x_posting_flow:inline_home_composer`
- `project_fact:smallclaw:x_account_control`

### Why this matters
Without a stable canonical key, dedupe becomes fuzzy and fragile.

With a canonical key, the system can:
- merge repeated sightings into one record
- append evidence to an existing canonical record
- update `updatedAt` and status cleanly
- represent lifecycle changes without duplicating the memory object

### Dedupe rules

1. Transcript `.jsonl` + `.md` twins
   - keep both in evidence
   - create one operational summary / event set

2. Proposal lifecycle collapse
   - merge pending, approved, denied, archived, and discussion references into one canonical proposal record

3. Task state + transcript + note collapse
   - merge into one canonical `task_outcome` record per task

4. Repeated preference mentions
   - merge into the same `preference` record
   - update `updatedAt`
   - append evidence

5. Decision refinements
   - use `supersedes` / `supersededBy` where a newer decision replaces an older one

---

## 7. Storage Layout

Under `workspace/audit/_index/memory/`, move toward a layered layout:

```text
audit/_index/memory/
  README.md
  manifest.json

  evidence/
    records.json
    chunks.json
    relations.json
    token-index.json
    vectors.json

  operational/
    records.json
    chunks.json
    relations.json
    exact-lookup.json
    entities.json
    aliases.json
    timelines.json
    token-index.json
    vectors.json

  eval/
    queries.json
    judgments.json
    reports/
```

### Practical implementation note
This does not need to be introduced all at once.

For the first implementation, it is acceptable to:
- keep the current evidence store mostly intact
- add a new `operational/` substore beside it
- preserve compatibility for current memory tools while migrating internals

---

## 8. Ingestion Pipeline

Build ingestion as a deterministic multi-stage pipeline.

## Stage 1 - Collect Evidence Sources

Input families:
- transcripts
- session snapshots
- compactions
- task state files
- proposal state files
- project state files
- memory root files
- intraday notes

Output:
- evidence documents with normalized source metadata

## Stage 2 - Source-Specific Parsers

Each source family gets its own parser.

Initial parser set:
- `parseChatTranscript()`
- `parseChatSession()`
- `parseChatCompaction()`
- `parseProposalState()`
- `parseTaskState()`
- `parseIntradayNotes()`
- `parseMemoryRoot()`
- `parseProjectState()`

Each parser should emit:
1. evidence records
2. candidate operational events

## Stage 3 - Candidate Event Extraction

Examples:
- transcript -> decisions, preferences, workflow rules, conversation summaries
- proposal -> proposal summary, status, approval or denial outcome
- task state -> task outcome, blocker, completion state
- notes -> discoveries, findings, outcomes
- memory root -> stable preferences, identity facts, standing workflow rules
- project state -> project facts and status snapshots

## Stage 4 - Entity Extraction and Normalization

Extract and normalize:
- people
- project names and IDs
- feature names
- file paths
- tool names
- external systems
- session IDs
- task IDs
- proposal IDs

## Stage 5 - Alias Resolution

Introduce an explicit alias map.

Example:

```json
{
  "prometheus": ["prom", "smallclaw"],
  "x.com": ["twitter", "x", "twitter/x"]
}
```

This must be explicit and inspectable, not accidental.

## Stage 6 - Canonicalization and Merge

For each candidate operational event:
- compute `canonicalKey`
- merge into existing canonical record if present
- append evidence refs
- update lifecycle fields
- resolve supersession where relevant

## Stage 7 - Retrieval Chunking

Operational chunking should be semantic, not just size-based.

Recommended chunk types:
- title
- summary
- body
- outcome

Most operational records should produce 1 to 3 chunks.

## Stage 8 - Index Build

Build for both evidence and operational layers:
- lexical token index
- vector index
- exact lookup tables
- entity lookup tables
- timeline index
- typed relation graph

---

## 9. Query Planning

`memory_search` should stop being a single naive pass.

It should first classify query intent.

### Query planner outputs
- exact lookup query
- entity query
- time-sensitive query
- project-scoped query
- decision query
- preference query
- proposal outcome query
- broad semantic query

### Example mappings
- "what did we decide about X" -> `decision`
- "what does Raul prefer" -> `preference`
- "latest changes to project foo" -> `project_fact` plus recency bias
- "why did we deny that proposal" -> `proposal`
- "what happened with task XYZ" -> exact task ID lookup

### Implementation note
The first query planner does not need to be ML-based.
Simple deterministic heuristics are better for V1:
- regexes
- keyword classes
- exact ID extraction
- date phrase detection
- project/entity hit detection

---

## 10. Retrieval Strategy

Retrieval should become layered and explainable.

### Pass A - Exact Retrieval

Use:
- proposal IDs
- task IDs
- session IDs
- file paths
- exact entity names
- aliases
- project IDs
- exact terms from operational records

Exact matches should receive the highest boost.

### Pass B - Operational Lexical Retrieval

Search only operational records using:
- summary
- body
- exact terms
- entities
- tags

### Pass C - Operational Semantic Retrieval

Run semantic retrieval across operational chunks.

### Pass D - Score Fusion and Intent Boosting

Combine:
- exact score
- lexical score
- semantic score
- entity score
- record type intent fit
- recency fit
- durability
- confidence
- source reliability

### Pass E - Graph Expansion

Only after strong initial retrieval:
- expand related candidates through typed edges
- do not let graph expansion override clearly stronger exact hits

### Pass F - Evidence Fallback

If operational recall is weak:
- search evidence layer
- label results clearly as evidence/raw
- surface provenance strongly

---

## 11. Ranking Formula

Use a transparent weighted score.

```ts
score =
  exactMatchBoost +
  lexicalScore * 0.9 +
  semanticScore * 0.7 +
  entityMatchScore * 1.0 +
  recordTypeIntentScore * 0.8 +
  recencyScore * queryRecencyWeight +
  durabilityScore * 0.5 +
  confidenceScore * 0.4 +
  sourceReliabilityScore * 0.3 +
  graphSupportScore * 0.2 -
  duplicationPenalty -
  staleSupersededPenalty;
```

### Required ranking behavior
1. Exact IDs beat semantic similarity.
2. Operational records beat evidence by default.
3. Final outcomes beat intermediate discussion.
4. Active or resolved records beat superseded ones unless the query asks for history.
5. Recent records get boosted for time-sensitive queries.
6. Duplicate siblings should not dominate top results.

---

## 12. Typed Graph Model

The graph needs to be upgraded from generic relation similarity to meaning-bearing links.

### Recommended edge types
- `same_session`
- `same_project`
- `same_task`
- `same_proposal`
- `same_entity`
- `derived_from`
- `supports`
- `contradicts`
- `supersedes`
- `resolved_by`
- `implemented_by`
- `mentioned_with`

### Important sequencing note
Do not start with full graph complexity.
The graph upgrade should follow operational canonicalization and retrieval MVP.

---

## 13. Metadata Requirements by Record Type

## decision
Required:
- subject
- decision summary
- date
- confidence
- evidence refs

Optional:
- why
- projectId
- feature refs
- file refs

## preference
Required:
- owner
- preference statement
- scope
- durability
- evidence refs

## task_outcome
Required:
- taskId if known
- outcome
- status
- what changed
- related files/tools
- date

## proposal
Required:
- proposalId
- title
- status
- summary
- affected scope

Optional:
- approval or denial reason

## bug
Required:
- symptom
- summary
- status
- related files/features

## fix
Required:
- fix summary
- resolved status
- related bug or subject
- related files/features

## research_finding
Required:
- finding summary
- source reliability
- date
- topic/entities

---

## 14. Result Contract

The search tool should return ranked explanations, not just snippets.

```ts
interface MemorySearchResultItem {
  id: string;
  layer: 'operational' | 'evidence';
  recordType?: string;
  title: string;
  summary: string;
  score: number;

  whyMatched: {
    exactTerms: string[];
    entities: string[];
    lexical: string[];
    semantic: string[];
    recordTypeReason?: string;
    recencyReason?: string;
  };

  metadata: {
    day: string;
    projectId: string | null;
    status?: string;
    confidence?: number;
    durability?: number;
  };

  sourceRefs: Array<{
    sourcePath: string;
    sourceType: string;
  }>;
}
```

This makes bad ranking debuggable.

---

## 15. Evaluation Harness

This is mandatory and should be built before aggressive ranking tuning.

Create:
- `audit/_index/memory/eval/queries.json`
- `audit/_index/memory/eval/judgments.json`
- `audit/_index/memory/eval/reports/`

### Eval set scope
Build 50 to 100 real retrieval prompts Raul actually cares about.

Categories:
- preferences
- workflow rules
- proposal outcomes
- task outcomes
- project association
- bug/fix history
- exact ID lookups
- recency questions
- "last time we discussed"
- cross-entity questions

### Example eval entry

```json
{
  "id": "eval_001",
  "query": "What did Raul want about proposal quality?",
  "expectedRecordIds": ["mem_pref_proposal_quality_001"],
  "acceptableRecordIds": ["mem_rule_proposals_exactness_002"],
  "notes": "Should retrieve stable preference, not random transcript discussion"
}
```

### Metrics
- Recall@5
- Recall@10
- MRR
- nDCG@10
- exact-hit rate for ID/entity queries
- duplicate-rate in top 5
- operational-vs-evidence hit ratio

### Success targets
- 85% or better Recall@5 on curated eval set
- 95% or better exact-hit on exact ID/entity queries
- less than 10% duplicate rate in top 5

---

## 16. Phased Implementation Plan

This is the recommended build order.

## Phase 1 - Schema and Pipeline Foundation

Build:
- operational schema types
- layered store structure
- source-specific parser framework
- candidate event extraction
- exact term extraction
- alias map support
- canonical key generation

Deliverable:
- deterministic operational records generated from transcripts, tasks, proposals, memory roots, notes, and project state

## Phase 2 - Canonicalization and Dedupe

Build:
- transcript pair collapse
- proposal lifecycle merger
- task outcome merger
- repeated preference merge
- supersession handling

Deliverable:
- canonical operational store with merged `sourceRefs`

## Phase 3 - Operational Retrieval MVP

Build:
- exact lookup tables
- operational lexical retrieval
- operational semantic retrieval
- deterministic query planner
- layered retrieval flow
- evidence fallback

Deliverable:
- new `memory_search` implementation that is operational-first

## Phase 4 - Typed Relations and Related-Memory Expansion

Build:
- typed relation generation
- related memory expansion
- proposal/task/session/entity traversals

Deliverable:
- meaningful related-memory results

## Phase 5 - Evaluation and Tuning

Build:
- eval dataset
- report generation
- score tuning
- query planner refinement

Deliverable:
- measurable retrieval quality report

## Phase 6 - Optional Enhancements

Only after the above is stable:
- LLM-assisted extraction for weakly structured sources
- stronger summarization refinement
- richer contradiction handling
- incremental background indexing optimization

---

## 17. MVP Scope for Fastest Reliability Upgrade

If the goal is fastest path to a major quality jump, implement this first:

1. Keep the current evidence index.
2. Add a new operational layer.
3. Extract only:
   - `preference`
   - `decision`
   - `task_outcome`
   - `proposal`
   - `project_fact`
4. Add entity extraction for:
   - people
   - project IDs/names
   - proposal IDs
   - task IDs
   - files
   - features/tools
5. Deduplicate transcript `.jsonl` and `.md` pairs.
6. Change `memory_search` to:
   - exact lookup first
   - operational hybrid retrieval second
   - evidence fallback third
7. Add 50 eval queries.

That MVP should already produce a large reliability increase.

---

## 18. Implementation Notes for Codex

### Do not do this
- Do not remove audit mirroring.
- Do not delete evidence indexing.
- Do not depend on embeddings alone.
- Do not treat transcript chunks as the final memory unit.
- Do not rank `.jsonl` and `.md` twins as separate top answers.
- Do not introduce LLM extraction before deterministic extraction works.

### Do this
- Preserve provenance for every operational record.
- Start with deterministic parsers and merge rules.
- Add `canonicalKey` before broad dedupe.
- Keep retrieval scoring explainable.
- Build evals before tuning.
- Keep backward compatibility for current tools where possible.

---

## 19. Acceptance Criteria

This plan is successful when:

1. `memory_search` can return a canonical decision, preference, proposal, or task outcome before returning a transcript excerpt.
2. Exact queries for proposal IDs, task IDs, session IDs, file paths, and project IDs are highly reliable.
3. Duplicate evidence forms no longer dominate top search results.
4. Every operational result can point back to evidence.
5. Retrieval quality is measured by an eval harness and improves against baseline.

---

## 20. Final Recommendation

If there is only one conceptual change to make, it is this:

> Stop treating indexed file chunks as the primary memory object.
> Start treating normalized decisions, preferences, outcomes, proposal states, and project facts as the primary memory object.

That is the actual fix.

Everything else, including hybrid search, recency behavior, graph traversal, and semantic matching, becomes much more reliable once the memory unit itself is correct.

---

## 21. One-Sentence Handoff

Prometheus already has a strong evidence substrate; the missing step is a canonical operational memory layer that extracts, merges, and ranks durable facts, decisions, preferences, outcomes, and project-linked records above raw transcript chunks.
