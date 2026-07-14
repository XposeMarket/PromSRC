import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const helper = path.join(root, 'workspace', 'skills', 'database-query', 'scripts', 'sqlite_query.py');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-database-query-'));
const dbPath = path.join(tempDir, 'fixture.sqlite');

function run(args, expectSuccess = true) {
  const result = spawnSync('python', [helper, ...args], { encoding: 'utf8' });
  if (expectSuccess) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  assert.notEqual(result.status, 0, 'command should fail closed');
  return JSON.parse(result.stderr);
}

try {
  run([
    '--db', dbPath,
    '--write',
    '--sql', 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL)',
  ]);
  run([
    '--db', dbPath,
    '--write',
    '--sql', 'INSERT INTO users(email, status, score) VALUES (:email, :status, :score)',
    '--params', JSON.stringify({ email: 'a@example.test', status: 'active', score: 8 }),
  ]);
  run([
    '--db', dbPath,
    '--write',
    '--sql', 'INSERT INTO users(email, status, score) VALUES (?, ?, ?)',
    '--params', JSON.stringify(['b@example.test', 'inactive', 3]),
  ]);

  const selected = run([
    '--db', dbPath,
    '--sql', 'SELECT id, email, score FROM users WHERE status = ? ORDER BY score DESC LIMIT ?',
    '--params', JSON.stringify(['active', 10]),
  ]);
  assert.equal(selected.read_only, true);
  assert.deepEqual(selected.columns, ['id', 'email', 'score']);
  assert.equal(selected.row_count, 1);
  assert.equal(selected.rows[0].email, 'a@example.test');

  const plan = run([
    '--db', dbPath,
    '--sql', 'EXPLAIN QUERY PLAN SELECT id FROM users WHERE status = ?',
    '--params', JSON.stringify(['active']),
  ]);
  assert.equal(plan.row_count > 0, true);

  const refusedMutation = run([
    '--db', dbPath,
    '--sql', "UPDATE users SET status = 'compromised'",
  ], false);
  assert.match(refusedMutation.error, /readonly|read-only/i);

  const afterFailure = run([
    '--db', dbPath,
    '--sql', 'SELECT COUNT(*) AS count FROM users WHERE status = ?',
    '--params', JSON.stringify(['compromised']),
  ]);
  assert.equal(afterFailure.rows[0].count, 0);

  const missing = run([
    '--db', path.join(tempDir, 'missing.sqlite'),
    '--sql', 'SELECT 1',
  ], false);
  assert.match(missing.error, /does not exist/i);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Database-query SQLite execution and fail-closed tests passed.');
