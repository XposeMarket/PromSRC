import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { performance } from 'perf_hooks';

const modulePath = path.resolve(String(process.argv[2] || ''));
const configDir = path.resolve(String(process.argv[3] || ''));
const workspacePath = path.resolve(String(process.argv[4] || ''));

function walkBytes(root: string): { files: number; bytes: number } {
  if (!fs.existsSync(root)) return { files: 0, bytes: 0 };
  const stack = [root];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        try { bytes += fs.statSync(abs).size; files += 1; } catch { /* best effort */ }
      }
    }
  }
  return { files, bytes };
}

function sumMirrorBytes(root: string): { files: number; bytes: number } {
  return walkBytes(path.join(root, 'audit'));
}

async function main(): Promise<void> {
  const materializer = await import(pathToFileURL(modulePath).href);
  const scheduledAt = Date.now();
  let timerFiredAt = 0;
  const timer = setTimeout(() => { timerFiredAt = Date.now(); }, 10);
  const startedAt = performance.now();
  const result = materializer.materializeAuditSnapshot(configDir, workspacePath);
  const durationMs = performance.now() - startedAt;
  await new Promise<void>((resolve) => setImmediate(resolve));
  clearTimeout(timer);

  const mirror = sumMirrorBytes(workspacePath);
  let indexTelemetry: unknown = null;
  try {
    const globalIndex = JSON.parse(fs.readFileSync(path.join(workspacePath, 'audit', '_index', 'global.json'), 'utf8'));
    indexTelemetry = globalIndex?.materializer || null;
  } catch { /* legacy or disabled runs may not produce an index */ }
  const resourceUsage = process.resourceUsage();
  const memory = process.memoryUsage();
  console.log(JSON.stringify({
    modulePath,
    configDir,
    workspacePath,
    source: walkBytes(configDir),
    durationMs: Number(durationMs.toFixed(2)),
    eventLoopDelayMs: timerFiredAt ? Math.max(0, timerFiredAt - scheduledAt - 10) : Math.max(0, durationMs - 10),
    maxRSSKiB: resourceUsage.maxRSS,
    endRSSBytes: memory.rss,
    endHeapUsedBytes: memory.heapUsed,
    mirror,
    indexTelemetry,
    result,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
