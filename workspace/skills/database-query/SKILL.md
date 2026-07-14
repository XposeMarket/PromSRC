---
name: "database-query"
description: "Use when the user asks to author, review, optimize, or safely execute SQL for an explicitly identified SQLite, PostgreSQL, or Supabase database. Live execution requires an existing database file, a connected database MCP tool, or a user-provided connection plus an available client. Use read-only behavior by default and require explicit approval before writes."
---

# Database Query

Author SQL for the selected backend and execute it only when a real connection is available. A generated query and a successful live query are different outcomes.

## Capability gate

1. Identify the backend and dialect from the request, database file, connection card, or schema. Do not infer Supabase merely because PostgreSQL syntax appears.
2. For an MCP connection, call `mcp_server_manage` with `action: "list"`, then `action: "list_tools"` for the selected server. Use only the returned tool names.
3. For a SQLite file, verify the path exists. If Python is available, use `scripts/sqlite_query.py`; it opens the database read-only unless `--write` is present.
4. For PostgreSQL, verify `psql` or another compatible client exists before execution. A connection string alone is not an executable tool.
5. For Supabase, require a connected Supabase/PostgreSQL MCP server or a user-provided connection and available client. Never request or print a service-role secret unless live execution actually requires setup.
6. If no executable backend is available, still write or review the SQL, but label it `not executed` and state the missing capability precisely.

CSV and Excel work belongs to the spreadsheet workflow unless the user explicitly wants the data loaded into SQL.

## Query workflow

1. Inspect the relevant schema, constraints, row-level security, and sample values when available.
2. Write the smallest query that returns the requested shape. Use explicit columns, qualified joins, parameters, deterministic ordering, and a bounded `LIMIT` for exploratory reads.
3. Read [references/dialects.md](references/dialects.md) only for the selected backend.
4. For optimization, inspect an actual plan when safe. Remember that PostgreSQL `EXPLAIN ANALYZE` executes the query; do not use it on a write without approval.
5. Execute reads only after the capability gate passes. Verify returned columns and row count rather than trusting a tool success flag.

## Write boundary

Do not execute `INSERT`, `UPDATE`, `DELETE`, DDL, migrations, policy changes, or index creation without explicit user approval. Before an approved write:

- preview the exact target rows with a bounded `SELECT`;
- parameterize values;
- require a selective `WHERE` for `UPDATE` and `DELETE`;
- use a transaction when the backend supports it;
- report affected rows and commit/rollback status;
- avoid logging credentials or sensitive row values.

The SQLite helper's `--write` switch is a mechanical guard, not user approval.

## SQLite helper

```text
python scripts/sqlite_query.py --db data.db --sql "SELECT id, email FROM users WHERE status = ? LIMIT ?" --params '["active", 20]'
```

Pass `--write` only after approval. The helper accepts one statement, binds JSON array/object parameters, emits JSON, rolls back failed writes, and fails closed when a read-only database is missing or mutated.

## Result contract

Return the formatted query, backend/dialect, whether it was executed, output columns and row count when executed, and any safety or performance caveats. Never present generated sample rows as database results.
