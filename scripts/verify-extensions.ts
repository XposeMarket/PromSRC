/* eslint-disable no-console */
// Extension registry guardrail check. Loads the runtime and runs the consistency
// rules from src/extensions/consistency.ts. Exits non-zero on any error-level
// issue. Run with: npx tsx scripts/verify-extensions.ts
import { ensurePrometheusExtensionRuntimeLoaded } from '../src/extensions/legacy-connector-adapter.js';
import { checkExtensionConsistency } from '../src/extensions/consistency.js';
import { getExtensionRuntimeRegistry } from '../src/extensions/runtime-registry.js';

ensurePrometheusExtensionRuntimeLoaded();

const registry = getExtensionRuntimeRegistry();
console.log(`[verify-extensions] connectors=${registry.listConnectors().length} tools=${registry.listTools().length}`);

const issues = checkExtensionConsistency();
const errors = issues.filter((i) => i.level === 'error');
const warns = issues.filter((i) => i.level === 'warn');

for (const i of issues) {
  console.log(`  [${i.level}] ${i.code}: ${i.message}`);
}

console.log(`[verify-extensions] ${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
