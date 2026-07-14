---
name: "embedding-search"
description: "Design or implement semantic search, embeddings, vector indexes, RAG retrieval, document Q&A, chunking, similarity search, reranking, and retrieval evaluation. Use when information must be found by meaning rather than exact text."
---

# Embedding Search

Use this skill for retrieval systems over unstructured content. Use exact text search for literal matching, `database-query` for relational data, and ingestion skills to normalize source documents first.

## Required contract

1. Define the corpus, exclusions, sensitivity constraints, and expected query types.
2. Normalize content and chunk on semantic boundaries. Start around 250–500 words with 10–20% overlap, then tune from evidence.
3. Give every chunk a stable ID and source metadata suitable for citations and filtering.
4. Choose one embedding model per index version. Record the model, dimensions, chunking policy, and index version; rebuild when those change.
5. Use the same model for indexing and queries. Validate vector dimensions before writes or searches.
6. Retrieve a bounded top-k set, optionally filter and rerank, deduplicate redundant passages, and preserve source citations.
7. Require a grounded fallback when retrieved context is insufficient.
8. Evaluate with a small gold query set before tuning prompts: retrieval hit quality, citation correctness, failure classes, latency, and cost.

Prefer a local-first, single-runtime implementation unless the user requests hosted infrastructure. Keep API keys outside code and pin request-specific dependencies.

Read [the detailed guide](references/detailed-guide.md) for architecture choices, model/store tradeoffs, TypeScript structure, and tuning guidance.
