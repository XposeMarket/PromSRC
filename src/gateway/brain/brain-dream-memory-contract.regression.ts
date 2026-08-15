import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getFileWebMemoryTools } from '../tools/defs/file-web-memory.js';

const definitions = getFileWebMemoryTools();
const names = new Set(definitions.map((tool: any) => String(tool?.function?.name || '')));
assert.ok(names.has('memory'), 'unified model-facing memory tool must exist');
assert.ok(!names.has('memory_write'), 'legacy memory_write must remain internal rather than becoming a second model schema');
const memoryDef = definitions.find((tool: any) => tool?.function?.name === 'memory');
assert.ok(memoryDef?.function?.parameters?.properties?.action?.enum?.includes('update'), 'unified memory schema must expose exact update');
assert.ok(memoryDef?.function?.parameters?.properties?.previous_content, 'unified memory update must expose previous_content');

const runner = fs.readFileSync(path.join(process.cwd(), 'src/gateway/brain/brain-runner.ts'), 'utf8');
const dreamStart = runner.indexOf("`CONTEXT: Automated Brain Dream run for ${dateStr}");
assert.ok(dreamStart >= 0, 'Dream handleChat call must remain discoverable');
const filterStart = runner.indexOf('brainDreamToolFilter([', dreamStart);
const filterEnd = runner.indexOf(']),', filterStart);
assert.ok(filterStart >= 0 && filterEnd > filterStart, 'Dream tool allowlist must remain discoverable');
const dreamFilter = runner.slice(filterStart, filterEnd);
assert.match(dreamFilter, /'memory'/, 'Dream must allow the real unified writable memory tool');
assert.doesNotMatch(dreamFilter, /'memory_write'/, 'Dream must not allowlist an internal legacy name that has no model definition');
assert.match(runner, /memory\(action="update"/, 'Dream prompt must teach exact contradiction correction');
console.log('brain Dream durable-memory contract regression: ok');
