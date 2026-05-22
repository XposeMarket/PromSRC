---
name: embedding-search
description: Build semantic retrieval workflows that help Prometheus (or a user system) find meaning-based matches across documents.
emoji: "🧩"
version: 1.0.0
---

# Embedding Search

Build semantic retrieval workflows that help Prometheus (or a user system) find meaning-based matches across documents.

---

## Use This Skill When

Use this skill for:
- Building a vector index over unstructured text
- Semantic retrieval for RAG pipelines
- Similarity search (find related passages/content)
- Document Q&A that requires retrieval before generation
- Retrieval tuning (chunk size, overlap, top-k, reranking)

Do **not** use this skill when the request is primarily:
- Raw file extraction/normalization only → use document/data ingestion skills first
- Exact keyword search only → use grep/text search workflows
- Structured relational querying/reporting → use database-query skills
- Broad web crawling/scraping → use web-scraper skills

---

## Runtime Assumptions (Current Prometheus Stack)

- Prefer **local-first execution** unless the user explicitly requests hosted infrastructure.
- Default stack in this workspace is **Node.js/TypeScript on Windows**; Python is acceptable when required by retrieval tooling.
- Keep each implementation in **one runtime path** (all-TS or all-Python) to avoid stale mixed environments.
- Persist indexes in a deterministic local path (for example under `workspace/data/vector/`) unless user specifies otherwise.
- Do not hardcode machine-specific absolute paths in deliverables.

---

## Retrieval Architecture (Minimal)

1. Ingest clean text with metadata
2. Chunk text into retrieval-sized units
3. Generate embeddings for each chunk
4. Store vectors + metadata in an index/vector store
5. Embed query and retrieve top-k candidates
6. (Optional) rerank candidates
7. Build grounded answer from retrieved context

---

## Chunking Guidance

**Rule:** Never embed full long-form documents as single vectors.

Recommended defaults:
- Chunk size: **250-500 words** (or ~800-1800 chars)
- Overlap: **10-20%**
- Metadata per chunk: `source`, `chunk_id`, optional `title`, `timestamp`, `author`

Prefer semantic boundaries when possible:
- Split by headings/sections first
- Keep tables/code blocks intact when they are meaningful units
- Avoid splitting mid-list or mid-table unless necessary

Pseudo-example:

```text
for each document:
  normalize text
  split into chunks with overlap
  emit {id, text, metadata}
```

---

## Embedding Model Selection

Pick based on constraints:

| Constraint | Recommended direction |
|---|---|
| Fast local prototype | lightweight local embedding model |
| Highest managed quality | hosted embedding API |
| Sensitive/offline docs | local model only |
| Multilingual corpus | multilingual embedding model |

Selection principles:
- Use **one embedding model per index version**
- Re-embed corpus when changing model families
- Track `embedding_model` and `index_version` in metadata/config

---

## Vector Store Selection

Use whichever fits deployment constraints:
- Local/dev: Chroma, FAISS, SQLite+pgvector-compatible local setups
- Production/self-hosted: pgvector, Qdrant, Weaviate, Milvus
- Managed: hosted vector DBs when ops simplicity is preferred

Store at minimum:
- Vector
- Chunk text (or stable pointer)
- Metadata
- Stable chunk ID

---

## Query + Retrieval Pattern

At query time:
1. Embed incoming query with the **same model** used for index
2. Retrieve top-k neighbors (start with k=5)
3. Optionally apply metadata filters
4. Optionally rerank for precision
5. Return citations (`source`, `chunk_id`) with outputs

For RAG answering:
- Instruct generator to answer only from retrieved context
- Require explicit fallback when context is insufficient
- Include citations in final response

---

## TypeScript-Oriented Skeleton (Stack-Aligned)

```ts
// Pseudocode-level skeleton

type Chunk = {
  id: string;
  text: string;
  metadata: { source: string; chunkId: number; [k: string]: unknown };
};

async function buildIndex(chunks: Chunk[]) {
  const texts = chunks.map(c => c.text);
  const vectors = await embedBatch(texts); // same model for index+query
  await vectorStore.upsert(
    chunks.map((c, i) => ({
      id: c.id,
      vector: vectors[i],
      text: c.text,
      metadata: c.metadata,
    }))
  );
}

async function retrieve(query: string, k = 5) {
  const qv = await embedOne(query);
  return vectorStore.search({ vector: qv, topK: k });
}
```

Use this as a shape reference; adapt concrete library calls per project.

---

## Evaluation + Tuning

Track retrieval quality before prompt tweaking:
- Precision@k / Recall@k on known query-answer pairs
- Citation correctness
- Failure classes (no hit, wrong hit, partial hit)

Common fixes:
- Irrelevant hits → reduce chunk size, improve normalization, rerank
- Missing context → increase overlap or top-k
- Duplicate hits → dedupe by source/section
- Slow indexing → batch embeddings and upserts

---

## Dependency / Tooling Caveats

To avoid stale execution paths:
- Do not assume a single mandatory library (Chroma/FAISS/etc. are interchangeable choices)
- Pin embedding/vector dependencies per project to avoid silent behavior drift
- Validate dimension compatibility (`query_dim === index_dim`) before writes/search
- Keep API-based embedding keys out of code; use environment variables
- Rebuild or version indexes when changing chunking strategy/model
- Avoid mixing legacy paths, old product naming, or hardcoded workspace locations in examples

---

## Pre-Implementation Checklist

Before implementing embedding search:
- [ ] Corpus defined (what is indexed and what is excluded)
- [ ] Chunking strategy chosen (size, overlap, boundary rules)
- [ ] Embedding model selected and versioned
- [ ] Vector store selected for target environment
- [ ] Metadata schema defined for filtering/citations
- [ ] Retrieval defaults set (`top_k`, filters, optional rerank)
- [ ] Evaluation set prepared (at least a small gold query set)
- [ ] Reindex plan documented for model/chunking changes