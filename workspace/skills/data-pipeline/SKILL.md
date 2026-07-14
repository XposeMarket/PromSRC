---
name: "data-pipeline"
description: "Process, clean, transform, merge, validate, deduplicate, aggregate, convert, or export CSV, JSON, JSONL, Excel, logs, and other datasets. Use for repeatable ETL-style file workflows, especially when data quality and output verification matter."
---

# Data Pipeline

Use this skill for file-based data transformation. Use `database-query` for relational queries and `web-scraper` for collection before transformation.

## Workflow

1. Inspect the input format, encoding, headers, row count, schema, and file size before choosing a runtime.
2. Define the output schema and transformation rules explicitly: coercion, normalization, missing-value policy, filters, joins, deduplication keys, aggregation, ordering, and destination.
3. Use one runtime path. Prefer streaming or bounded chunks for large inputs; never load a very large file only for convenience.
4. Preserve source files. Write to a new output unless the user explicitly authorizes replacement.
5. Validate before delivery: required fields, types, uniqueness, row counts, rejected rows, totals, encoding, and parseability.
6. Report input/output counts, validation failures, assumptions, and the exact output path. Never claim success from file creation alone.

For format-specific Python examples, chunking patterns, validation helpers, and a composable pipeline skeleton, read [the detailed guide](references/detailed-guide.md).

## Guardrails

- Parameterize user-provided values and treat formulas/macros as untrusted when spreadsheets are involved.
- Keep rejected records or a sanitized error ledger when silent dropping would hide data loss.
- Make transformations deterministic and rerunnable.
- Do not infer destructive cleanup rules from ambiguous values; surface them for approval.
- Sample output for visual/semantic correctness in addition to structural validation.
