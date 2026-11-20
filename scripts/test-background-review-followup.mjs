// Parent-owned temporary root: Windows can retain application SQLite/watch
// handles until child exit. Clean only our own mkdtemp root after that exit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-review-followup-'));
const test = fileURLToPath(new URL('./test-background-review-followup.integration.ts', import.meta.url));
let status = 1;
try {
  const child = spawnSync(process.execPath, ['--import', 'tsx', test], {
    cwd: path.dirname(path.dirname(test)),
    env: { ...process.env, BACKGROUND_REVIEW_FOLLOWUP_TEST_ROOT: root },
    stdio: 'inherit',
    timeout: 90_000,
  });
  if (child.error) throw child.error;
  status = child.status ?? 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
process.exitCode = status;
