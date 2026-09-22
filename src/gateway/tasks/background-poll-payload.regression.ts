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

console.log('background-poll-payload regression: ok');
