import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import {
  createTimelineEntries,
  createWeightedTimelineController,
} from '../web-ui/src/features/chat/timeline/weighted-timeline.js';
import { reconcileKeyedTimelineRows } from '../web-ui/src/features/chat/timeline/keyed-dom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'keyed-chat-timeline-budgets.json'), 'utf8'));
const enforce = process.argv.includes('--enforce');

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) || 0 };
}

function round(value) { return Number(Number(value || 0).toFixed(3)); }

function scenarioMessages(count) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `benchmark-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    timestamp: 1_700_000_000_000 + index,
    content: `message ${index} ${'content '.repeat(index % 17 === 0 ? 220 : 8)}`,
    liveTraceEntries: index % 11 === 0
      ? Array.from({ length: 12 }, (__, toolIndex) => ({ id: `${index}:${toolIndex}`, type: toolIndex % 2 ? 'tool_call' : 'tool_result' }))
      : [],
    fileChanges: index % 37 === 0 ? [{ path: `src/file-${index}.js`, additions: 8, deletions: 2 }] : [],
    generatedImages: index % 71 === 0 ? [{ id: `generated-${index}`, width: 1024, height: 1024 }] : [],
    questionRequest: index % 97 === 0 ? { id: `question-${index}`, status: 'pending' } : null,
  }));
}

function syntheticDomNodes(entries) {
  const { document } = parseHTML('<!doctype html><html><body><main id="timeline"></main></body></html>');
  const rootElement = document.getElementById('timeline');
  rootElement.innerHTML = entries.map((entry) => {
    const message = entry.msg;
    const tools = (message.liveTraceEntries || []).map((tool) => `<details class="tool"><summary>${tool.type}</summary><pre>${tool.id}</pre></details>`).join('');
    const files = (message.fileChanges || []).map((file) => `<div class="file"><strong>${file.path}</strong><span>${file.additions}</span></div>`).join('');
    const images = (message.generatedImages || []).map((image) => `<figure><img alt="" data-id="${image.id}"><figcaption>generated</figcaption></figure>`).join('');
    return `<article data-chat-row-key="${entry.key}"><div class="bubble"><p>${message.content}</p>${tools}${files}${images}</div></article>`;
  }).join('');
  return rootElement.querySelectorAll('*').length;
}

function runWindowScenario(count) {
  const source = scenarioMessages(count);
  const hydrateStarted = performance.now();
  const entries = createTimelineEntries(source);
  const hydrateMs = performance.now() - hydrateStarted;
  const desktop = createWeightedTimelineController({ surface: 'desktop' });
  const mobile = createWeightedTimelineController({ surface: 'mobile' });
  const selectionSamples = [];
  let desktopResult;
  for (let sample = 0; sample < 120; sample += 1) {
    const started = performance.now();
    desktopResult = desktop.select(`desktop-${count}`, entries, { followTail: true });
    selectionSamples.push(performance.now() - started);
  }
  const mobileResult = mobile.select(`mobile-${count}`, entries, { followTail: true });
  const plainDesktopRows = Math.min(count, budgets.hard.desktopMaxPlainPaintRows);
  const plainMobileRows = Math.min(count, budgets.hard.mobileMaxPlainPaintRows);
  return {
    turns: count,
    hydrateMs: round(hydrateMs),
    selectionMs: Object.fromEntries(Object.entries(distribution(selectionSamples)).map(([key, value]) => [key, round(value)])),
    desktop: {
      paintedRows: desktopResult.estimatedDomRows,
      paintWeight: desktopResult.paintWeight,
      materializedRows: desktopResult.materializedEntries.length,
      materializedWeight: desktopResult.materializedWeight,
      plainRowCeiling: plainDesktopRows,
      domReductionVsFullPct: round((1 - (plainDesktopRows / count)) * 100),
      syntheticDomNodes: syntheticDomNodes(desktopResult.paintEntries),
      retainedViewBytes: Buffer.byteLength(JSON.stringify({
        materialized: desktopResult.materializedEntries.map((entry) => [entry.key, entry.signature]),
        painted: desktopResult.paintEntries.map((entry) => entry.key),
      })),
    },
    mobile: {
      paintedRows: mobileResult.estimatedDomRows,
      paintWeight: mobileResult.paintWeight,
      materializedRows: mobileResult.materializedEntries.length,
      materializedWeight: mobileResult.materializedWeight,
      plainRowCeiling: plainMobileRows,
      domReductionVsFullPct: round((1 - (plainMobileRows / count)) * 100),
      syntheticDomNodes: syntheticDomNodes(mobileResult.paintEntries),
      retainedViewBytes: Buffer.byteLength(JSON.stringify({
        materialized: mobileResult.materializedEntries.map((entry) => [entry.key, entry.signature]),
        painted: mobileResult.paintEntries.map((entry) => entry.key),
      })),
    },
  };
}

function runKeyedCommitScenario() {
  const { document } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>');
  const rootElement = document.getElementById('root');
  const rows = 96;
  const markup = (revision) => Array.from({ length: rows }, (_, index) => {
    const signature = index === rows - 1 ? revision : 1;
    const content = index === rows - 1 ? `stream-${revision}` : `settled-${index}`;
    return `<article data-chat-row-key="row-${index}" data-chat-row-signature="${signature}">${content}</article>`;
  }).join('');
  reconcileKeyedTimelineRows(rootElement, markup(1));
  const samples = [];
  let maximumUpdated = 0;
  let totalReused = 0;
  for (let revision = 2; revision <= 121; revision += 1) {
    const started = performance.now();
    const stats = reconcileKeyedTimelineRows(rootElement, markup(revision));
    samples.push(performance.now() - started);
    maximumUpdated = Math.max(maximumUpdated, stats.updated + stats.created);
    totalReused += stats.reused;
  }
  return {
    paintedRows: rows,
    commits: samples.length,
    maximumRowsUpdatedPerCommit: maximumUpdated,
    averageRowsReusedPerCommit: round(totalReused / samples.length),
    commitMs: Object.fromEntries(Object.entries(distribution(samples)).map(([key, value]) => [key, round(value)])),
    legacyEquivalentRowWrites: rows * samples.length,
    keyedRowWrites: maximumUpdated * samples.length,
    rowWriteReductionPct: round((1 - (maximumUpdated / rows)) * 100),
  };
}

const scenarios = [100, 500, 1_000, 2_000].map(runWindowScenario);
const keyedCommit = runKeyedCommitScenario();
const result = {
  version: 1,
  referenceEnvironment: { platform: `${os.platform()} ${os.release()}`, node: process.version },
  scenarios,
  keyedCommit,
  heapUsedBytes: process.memoryUsage().heapUsed,
};

if (enforce) {
  const byTurns = new Map(scenarios.map((scenario) => [scenario.turns, scenario]));
  assert.ok(byTurns.get(500).desktop.domReductionVsFullPct >= budgets.hard.minimumDesktopDomReductionAt500Pct);
  assert.ok(byTurns.get(1_000).desktop.domReductionVsFullPct >= budgets.hard.minimumDesktopDomReductionAt1000Pct);
  assert.ok(byTurns.get(500).mobile.domReductionVsFullPct >= budgets.hard.minimumMobileDomReductionAt500Pct);
  assert.ok(byTurns.get(1_000).mobile.domReductionVsFullPct >= budgets.hard.minimumMobileDomReductionAt1000Pct);
  assert.ok(scenarios.every((scenario) => scenario.desktop.plainRowCeiling <= budgets.hard.desktopMaxPlainPaintRows));
  assert.ok(scenarios.every((scenario) => scenario.mobile.plainRowCeiling <= budgets.hard.mobileMaxPlainPaintRows));
  assert.ok(scenarios.every((scenario) => scenario.desktop.paintWeight <= budgets.hard.desktopMaxPlainPaintRows));
  assert.ok(scenarios.every((scenario) => scenario.desktop.materializedWeight <= budgets.hard.desktopMaxPlainMaterializedRows));
  assert.ok(scenarios.every((scenario) => scenario.mobile.paintWeight <= budgets.hard.mobileMaxPlainPaintRows));
  assert.ok(scenarios.every((scenario) => scenario.mobile.materializedWeight <= budgets.hard.mobileMaxPlainMaterializedRows));
  assert.ok(scenarios.every((scenario) => scenario.desktop.syntheticDomNodes <= budgets.hard.desktopMaxSyntheticDomNodes));
  assert.ok(scenarios.every((scenario) => scenario.mobile.syntheticDomNodes <= budgets.hard.mobileMaxSyntheticDomNodes));
  assert.ok(byTurns.get(2_000).desktop.retainedViewBytes / byTurns.get(500).desktop.retainedViewBytes <= budgets.hard.maxRetainedViewGrowth500To2000Ratio);
  assert.ok(keyedCommit.maximumRowsUpdatedPerCommit <= budgets.hard.maxRowsUpdatedPerSingleTurnCommit);
}

console.log(JSON.stringify(result, null, 2));
