import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getToolRegistry, type Tool, type ToolProfile } from '../src/tools/registry.js';
import { estimateTextTokensForModel } from '../src/gateway/context/model-context.js';
import { inferToolPerformanceFamily } from '../src/gateway/chat/tool-performance-telemetry.js';
import { capabilityPolicyTier, resolveToolCapabilityMetadata } from '../src/gateway/tool-capabilities.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../src/extensions/legacy-connector-adapter.js';
import { getExtensionRuntimeRegistry } from '../src/extensions/runtime-registry.js';

const PROFILES: ToolProfile[] = ['minimal', 'coding', 'web', 'full', 'desktop'];
const DEFAULT_SAMPLES = 20;

type Distribution = {
  samples: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

type ProfileSurface = {
  toolCount: number;
  definitionBytes: number;
  estimatedDefinitionTokens: number;
  firstBuildMs: number;
  repeatedBuildMs: Distribution;
  toolNames: string[];
};

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function distribution(values: number[]): Distribution {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, value))
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return { samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const label = key(value);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sampleCount(): number {
  const configured = Number(process.env.PROMETHEUS_NATIVE_TOOL_SURFACE_SAMPLES || DEFAULT_SAMPLES);
  if (!Number.isFinite(configured)) return DEFAULT_SAMPLES;
  return Math.max(5, Math.min(100, Math.floor(configured)));
}

function outputPath(): string | undefined {
  const index = process.argv.indexOf('--output');
  if (index >= 0 && process.argv[index + 1]) return path.resolve(process.argv[index + 1]);
  const configured = String(process.env.PROMETHEUS_NATIVE_TOOL_SURFACE_OUTPUT || '').trim();
  return configured ? path.resolve(configured) : undefined;
}

function schemaFieldCount(tool: Tool): number {
  const schema = tool.jsonSchema;
  if (schema && typeof schema === 'object') {
    const properties = (schema as any).properties;
    if (properties && typeof properties === 'object') return Object.keys(properties).length;
    return Object.keys(schema).length;
  }
  return Object.keys(tool.schema || {}).length;
}

function measureProfile(registry: ReturnType<typeof getToolRegistry>, profile: ToolProfile, repetitions: number): ProfileSurface {
  const firstStartedAt = performance.now();
  const firstDefinitions = registry.getToolDefinitionsForChat(profile);
  const firstBuildMs = performance.now() - firstStartedAt;
  const warmTimings: number[] = [];
  let definitions = firstDefinitions;
  for (let index = 0; index < repetitions; index += 1) {
    const startedAt = performance.now();
    definitions = registry.getToolDefinitionsForChat(profile);
    warmTimings.push(performance.now() - startedAt);
  }
  const serialized = JSON.stringify(definitions);
  return {
    toolCount: definitions.length,
    definitionBytes: byteLength(definitions),
    estimatedDefinitionTokens: estimateTextTokensForModel(serialized, 'openai'),
    firstBuildMs: Number(firstBuildMs.toFixed(3)),
    repeatedBuildMs: distribution(warmTimings),
    toolNames: definitions
      .map((definition: any) => String(definition?.function?.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  };
}

function buildReport() {
  const registryAccessStartedAt = performance.now();
  ensurePrometheusExtensionRuntimeLoaded();
  const registry = getToolRegistry();
  const registryAccessMs = performance.now() - registryAccessStartedAt;
  const extensionNames = new Set(
    getExtensionRuntimeRegistry().listTools().map((tool) => String(tool.name || '').trim()).filter(Boolean),
  );
  const tools = registry.list().sort((a, b) => a.name.localeCompare(b.name));
  const repetitions = sampleCount();

  const profileSurfaces = Object.fromEntries(
    PROFILES.map((profile) => [profile, measureProfile(registry, profile, repetitions)]),
  ) as Record<ToolProfile, ProfileSurface>;

  const definitionsByName = new Map<string, { bytes: number; tokens: number }>();
  const visibleProfilesByName = new Map<string, Set<ToolProfile>>();
  for (const profile of PROFILES) {
    const definitions = registry.getToolDefinitionsForChat(profile);
    for (const definition of definitions) {
      const name = String(definition?.function?.name || '').trim();
      if (!name) continue;
      definitionsByName.set(name, {
        bytes: byteLength(definition),
        tokens: estimateTextTokensForModel(JSON.stringify(definition), 'openai'),
      });
      const visibleProfiles = visibleProfilesByName.get(name) || new Set<ToolProfile>();
      visibleProfiles.add(profile);
      visibleProfilesByName.set(name, visibleProfiles);
    }
  }

  const toolRows = tools.map((tool) => {
    const capabilities = resolveToolCapabilityMetadata(tool.name, tool.capabilities);
    const definition = definitionsByName.get(tool.name);
    const visibleProfiles = [...(visibleProfilesByName.get(tool.name) || new Set<ToolProfile>())]
      .sort((a, b) => a.localeCompare(b));
    return {
      name: tool.name,
      source: extensionNames.has(tool.name) ? 'extension' : 'native',
      family: inferToolPerformanceFamily(tool.name),
      policyTier: capabilityPolicyTier(capabilities),
      capabilities: {
        readOnly: capabilities.readOnly,
        localWrite: capabilities.localWrite,
        externalWrite: capabilities.externalWrite,
        destructive: capabilities.destructive,
        credentialUse: capabilities.credentialUse,
        known: capabilities.known,
      },
      descriptionChars: String(tool.description || '').length,
      schemaFields: schemaFieldCount(tool),
      schemaBytes: byteLength(tool.jsonSchema ?? tool.schema ?? {}),
      providerDefinitionBytes: definition?.bytes ?? null,
      estimatedProviderDefinitionTokens: definition?.tokens ?? null,
      visibleProfiles,
      liveExecutionCovered: false,
    };
  });

  const report = {
    schemaVersion: 1,
    benchmark: 'prometheus-native-tool-surface',
    capturedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    measurementContract: {
      scope: 'Every tool currently returned by ToolRegistry.list().',
      execution: 'Surface-only. No tool execute() function is called.',
      tokenMethod: 'estimateTextTokensForModel(..., openai) over serialized provider definitions; estimates, not billing usage.',
      privacy: 'Only names, categories, capability flags, sizes, timings, and counts are emitted; argument/result contents are excluded.',
      comparisonKey: 'tool name + profile + source + schemaVersion',
    },
    registry: {
      registeredToolCount: tools.length,
      nativeToolCount: toolRows.filter((tool) => tool.source === 'native').length,
      extensionToolCount: toolRows.filter((tool) => tool.source === 'extension').length,
      extensionRuntimeToolCount: extensionNames.size,
      registryAccessMs: Number(registryAccessMs.toFixed(3)),
      samplesPerProfile: repetitions,
    },
    counts: {
      bySource: countBy(toolRows, (tool) => tool.source),
      byFamily: countBy(toolRows, (tool) => tool.family),
      byPolicyTier: countBy(toolRows, (tool) => tool.policyTier),
      byVisibility: {
        visibleInFull: toolRows.filter((tool) => tool.visibleProfiles.includes('full')).length,
        hiddenFromAllProfiles: toolRows.filter((tool) => tool.visibleProfiles.length === 0).length,
      },
    },
    providerSurfaces: profileSurfaces,
    tools: toolRows,
  };
  return report;
}

const report = buildReport();
const destination = outputPath();
if (destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
