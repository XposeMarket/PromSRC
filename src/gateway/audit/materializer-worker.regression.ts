import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuditMaterializerWorker } from './materializer.js';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-audit-worker-'));
  const configDir = path.join(root, 'config');
  const workspacePath = path.join(root, 'workspace');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });

  try {
    const worker = createAuditMaterializerWorker({ configDir, workspacePath }, 60_000);
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('audit materializer worker timed out')), 15_000);
      worker.once('message', (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(result?.ok, true, String(result?.error || 'audit worker did not report success'));
    assert.equal(fs.existsSync(path.join(workspacePath, 'audit', 'README.md')), true);
    await worker.terminate();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('audit materializer worker regression passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
