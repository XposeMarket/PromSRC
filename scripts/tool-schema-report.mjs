#!/usr/bin/env node
// Tool-definition (schema) cost report from .prometheus/model-usage.jsonl.
// Tool definitions are re-sent with every model call; this shows how many
// tokens they cost per call, what share of input that is, and which tools
// dominate (from the per-call toolSchemaTop sample recorded since 2026-10-02).
//
// Usage: node scripts/tool-schema-report.mjs [--days 3] [--file path] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const days = Number(flag('days', '3'));
const defaultFile = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Prometheus', '.prometheus', 'model-usage.jsonl');
const file = flag('file', defaultFile);
const asJson = args.includes('--json');
const since = Date.now() - days * 864e5;

const pct = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const calls = [];
const perTool = new Map();
const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (!(Date.parse(event.timestamp) >= since)) continue;
  const schema = Number(event.estimatedToolSchemaTokens);
  const input = Number(event.estimatedProviderInputTokens || event.inputTokens);
  if (!Number.isFinite(schema) || !Number.isFinite(input) || input <= 0) continue;
  calls.push({ schema, input, count: Number(event.toolSchemaCount) || null, provider: event.provider });
  for (const [name, tokens] of Array.isArray(event.toolSchemaTop) ? event.toolSchemaTop : []) {
    const entry = perTool.get(name) || { name, calls: 0, tokens: 0, maxTokens: 0 };
    entry.calls += 1;
    entry.tokens += Number(tokens) || 0;
    entry.maxTokens = Math.max(entry.maxTokens, Number(tokens) || 0);
    perTool.set(name, entry);
  }
}

const schemaTotal = calls.reduce((sum, c) => sum + c.schema, 0);
const inputTotal = calls.reduce((sum, c) => sum + c.input, 0);
const counts = calls.map((c) => c.count).filter((n) => n !== null);
const report = {
  file,
  days,
  calls: calls.length,
  schemaTokensPerCall: { p50: pct(calls.map((c) => c.schema), 0.5), p95: pct(calls.map((c) => c.schema), 0.95) },
  toolsPerCall: counts.length ? { p50: pct(counts, 0.5), p95: pct(counts, 0.95), sampledCalls: counts.length } : null,
  schemaShareOfInput: inputTotal ? +(100 * schemaTotal / inputTotal).toFixed(1) : 0,
  schemaTokensTotal: schemaTotal,
  topTools: [...perTool.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 25)
    .map((t) => ({ name: t.name, appearances: t.calls, avgTokens: Math.round(t.tokens / t.calls), totalTokens: t.tokens })),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Tool schema report (${report.calls} calls, last ${days}d)`);
  console.log(`  schema tokens/call  p50 ${report.schemaTokensPerCall.p50}  p95 ${report.schemaTokensPerCall.p95}`);
  if (report.toolsPerCall) console.log(`  tools/call          p50 ${report.toolsPerCall.p50}  p95 ${report.toolsPerCall.p95}  (${report.toolsPerCall.sampledCalls} calls with counts)`);
  console.log(`  share of input      ${report.schemaShareOfInput}%  (${(schemaTotal / 1e6).toFixed(1)}M tokens)`);
  if (report.topTools.length) {
    console.log('  heaviest tool definitions (total tokens across sampled calls):');
    for (const t of report.topTools) console.log(`    ${String(t.totalTokens).padStart(10)}  avg ${String(t.avgTokens).padStart(5)}  x${String(t.appearances).padStart(5)}  ${t.name}`);
  } else {
    console.log('  (no per-tool samples yet: toolSchemaTop is recorded on calls made after this change)');
  }
}
