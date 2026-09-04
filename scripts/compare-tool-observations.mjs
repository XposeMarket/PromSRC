import fs from 'node:fs';
import path from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readReport(filePath) {
  if (!filePath) throw new Error('missing required argument: --before or --after');
  const resolved = path.resolve(filePath);
  const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (report?.benchmark !== 'prometheus-tool-observations') {
    throw new Error(`unsupported benchmark in ${resolved}: ${String(report?.benchmark || 'missing')}`);
  }
  return report;
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function metricDelta(before, after) {
  const beforeValue = numberValue(before);
  const afterValue = numberValue(after);
  if (beforeValue === null || afterValue === null) {
    return { before: beforeValue, after: afterValue, absoluteChange: null, percentChange: null, reductionPercent: null };
  }
  const absoluteChange = afterValue - beforeValue;
  const percentChange = beforeValue === 0 ? null : (absoluteChange / beforeValue) * 100;
  return {
    before: beforeValue,
    after: afterValue,
    absoluteChange: Number(absoluteChange.toFixed(6)),
    percentChange: percentChange === null ? null : Number(percentChange.toFixed(3)),
    reductionPercent: percentChange === null ? null : Number((-percentChange).toFixed(3)),
  };
}

const TOOL_METRICS = [
  'calls',
  'successes',
  'failures',
  'errorRate',
  'retries',
  'turns',
  'totalDurationMs',
  'avgDurationMs',
  'p50Ms',
  'p95Ms',
  'p99Ms',
  'argsTokens',
  'resultTokens',
  'contextTokens',
  'resultBytes',
  'estimatedCostUsd',
];

function toolMap(report) {
  return new Map((Array.isArray(report?.aggregate?.byTool) ? report.aggregate.byTool : [])
    .map((row) => [String(row.tool), row]));
}

function compareReports(before, after) {
  const beforeTools = toolMap(before);
  const afterTools = toolMap(after);
  const names = [...new Set([...beforeTools.keys(), ...afterTools.keys()])].sort((a, b) => a.localeCompare(b));
  const addedTools = names.filter((name) => !beforeTools.has(name));
  const removedTools = names.filter((name) => !afterTools.has(name));
  const byTool = names
    .filter((name) => beforeTools.has(name) && afterTools.has(name))
    .map((tool) => {
      const beforeRow = beforeTools.get(tool);
      const afterRow = afterTools.get(tool);
      return {
        tool,
        source: afterRow.source,
        family: afterRow.family,
        currentlyRegistered: afterRow.currentlyRegistered,
        changes: Object.fromEntries(TOOL_METRICS.map((metric) => [metric, metricDelta(beforeRow[metric], afterRow[metric])])),
      };
    });

  const aggregateMetrics = Object.fromEntries(TOOL_METRICS.map((metric) => [
    metric,
    metricDelta(before.aggregate?.totals?.[metric], after.aggregate?.totals?.[metric]),
  ]));

  const improvements = [];
  for (const row of byTool) {
    for (const [metric, change] of Object.entries(row.changes)) {
      if (change.reductionPercent !== null && change.reductionPercent > 0) {
        improvements.push({ scope: 'tool', tool: row.tool, metric, ...change });
      }
    }
  }
  improvements.sort((a, b) => b.reductionPercent - a.reductionPercent);

  return {
    schemaVersion: 1,
    benchmark: 'prometheus-tool-observations-comparison',
    beforeCapturedAt: before.capturedAt || null,
    afterCapturedAt: after.capturedAt || null,
    measurementContract: {
      reductionPercent: 'Positive means the after value is lower than before. Zero-baseline ratios are null.',
      warning: 'These are historical observation-window comparisons; use identical controlled fixtures for causal claims.',
    },
    coverage: {
      beforeObservations: before.aggregate?.observations ?? null,
      afterObservations: after.aggregate?.observations ?? null,
      beforeUniqueTools: before.aggregate?.uniqueTools ?? null,
      afterUniqueTools: after.aggregate?.uniqueTools ?? null,
      matchedTools: byTool.length,
      addedTools,
      removedTools,
    },
    aggregateMetrics,
    byTool,
    largestImprovements: improvements.slice(0, 25),
  };
}

try {
  const comparison = compareReports(readReport(argument('--before')), readReport(argument('--after')));
  const serialized = `${JSON.stringify(comparison, null, 2)}\n`;
  const outputPath = argument('--output');
  if (outputPath) {
    const destination = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, 'utf8');
  }
  console.log(serialized);
} catch (error) {
  console.error(`[compare-tool-observations] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
