#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runEvaluation, validateCorpus, digest } from './lib/agent-behavior-evals.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/agent-behavior-evals.mjs --fixture | --replay FILE [--output FILE]\nReplay format: {version:1,corpusHash,provider,model,responses:{caseId:[{type:"tool",name,arguments}|{type:"final",outcome,claims}]}}. Fixture mode checks scoring only, NOT model quality. Trailing replay responses after final fail the trial. Nothing executes real tools.');
  process.exit(0);
}
const value = (flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${flag} value`); return args[i + 1]; };
try {
  const valid = new Set(['--fixture', '--replay', '--output']);
  for (let i = 0; i < args.length; i++) { if (!valid.has(args[i])) throw new Error(`Unknown option ${args[i]}`); if (args[i] !== '--fixture') i++; }
  const replayPath = value('--replay'), output = value('--output');
  if (Boolean(replayPath) === args.includes('--fixture')) throw new Error('Choose exactly one of --fixture or --replay');
  const read = (p) => { if (fs.statSync(p).size > 1_000_000) throw new Error('Input too large'); const raw = fs.readFileSync(p, 'utf8'); try { return JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${path.basename(p)}`); } };
  const corpus = validateCorpus(read(new URL('./fixtures/agent-behavior-cases.json', import.meta.url)));
  const replay = replayPath ? read(replayPath) : null;
  if (replayPath && (!replay || !['provider', 'model'].every(k => typeof replay[k] === 'string' && replay[k].trim().length > 0 && replay[k].length < 200))) throw new Error('Replay requires explicit provider and model provenance');
  if (replay && (replay.version !== 1 || replay.corpusHash !== digest(corpus) || !replay.responses || Object.keys(replay.responses).length !== corpus.cases.length || corpus.cases.some(c => !Array.isArray(replay.responses[c.id]) || replay.responses[c.id].length > 30))) throw new Error('Replay must match exact corpus and include every case');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
  const report = await runEvaluation(corpus, id => {
    const c = corpus.cases.find(c => c.id === id);
    const responses = replay ? replay.responses[id] : [...c.expected.calls.map(i => ({ type: 'tool', name: c.fixtures[i].name, arguments: c.fixtures[i].arguments })), { type: 'final', outcome: c.expected.outcome, claims: [] }];
    let next = 0;
    return Object.assign(async () => { if (next >= responses.length) throw new Error('Replay exhausted'); return responses[next++]; }, { unconsumed: () => responses.length - next });
  }, { mode: replay ? 'replay' : 'fixture', provider: replay?.provider || 'none', model: replay?.model || 'oracle-fixtures', providerDeclared: replay?.provider ?? null, modelDeclared: replay?.model ?? null, replayHash: replay ? digest(replay) : null, provenanceNote: replay ? 'provider/model are declared by the capture file and not verified; replayHash identifies the exact capture scored' : 'fixture oracle; no provider or model was called', head: git('rev-parse', 'HEAD'), base: git('merge-base', 'HEAD', 'origin/main'), dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')), node: process.version, platform: process.platform });
  // Persist only bounded scores/IDs, never raw prompts, model text, tokens, or adapter errors.
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, json, { flag: 'wx', mode: 0o600 }); }
  console.log(json);
  process.exitCode = report.summary.passed === report.summary.trials ? 0 : 1;
} catch (error) { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 2; }
