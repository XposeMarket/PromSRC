---
name: memory-operations-playbook
description: "Retrieve, inspect, relate, write, consolidate, embed, and refresh Prometheus memory safely. Use for advanced memory search, timeline or graph queries, record provenance, claims review, embedding health, and index recovery."
---

# Memory Operations Playbook

Use this for advanced memory operations. Use memory-governance-playbook first when deciding whether information belongs in memory, a note, an entity, a skill, or nowhere.

## Retrieve the right evidence

Start with a compact `memory(action:"search")` hit list of IDs, dates, and titles in quick or project mode; use deep only when initial retrieval misses. For chronology, follow the best anchor with `memory(action:"search", mode:"timeline")`. Filter to the few relevant IDs before reading their full records with `memory_read_record`; consult raw tool output or transcripts only last. Full reads before filtering waste tokens and bury relevant evidence. Use debug search when relevance, authority, recency, durability, or vector/FTS behavior needs explanation. Read a full record before relying on an important hit; expand related records and graph snapshots only when needed. For multi-record project history, use `project-timeline-report`.

## Write safely

Browse the target file/category first. Write only durable, high-confidence facts with provenance and uncertainty. Prefer correction or supersession over contradictory duplicates. Keep procedures in skills, business facts in entities or BUSINESS context, and short-lived progress in notes. Never store secrets or assistant-generated assumptions as user facts.

## Claims, embeddings, and index

Use consolidation to produce reviewable claims; auto-accept only explicit high-confidence user facts or corrections. Accept, reject, or supersede claims deliberately and preserve review notes. Check embedding provider status before backfill; retain hash fallback when no real provider is available. Refresh the index after major archive changes or when search misses known current evidence.

## Fallback and verification

If semantic search is unavailable, use FTS/quick search and disclose reduced recall. If the index is stale, read the authoritative source file directly and refresh later. If a write fails, preserve the fact in an intraday note and report the durable-write failure separately. After writes or claim actions, reread the record and verify source, category, status, and content.