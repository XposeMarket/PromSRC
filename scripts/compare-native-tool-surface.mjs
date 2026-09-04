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
  if (report?.benchmark !== 'prometheus-native-tool-surface') {
    throw new Error(`unsupported benchmark in ${resolved}: ${String(report?.benchmark || 'missing')}`);
  }
  return report;
}

function metricDelta(before, after) {
  const beforeValue = Number.isFinite(Number(before)) ? Number(before) : null;
  const afterValue = Number.isFinite(Number(after)) ? Number(after) : null;
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

function metricMap(before, after, metrics) {
  return Object.fromEntries(metrics.map((metric) => [metric, metricDelta(before?.[metric], after?.[metric])]));
}

function toolMap(report) {
  return new Map((Array.isArray(report?.tools) ? report.tools : []).map((tool) => [String(tool.name), tool]));
}

function surfaceMetricMap(report) {
  const metrics = {};
  for (const [profile, surface] of Object.entries(report?.providerSurfaces || {})) {
    metrics[`providerSurfaces.${profile}.toolCount`] = surface?.toolCount;
    metrics[`providerSurfaces.${profile}.definitionBytes`] = surface?.definitionBytes;
    metrics[`providerSurfaces.${profile}.estimatedDefinitionTokens`] = surface?.estimatedDefinitionTokens;
    metrics[`providerSurfaces.${profile}.firstBuildMs`] = surface?.firstBuildMs;
    metrics[`providerSurfaces.${profile}.repeatedBuildMs.p50Ms`] = surface?.repeatedBuildMs?.p50Ms;
    metrics[`providerSurfaces.${profile}.repeatedBuildMs.p95Ms`] = surface?.repeatedBuildMs?.p95Ms;
  }
  metrics['registry.registeredToolCount'] = report?.registry?.registeredToolCount;
  metrics['registry.nativeToolCount'] = report?.registry?.nativeToolCount;
  metrics['registry.extensionToolCount'] = report?.registry?.extensionToolCount;
  metrics['registry.registryAccessMs'] = report?.registry?.registryAccessMs;
  return metrics;
}

function compareReports(before, after) {
  const beforeTools = toolMap(before);
  const afterTools = toolMap(after);
  const names = [...new Set([...beforeTools.keys(), ...afterTools.keys()])].sort((a, b) => a.localeCompare(b));
  const addedTools = names.filter((name) => !beforeTools.has(name));
  const removedTools = names.filter((name) => !afterTools.has(name));
  const perToolMetrics = [
    'descriptionChars',
    'schemaFields',
    'schemaBytes',
    'providerDefinitionBytes',
    'estimatedProviderDefinitionTokens',
  ];
  const byTool = names
    .filter((name) => beforeTools.has(name) && afterTools.has(name))
    .map((name) => {
      const beforeTool = beforeTools.get(name);
      const afterTool = afterTools.get(name);
      return {
        name,
        source: afterTool.source,
        family: afterTool.family,
        policyTier: afterTool.policyTier,
        changes: metricMap(beforeTool, afterTool, perToolMetrics),
      };
    });

  const beforeSurface = surfaceMetricMap(before);
  const afterSurface = surfaceMetricMap(after);
  const surfaceMetricNames = [...new Set([...Object.keys(beforeSurface), ...Object.keys(afterSurface)])].sort();
  const surfaceMetrics = Object.fromEntries(surfaceMetricNames.map((name) => [name, metricDelta(beforeSurface[name], afterSurface[name])]));

  const improvements = [];
  for (const row of byTool) {
    for (const [metric, change] of Object.entries(row.changes)) {
      if (change.reductionPercent !== null && change.reductionPercent > 0) {
        improvements.push({ scope: 'tool', name: row.name, metric, ...change });
      }
    }
  }
  for (const [metric, change] of Object.entries(surfaceMetrics)) {
    if (change.reductionPercent !== null && change.reductionPercent > 0) {
      improvements.push({ scope: 'surface', name: metric, metric: 'surface', ...change });
    }
  }
  improvements.sort((a, b) => b.reductionPercent - a.reductionPercent);

  return {
    schemaVersion: 1,
    benchmark: 'prometheus-native-tool-surface-comparison',
    beforeCapturedAt: before.capturedAt || null,
    afterCapturedAt: after.capturedAt || null,
    comparisonKey: before.measurementContract?.comparisonKey || 'tool name + profile + source + schemaVersion',
    coverage: {
      beforeRegisteredToolCount: before.registry?.registeredToolCount ?? null,
      afterRegisteredToolCount: after.registry?.registeredToolCount ?? null,
      matchedTools: byTool.length,
      addedTools,
      removedTools,
    },
    surfaceMetrics,
    byTool,
    largestImprovements: improvements.slice(0, 25),
  };
}

const beforePath = argument('--before');
const afterPath = argument('--after');
const outputPath = argument('--output');
try {
  const comparison = compareReports(readReport(beforePath), readReport(afterPath));
  const serialized = `${JSON.stringify(comparison, null, 2)}\n`;
  if (outputPath) {
    const destination = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, 'utf8');
  }
  console.log(serialized);
} catch (error) {
  console.error(`[compare-native-tool-surface] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
