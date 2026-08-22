import path from 'node:path';
import { discoverStorageMigrationCandidates, executeStorageLayoutV2Migration } from './storage-migration.js';
import { resolvePrometheusLayout } from './storage-layout.js';

type ParsedArgs = {
  execute: boolean;
  sourceConfig?: string;
  sourceWorkspace?: string;
  appData?: string;
  runtime?: string;
  workspace?: string;
  migrationId?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return path.resolve(value);
    };
    if (arg === '--execute') out.execute = true;
    else if (arg === '--source-config') out.sourceConfig = next();
    else if (arg === '--source-workspace') out.sourceWorkspace = next();
    else if (arg === '--app-data') out.appData = next();
    else if (arg === '--runtime') out.runtime = next();
    else if (arg === '--workspace') out.workspace = next();
    else if (arg === '--migration-id') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      out.migrationId = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Prometheus storage-layout v2 migration',
        '',
        'Dry-run discovery (default):',
        '  npx --no-install tsx src/runtime/storage-migration-cli.ts',
        '',
        'Execute copy + verification:',
        '  npx --no-install tsx src/runtime/storage-migration-cli.ts --execute',
        '',
        'Overrides:',
        '  --source-config <path>',
        '  --source-workspace <path>',
        '  --app-data <path>',
        '  --runtime <path>',
        '  --workspace <path>',
        '  --migration-id <id>',
        '',
        'Execution never deletes or renames source data and never overwrites a different destination file.',
        'A successful run verifies the canonical copy only; live activation is a separate phase.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const env: NodeJS.ProcessEnv = { ...process.env, PROMETHEUS_STORAGE_LAYOUT: 'canonical' };
  if (args.appData) env.PROMETHEUS_DATA_DIR = args.appData;
  if (args.runtime) env.PROMETHEUS_RUNTIME_DIR = args.runtime;
  if (args.workspace) env.PROMETHEUS_WORKSPACE_DIR = args.workspace;

  const layout = resolvePrometheusLayout({ env });
  const candidates = discoverStorageMigrationCandidates(layout);

  console.log(JSON.stringify({
    mode: args.execute ? 'execute' : 'dry-run',
    layoutVersion: layout.version,
    target: {
      appDataRoot: layout.appDataRoot,
      runtimeRoot: layout.runtime.root,
      workspaceRoot: layout.workspace.root,
    },
    candidates,
    selectedSource: {
      config: args.sourceConfig || layout.legacy.activeConfig,
      workspace: args.sourceWorkspace || layout.legacy.activeWorkspace,
    },
  }, null, 2));

  if (!args.execute) {
    console.log('\nDry run only. Re-run with --execute to create verified copies.');
    return;
  }

  const manifest = executeStorageLayoutV2Migration({
    layout,
    sourceConfigRoot: args.sourceConfig,
    sourceWorkspaceRoot: args.sourceWorkspace,
    migrationId: args.migrationId,
  });
  console.log('\nMigration result:');
  console.log(JSON.stringify(manifest, null, 2));

  if (!manifest.copyVerified) {
    console.error('\nMigration did not produce a verified canonical copy. Resolve conflicts/errors/skipped symlinks from the manifest first.');
    process.exitCode = 2;
    return;
  }
  console.log('\nCanonical copy verified. Live activation remains a separate phase with its own reader-continuity checks. Source data was left intact.');
}

main();
