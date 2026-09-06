import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { maintainSqliteMemoryIndex } from './sqlite-store';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-memory-maintenance-'));
const workspace = path.join(root, 'workspace');
const dbPath = path.join(workspace, 'audit', '_index', 'memory', 'memory.sqlite');
const backupDir = path.join(root, 'backup');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Use the real better-sqlite3 driver and WAL mode. This exercises the same
// file layout and maintenance path used by the gateway.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('wal_autocheckpoint = 1000000');
db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
const insert = db.prepare('INSERT INTO sample (body) VALUES (?)');
const tx = db.transaction(() => {
  for (let i = 0; i < 40_000; i += 1) insert.run(`memory-maintenance-${i}-${'x'.repeat(200)}`);
});
tx();
db.prepare('DELETE FROM sample WHERE id > ?').run(5_000);
db.close();

function size(filePath: string): number {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

const before = { db: size(dbPath), wal: size(`${dbPath}-wal`), shm: size(`${dbPath}-shm`) };
const result = maintainSqliteMemoryIndex(workspace, { backupDir, vacuum: true, quiesced: true });
assert.equal(result.ok, true, JSON.stringify(result));
assert.ok(result.backupFiles.some((filePath) => path.basename(filePath) === 'memory.sqlite'));
assert.equal(result.integrityBefore, 'ok');
assert.equal(result.integrityAfter, 'ok');

const verify = new Database(dbPath);
const rows = Number(verify.prepare('SELECT COUNT(*) AS n FROM sample').get().n);
const integrity = String(verify.pragma('integrity_check', { simple: true }));
verify.close();
assert.equal(rows, 5_000);
assert.equal(integrity, 'ok');

const after = { db: size(dbPath), wal: size(`${dbPath}-wal`), shm: size(`${dbPath}-shm`) };
console.log(JSON.stringify({ root, before, after, result, rows, integrity }, null, 2));
fs.rmSync(root, { recursive: true, force: true });
