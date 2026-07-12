import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
  ALL_TOOL_CATEGORIES,
  buildTools,
  getCanonicalToolCategory,
  getLegacyToolCategory,
  getRuntimeToolCategories,
  getToolClassifierMode,
  getToolCategory,
} from '../gateway/tool-builder';
import {
  ToolCategoryId,
  classifyToolFromManifest,
  compareToolCategoryClassifiers,
  isToolAvailableForManifestCategory,
} from './tool-category-manifest';

const mcpFixture = {
  getAllTools: () => [{
    serverId: 'phase4',
    serverName: 'Phase 4 fixture',
    name: 'echo',
    description: 'Deterministic validation fixture.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  }],
};

const deps = { getMCPManager: () => mcpFixture, skipDynamicExtensionTools: true };
const toolName = (tool: any): string => String(tool?.function?.name || '').trim();
const namesOf = (tools: any[]): string[] => tools.map(toolName).filter(Boolean);
const sha256 = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function withClassifierMode<T>(mode: 'legacy' | 'shadow' | 'canonical', fn: () => T): T {
  const previous = process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE;
  process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE = mode;
  try {
    assert.equal(getToolClassifierMode(), mode);
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE;
    else process.env.PROMETHEUS_TOOL_CLASSIFIER_MODE = previous;
  }
}

function compareAuthorityModes() {
  const modes = ['legacy', 'shadow', 'canonical'] as const;
  const allSurfaceByMode = Object.fromEntries(modes.map((mode) => [
    mode,
    withClassifierMode(mode, () => buildTools(deps)),
  ])) as Record<typeof modes[number], any[]>;
  const allHashes = Object.fromEntries(modes.map((mode) => [mode, sha256(allSurfaceByMode[mode])])) as Record<typeof modes[number], string>;
  assert.equal(allHashes.legacy, allHashes.shadow, 'shadow mode changed the full tool schema');
  assert.equal(allHashes.legacy, allHashes.canonical, 'canonical mode changed the full tool schema');

  const categoryHashes: Record<string, Record<string, string>> = {};
  for (const category of getRuntimeToolCategories()) {
    categoryHashes[category] = Object.fromEntries(modes.map((mode) => [
      mode,
      withClassifierMode(mode, () => sha256(buildTools(deps, new Set([category])))),
    ]));
    assert.equal(categoryHashes[category].legacy, categoryHashes[category].shadow, `${category}: shadow rollback surface differs`);
    assert.equal(categoryHashes[category].legacy, categoryHashes[category].canonical, `${category}: canonical surface differs`);
  }
  return { defaultMode: getToolClassifierMode(), allHashes, categoryHashes };
}

function buildPrivateReport() {
  delete process.env.PROMETHEUS_PUBLIC_BUILD;
  const allTools = buildTools(deps);
  const allNames = namesOf(allTools);
  const schemaHashBeforeMetadata = sha256(allTools);
  const parity = compareToolCategoryClassifiers(allNames, getLegacyToolCategory, {
    // Saved composites are runtime data. The authoritative classifier is the
    // source for identifying those names during this validation only.
    isSavedComposite: (name) => getLegacyToolCategory(name) === 'composite_tools',
  });
  assert.deepEqual(parity.mismatches, [], 'private tool surface has classifier disagreements');

  const coreTools = buildTools(deps, new Set());
  const coreNames = namesOf(coreTools);
  const baselineCoreNames = new Set(coreNames);
  for (const name of coreNames) assert.equal(getToolCategory(name), null, `unexpected categorized core tool: ${name}`);

  const categoryResults = getRuntimeToolCategories().map((category) => {
    const surface = buildTools(deps, new Set([category]));
    const surfaceNames = namesOf(surface);
    const categoryOwned = surfaceNames.filter((name) => getToolCategory(name) === category);
    const dynamicUnclassifiedTools = surfaceNames.filter((name) => (
      getToolCategory(name) === null && !baselineCoreNames.has(name)
    ));
    const crossCategoryExceptions = surfaceNames.filter((name) => {
      const owner = getToolCategory(name);
      return owner !== null && owner !== category;
    });
    if (category === 'prometheus_source_read') {
      assert.ok(crossCategoryExceptions.every((name) => isToolAvailableForManifestCategory(name, category)));
    } else {
      assert.deepEqual(crossCategoryExceptions, [], `${category} leaks tools owned by another category`);
    }
    return {
      category,
      totalTools: surfaceNames.length,
      categoryOwnedTools: categoryOwned.length,
      coreTools: surfaceNames.filter((name) => baselineCoreNames.has(name)).length,
      dynamicUnclassifiedTools,
      crossCategoryExceptions,
    };
  });

  // Metadata/classification must not mutate the provider-facing schema array.
  for (const name of allNames) classifyToolFromManifest(name);
  assert.equal(sha256(allTools), schemaHashBeforeMetadata, 'shadow classification mutated provider tool schemas');

  const rounds = 1_000;
  const started = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    for (const name of allNames) classifyToolFromManifest(name);
  }
  const elapsedMs = performance.now() - started;

  return {
    allToolCount: allNames.length,
    schemaHash: schemaHashBeforeMetadata,
    coreToolCount: coreNames.length,
    coreTools: coreNames.sort(),
    parity,
    categoryResults,
    benchmark: {
      rounds,
      classifications: rounds * allNames.length,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      microsecondsPerClassification: Number(((elapsedMs * 1000) / Math.max(1, rounds * allNames.length)).toFixed(4)),
    },
  };
}

function buildPublicReport() {
  process.env.PROMETHEUS_PUBLIC_BUILD = '1';
  try {
    const runtimeCategories = getRuntimeToolCategories();
    assert.ok(!runtimeCategories.includes('prometheus_source_read'));
    assert.ok(!runtimeCategories.includes('prometheus_source_write'));
    const tools = buildTools(deps);
    const names = namesOf(tools);
    const disabledCategoryLeaks = names
      .filter((name) => {
        const category = getToolCategory(name);
        return category === 'prometheus_source_read' || category === 'prometheus_source_write';
      })
      .map((name) => ({ name, category: getToolCategory(name) }));
    const parity = compareToolCategoryClassifiers(names, getLegacyToolCategory, {
      isSavedComposite: (name) => getLegacyToolCategory(name) === 'composite_tools',
    });
    return { toolCount: names.length, runtimeCategories, schemaHash: sha256(tools), parity, disabledCategoryLeaks };
  } finally {
    delete process.env.PROMETHEUS_PUBLIC_BUILD;
  }
}

async function main(): Promise<void> {
  const privateBuild = buildPrivateReport();
  const publicBuild = buildPublicReport();
  const authorityModes = compareAuthorityModes();
  const readyForAuthoritativeSwitch = (
    privateBuild.parity.mismatches.length === 0
    && publicBuild.parity.mismatches.length === 0
    && publicBuild.disabledCategoryLeaks.length === 0
    && privateBuild.categoryResults.every((result) => result.dynamicUnclassifiedTools.length === 0)
  );
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    authoritativeClassifier: 'src/runtime/tool-category-manifest.ts :: classifyToolFromManifest()',
    rollbackClassifier: 'src/gateway/tool-builder.ts :: getLegacyToolCategory()',
    classifierModeEnvironmentVariable: 'PROMETHEUS_TOOL_CLASSIFIER_MODE',
    authoritativeSwitchPerformed: authorityModes.defaultMode === 'canonical',
    providerFacingBehaviorChanged: false,
    readyForAuthoritativeSwitch,
    categoriesDeclared: [...ALL_TOOL_CATEGORIES],
    authorityModes,
    privateBuild,
    publicBuild,
  };
  const outputDir = path.join(process.cwd(), '.prometheus');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'tool-category-phase4-report.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // Allow deferred shadow telemetry scheduled by buildTools() to flush.
  await new Promise((resolve) => setImmediate(resolve));
  console.log(JSON.stringify({
    passed: readyForAuthoritativeSwitch,
    outputPath,
    privateTools: privateBuild.allToolCount,
    publicTools: publicBuild.toolCount,
    coreTools: privateBuild.coreToolCount,
    mismatches: privateBuild.parity.mismatches.length + publicBuild.parity.mismatches.length,
    publicDisabledCategoryLeaks: publicBuild.disabledCategoryLeaks,
    dynamicUnclassifiedTools: privateBuild.categoryResults.flatMap((result) => (
      result.dynamicUnclassifiedTools.map((name) => ({ category: result.category, name }))
    )),
    benchmark: privateBuild.benchmark,
    defaultClassifierMode: authorityModes.defaultMode,
  }, null, 2));
  if (!readyForAuthoritativeSwitch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
