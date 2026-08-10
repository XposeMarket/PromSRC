import assert from 'node:assert/strict';
import { buildRuntimeHostContext } from './runtime-host-context';

const context = buildRuntimeHostContext({ workspacePath: 'C:\\workspace\\prometheus' });

assert.match(context, /^\[RUNTIME_HOST_CONTEXT\]/);
assert.match(context, /platform: /);
assert.match(context, /architecture: /);
assert.match(context, /logical_cpu_cores: /);
assert.match(context, /memory_total: /);
assert.match(context, /Prometheus shell selector: (powershell|bash)/);
assert.match(context, /workspace_root: C:\\workspace\\prometheus/);
assert.doesNotMatch(context, /hostname:/i);
assert.doesNotMatch(context, /serial/i);
assert.doesNotMatch(context, /mac_address/i);

console.log('runtime-host-context regression passed');
