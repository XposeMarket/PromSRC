import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observeCodingContext, resetCodingContextPacketsForTest, selectCodingContextPacket } from './coding-context-packet';

const packetStore = path.join(os.tmpdir(), `prom-coding-context-benchmark-${process.pid}.json`);
process.env.PROMETHEUS_CODING_CONTEXT_PACKET_STORE = packetStore;
const root = process.cwd();
const target = 'src/gateway/coding-context-packet.ts';
const content = fs.readFileSync(path.join(root, target));
const digest = crypto.createHash('sha256').update(content).digest('hex');
const now = Date.now();

resetCodingContextPacketsForTest();
observeCodingContext({
  sessionId: 'benchmark', objective: `Continue editing ${target}`, projectRoot: root,
  toolName: 'workspace_edit', args: { action: 'find_replace', path: target }, result: 'ok', now,
  extra: {
    codeEvidence: {
      version: 1, kind: 'code_evidence', tool_name: 'workspace_edit', operation: 'mutation',
      generated_at: new Date(now).toISOString(), generation_ms: 1, truncated: false,
      files: [{
        path: target, operation: 'update', exists_after: true,
        authoritative_content_sha256: digest, size_bytes: content.length, line_count: 700,
        changed_ranges: [{ before_start_line: 100, before_end_line: 102, after_start_line: 100, after_end_line: 103 }],
        post_edit_windows: [{
          start_line: 97, end_line: 106, changed_start_line: 100, changed_end_line: 103,
          content: '  97: context\n> 100: authoritative post-edit line\n> 101: another changed line\n  106: context', truncated: false,
        }],
        evidence_complete: true, observed_at: new Date(now).toISOString(), provenance: 'benchmark:authoritative',
      }],
    },
  },
});

const select = (packetVersion: 2 | 3) => selectCodingContextPacket({
  enabled: true, sessionId: 'benchmark', message: `Continue with ${target}.`, projectRoot: root,
  executionMode: 'interactive', packetVersion, now: now + 10,
});
const v2 = select(2);
const v3 = select(3);
const iterations = 500;
const durations: number[] = [];
for (let index = 0; index < iterations; index++) {
  const started = performance.now();
  select(3);
  durations.push(performance.now() - started);
}
durations.sort((a, b) => a - b);
const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
const report = {
  iterations,
  v2_packet_bytes: Buffer.byteLength(v2.block, 'utf8'),
  v3_packet_bytes: Buffer.byteLength(v3.block, 'utf8'),
  v2_has_actionable_post_edit_window: /post_edit_windows/.test(v2.block),
  v3_has_actionable_post_edit_window: /authoritative post-edit line/.test(v3.block) && /state_matches_evidence": true/.test(v3.block),
  v3_selection_p95_ms: Number(p95.toFixed(3)),
};
console.log(JSON.stringify(report, null, 2));
fs.rmSync(packetStore, { force: true });
