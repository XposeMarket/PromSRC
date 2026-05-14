#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const builtModule = path.join(cwd, 'dist', 'gateway', 'creative', 'hyperframes-catalog.js');
  if (!fs.existsSync(builtModule)) {
    throw new Error('Build output not found. Run `npm run build:backend` before syncing HyperFrames from the CLI.');
  }
  const { importHyperframesCatalog, importHyperframesCatalogWithIngest } = require(builtModule);
  const ingest = args.ingest === true || args.ingest === 'true';
  const sessionId = String(args.session || args.sessionId || 'default').trim() || 'default';
  const rootAbsPath = path.resolve(cwd, 'creative-projects', sessionId.replace(/[^a-z0-9._-]+/gi, '-'));
  const storage = {
    workspacePath: cwd,
    rootAbsPath,
    rootRelPath: path.relative(cwd, rootAbsPath).replace(/\\/g, '/'),
    creativeDir: path.join(rootAbsPath, 'prometheus-creative'),
  };
  const ids = typeof args.ids === 'string'
    ? args.ids.split(',').map((part) => part.trim()).filter(Boolean)
    : undefined;
  // When --ingest is passed, route assets through the content-hash creative
  // asset index (re-imports are deduped). Otherwise keep legacy behaviour.
  const opts = {
    ids,
    query: typeof args.query === 'string' ? args.query : undefined,
    limit: Number(args.limit) || undefined,
    live: args.live === true || args.live === 'true',
  };
  const assetStorage = {
    workspacePath: cwd,
    rootAbsPath,
    rootRelPath: path.relative(cwd, rootAbsPath).replace(/\\/g, '/'),
    creativeDir: path.join(rootAbsPath, 'prometheus-creative'),
  };
  const synced = ingest
    ? await importHyperframesCatalogWithIngest(storage, assetStorage, opts)
    : await importHyperframesCatalog(storage, opts);
  const summary = {
    creativeDir: storage.creativeDir,
    catalogCount: synced.catalogCount,
    selectedCount: synced.selectedCount,
    importedCount: synced.imported.length,
    failedCount: synced.failed.length,
    imported: synced.imported.map((entry) => ({
      id: entry.item.id,
      name: entry.item.name,
      importedAs: entry.importedAs,
      savedId: entry.template?.id || entry.block?.id,
      assets: entry.assets.length,
      warnings: entry.warnings,
    })),
    failed: synced.failed,
    ingest: synced.ingest ? {
      registered: synced.ingest.results.length,
      reused: synced.ingest.results.filter((r) => r.reused).length,
      failed: synced.ingest.failed.length,
    } : null,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (synced.imported.length === 0 && synced.failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
