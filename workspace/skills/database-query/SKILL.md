---
name: database-query
description: Use this skill for all SQL and database tasks — from simple lookups to complex analytical queries and schema design.
emoji: "🧩"
version: 1.0.0
---

# Database Query

Use this skill for all SQL and database tasks — from simple lookups to complex analytical queries and schema design.

---

## 1. Tool & Connection Check

Before writing queries, determine the database context:

### Supabase (via MCP)
If a Supabase MCP server is connected, use `mcp_server_manage` to list tools, then use available Supabase tools directly:
- Check with: `mcp_server_manage({ action: "list_tools", id: "supabase" })`
- Execute queries via the Supabase `execute_sql` or equivalent MCP tool
- Read-only mode by default — check if write access is configured

### SQLite (via MCP or file)
- If SQLite MCP connected: use its query tool
- If .db file in workspace: use `run_command({ command: 'sqlite3 path/to/db.sqlite "SELECT ..."' })`

### PostgreSQL (connection string)
- Use `run_command` with `psql` if available in PATH
- Or use Python: `run_command({ command: "python -c \"import psycopg2; ...\"" })`

### File-based (CSV, Excel)
- Use Python with `pandas` for SQL-like queries on flat files
- Or use SQLite in-memory: `pandas.DataFrame.to_sql()` then query

---

## 2. Query Generation

### SELECT Patterns

**Basic:**
```sql
SELECT column1, column2
FROM table_name
WHERE condition
ORDER BY column1 DESC
LIMIT 50;
```

**With JOIN:**
```sql
SELECT
  u.id,
  u.email,
  o.order_id,
  o.total,
  o.created_at
FROM users u
INNER JOIN orders o ON o.user_id = u.id
WHERE o.status = 'completed'
  AND o.created_at >= NOW() - INTERVAL '30 days'
ORDER BY o.created_at DESC;
```

**Aggregation:**
```sql
SELECT
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS signups,
  COUNT(*) FILTER (WHERE plan = 'paid') AS paid_signups,
  ROUND(AVG(ltv)::numeric, 2) AS avg_ltv
FROM users
GROUP BY 1
ORDER BY 1 DESC;
```

**CTE (Common Table Expression) — prefer over nested subqueries:**
```sql
WITH active_users AS (
  SELECT user_id
  FROM sessions
  WHERE last_seen >= NOW() - INTERVAL '7 days'
),
user_revenue AS (
  SELECT user_id, SUM(amount) AS total_revenue
  FROM payments
  GROUP BY user_id
)
SELECT
  au.user_id,
  ur.total_revenue
FROM active_users au
LEFT JOIN user_revenue ur ON ur.user_id = au.user_id
ORDER BY ur.total_revenue DESC NULLS LAST;
```

**Window Functions:**
```sql
SELECT
  user_id,
  order_id,
  amount,
  SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total,
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rank_by_amount
FROM orders;
```

---

## 3. Write Queries (INSERT / UPDATE / DELETE)

**Always confirm write intent before executing — these cannot be undone.**

```sql
-- INSERT with RETURNING
INSERT INTO users (email, plan, created_at)
VALUES ('user@example.com', 'free', NOW())
RETURNING id, email;

-- UPDATE with WHERE (ALWAYS include WHERE)
UPDATE users
SET plan = 'paid', updated_at = NOW()
WHERE id = 42
RETURNING id, plan;

-- DELETE with WHERE (ALWAYS include WHERE — never DELETE without it)
DELETE FROM sessions
WHERE expires_at < NOW()
RETURNING id;
```

**Safety rules for writes:**
1. ALWAYS preview with a SELECT first: `SELECT * FROM table WHERE [same condition] LIMIT 5`
2. ALWAYS include WHERE clause on UPDATE/DELETE
3. Use `RETURNING` to confirm what changed
4. Wrap destructive operations in transactions if batch:
```sql
BEGIN;
UPDATE orders SET status = 'cancelled' WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 days';
-- Check count before committing
SELECT COUNT(*) FROM orders WHERE status = 'cancelled' AND created_at < NOW() - INTERVAL '30 days';
COMMIT; -- or ROLLBACK;
```

---

## 4. Schema Design

### Table creation template:
```sql
CREATE TABLE IF NOT EXISTS table_name (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on foreign key (always)
CREATE INDEX IF NOT EXISTS idx_table_name_user_id ON table_name(user_id);

-- Index on filter columns
CREATE INDEX IF NOT EXISTS idx_table_name_status ON table_name(status) WHERE status != 'deleted';

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_table_name_updated_at
BEFORE UPDATE ON table_name
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 5. Query Optimization

When a query is slow:

1. **Run EXPLAIN ANALYZE:**
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT ...;
```

2. **Look for:**
   - `Seq Scan` on large tables → needs an index
   - `Hash Join` on millions of rows → may need to split or add indexes
   - High `rows=` estimate vs actual → table stats stale → run `ANALYZE table_name`
   - Filter % high → selectivity issue, different index needed

3. **Common fixes:**
   - Missing index → `CREATE INDEX CONCURRENTLY`
   - Implicit cast breaking index → ensure types match exactly
   - N+1 query pattern → use JOIN or subquery instead
   - `SELECT *` on wide table → specify needed columns only

---

## 6. Supabase-Specific Patterns

```sql
-- Row-Level Security check (RLS)
SELECT * FROM pg_policies WHERE tablename = 'your_table';

-- Enable RLS
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can only see own records"
ON your_table FOR SELECT
USING (auth.uid() = user_id);

-- Check current user
SELECT auth.uid(), auth.role();

-- Realtime subscriptions (handled in client SDK, not SQL)
-- PostgREST API: GET /rest/v1/table_name?select=col1,col2&col3=eq.value
```

---

## 7. Output Format

For every query, deliver:
1. **The query** — formatted, with comments for complex parts
2. **Plain-English explanation** — what it does and why it's structured this way
3. **Expected output shape** — column names and types returned
4. **Notes** — edge cases, performance considerations, write safety (if applicable)
5. **Alternative** — simpler version if the full query is complex