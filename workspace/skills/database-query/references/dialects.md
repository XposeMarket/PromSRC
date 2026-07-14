# SQL dialect notes

Read only the section for the selected backend.

## SQLite

- Use `?` or named parameters such as `:user_id`.
- Use `datetime('now', '-30 days')` for relative timestamps.
- Use `EXPLAIN QUERY PLAN` for a lightweight plan.
- JSON functions depend on the bundled SQLite build; verify before relying on them.
- There is no `ILIKE` or `DATE_TRUNC`.

```sql
SELECT user_id, COUNT(*) AS order_count, ROUND(SUM(total), 2) AS revenue
FROM orders
WHERE created_at >= datetime('now', '-30 days')
GROUP BY user_id
ORDER BY revenue DESC
LIMIT ?;
```

## PostgreSQL

- Use `$1`, `$2`, and so on for parameters in application code.
- Use `TIMESTAMPTZ`, `JSONB`, `FILTER`, `RETURNING`, and `CREATE INDEX CONCURRENTLY` where appropriate.
- Run `EXPLAIN (ANALYZE, BUFFERS)` only when executing the query is acceptable; it actually runs the statement.
- Never place `CREATE INDEX CONCURRENTLY` inside a transaction block.

```sql
SELECT
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS signups,
  COUNT(*) FILTER (WHERE plan = 'paid') AS paid_signups
FROM users
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1 DESC;
```

## Supabase

Supabase uses PostgreSQL. In addition to the PostgreSQL rules:

- Inspect row-level security and policies before diagnosing an empty client result.
- Treat `service_role` credentials as secrets and never expose them in output.
- Test policies under the actual authenticated role; a privileged SQL editor result does not prove client access.

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = $1;
```

## Portable schema guidance

- Index foreign-key columns used in joins.
- Prefer explicit column lists over `SELECT *`.
- Use constraints for invariants, not prompt instructions alone.
- Keep migration SQL separate from analytical queries.
- State when a query depends on a backend-specific feature.
