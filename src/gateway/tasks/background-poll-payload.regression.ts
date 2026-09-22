import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Background-agent poll responses (status / progress / wait) must not echo the
// full spawn prompt. A main-chat turn that polls 10-20 times for 3 agents was
// re-ingesting tens of KB of text it authored itself. Only the spawn response
// carries the prompt once; every poll carries promptPreview.
//
// backgroundSpawn() starts real execution, so this is a static contract check
// on the serializers rather than a live spawn (same approach as
// background-spawn-tool-surface.regression.ts).

const source = readFileSync(path.join(__dirname, 'task-runner.ts'), 'utf8');

function extractFunctionBody(name: string): string {
  const start = source.indexOf(name);
  assert(start >= 0, `could not locate ${name} in task-runner.ts`);
  // Skip the parameter list (which may contain object-type braces) and start
  // counting at the body's opening brace.
  let paren = 0;
  let sigEnd = start;
  for (let i = source.indexOf('(', start); i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')') {
      paren--;
      if (paren === 0) { sigEnd = i; break; }
    }
  }
  const open = source.indexOf('{', sigEnd);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${name}`);
}

const statusBody = extractFunctionBody('export function backgroundStatus(');
const recordBody = extractFunctionBody('function statusFromRecord(');
const spawnBody = extractFunctionBody('export function backgroundSpawn(');

for (const [label, body] of [['backgroundStatus', statusBody], ['statusFromRecord', recordBody]] as const) {
  assert(!/\bprompt: rec\.prompt\b/.test(body), `${label} must not serialize the full prompt on polls`);
  assert(!/^\s*prompt,\s*$/m.test(body), `${label} must not serialize the full prompt on polls`);
  assert(/promptPreview: rec\.promptPreview/.test(body), `${label} must keep promptPreview`);
}

// The spawn response is the one place the full prompt is returned.
assert(/^\s*prompt,\s*$/m.test(spawnBody), 'backgroundSpawn response should still carry the prompt once');
assert(/promptPreview: record\.promptPreview/.test(spawnBody), 'backgroundSpawn response should carry promptPreview');

// backgroundWait builds its per-agent statuses through statusFromRecord, so the
// contract above covers wait responses too.
const waitBody = extractFunctionBody('export async function backgroundWait(');
assert(/\bstatusFromRecord\b/.test(waitBody), 'backgroundWait must serialize agents via statusFromRecord');
assert(!/\bprompt: rec\.prompt\b/.test(waitBody), 'backgroundWait must not inline the full prompt');


// ── Explicit wait ceiling ───────────────────────────────────────────────────
// The re-poll loop that caused the prompt echo was driven by a 120s hard clamp:
// a caller asking to wait 10 minutes was silently clamped to 2, timed out, and
// polled again. Real spawns run 20-30 minutes, so an EXPLICIT wait must be able
// to exceed two minutes. The unspecified default stays short so an omitted
// timeout never blocks a foreground turn for half an hour.
const capMatch = source.match(/const BACKGROUND_WAIT_ALL_CAP_MS = ([0-9_]+);/);
assert(capMatch, 'BACKGROUND_WAIT_ALL_CAP_MS must remain declared');
const capMs = Number(capMatch![1].replace(/_/g, ''));
assert.ok(
  capMs >= 1_800_000,
  `explicit background waits must allow >= 30min to match sibling agent/team wait tools, got ${capMs}ms`,
);

const defMatch = source.match(/const DEFAULT_BACKGROUND_TIMEOUT_MS = ([0-9_]+);/);
assert(defMatch, 'DEFAULT_BACKGROUND_TIMEOUT_MS must remain declared');
const defMs = Number(defMatch![1].replace(/_/g, ''));
assert.ok(defMs <= 120_000, `unspecified background wait default must stay short, got ${defMs}ms`);
assert.ok(defMs < capMs, 'default wait must be below the explicit ceiling');

// The clamp must still floor absurd/negative input rather than trusting callers.
assert.ok(
  /Math\.max\(500,\s*Math\.min\(BACKGROUND_WAIT_ALL_CAP_MS/.test(source),
  'clampBackgroundTimeoutMs must keep flooring at 500ms and ceiling at the cap',
);

console.log('background-poll-payload regression: ok');
