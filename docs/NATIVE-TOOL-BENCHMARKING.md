# Native tool performance baseline

This baseline has two deliberately separate layers:

1. **Surface baseline** covers every tool returned by the live `ToolRegistry`, including dynamically loaded extension tools. It records provider-definition size, estimated provider tokens, schema size, capability/policy tier, family, source, and visibility by profile. It does not execute tools.
2. **Execution baseline** uses explicit, safe fixtures for live calls. Mutating, destructive, credential-using, desktop-input, browser-input, and external-write tools must be opt-in and fixture-scoped before they are run.

The surface layer is the complete inventory and makes tool coverage drift visible. The execution layer is where runtime latency, input/output bytes and token estimates, model-round delay, retries, errors, and process resource usage are compared before and after a change.

## Commands

```text
npm run test:native-tool-surface
npm run benchmark:native-tool-surface -- --output .tmp/native-tool-surface.json
npm run benchmark:compare-native-tool-surface -- --before .tmp/before.json --after .tmp/after.json --output .tmp/comparison.json
npm run benchmark:tool-observations -- --output .tmp/tool-observations.json
npm run benchmark:compare-tool-observations -- --before .tmp/tool-observations-before.json --after .tmp/tool-observations-after.json --output .tmp/tool-observations-comparison.json
npm run benchmark:tool-performance
```

`benchmark:native-tool-surface` emits a JSON report to stdout and optionally writes the same report to `--output` or `PROMETHEUS_NATIVE_TOOL_SURFACE_OUTPUT`. The sample count for repeated provider-surface builds is controlled by `PROMETHEUS_NATIVE_TOOL_SURFACE_SAMPLES` and defaults to 20.

## Comparison rules

Compare reports using the stable key `tool name + profile + source + schemaVersion`. For a metric `before` and `after`, report both absolute change and percentage change:

```text
absolute change = after - before
percentage change = ((after - before) / before) * 100
```

`benchmark:compare-native-tool-surface` emits both `percentChange` and `reductionPercent`; a latency reduction is a positive `reductionPercent`. Zero-baseline metrics return `null` for percentage fields so an undefined ratio is never reported as a fake improvement.

Use the same tool registry, profile, sample count, machine state, credential state, fixture, and concurrency for both runs. Token values from this surface report are estimates of serialized provider definitions; billing usage must come from the model usage telemetry recorded for live execution.

## Initial snapshot

The checked-in [2026-09-02 surface snapshot](../benchmarks/native-tool-surface/baseline-2026-09-02.json) was captured from the current local runtime:

- 195 registered tools: 131 native and 64 extension-backed.
- 150 definitions in the full profile, totaling 96,639 bytes and an estimated 31,165 provider tokens.
- Full-profile provider-definition construction: 0.526 ms p50 and 0.943 ms p95 across 20 repeated builds.
- Native policy tiers: 57 read, 40 propose, and 34 commit.

The X connector declarations were not active in this runtime and are therefore not included in the registered count. Re-run the snapshot in the target runtime before treating these counts as production availability.

The checked-in [tool-observation history snapshot](../benchmarks/tool-observations/baseline-2026-09-02.json) contains the most recent bounded 50,000 persisted observations from the local legacy runtime. It covers 412 historical tool names, including 88 currently registered native tools and 302 historical-only names. The report records the exact observation window, which spans June 8 through September 3 in this capture; across that mixed window, summed tool duration was 114,001,347 ms, p50/p95 latency was 31/6,902 ms, args/result/context tokens were 7,865,161 / 134,018,865 / 141,884,026, result bytes were 428,754,753, and estimated context cost was $177.835608. These figures are historical prioritization only, not the current baseline and not a controlled before/after experiment.

`benchmark:tool-observations` summarizes the persisted live history by tool and family. It is useful for prioritization, while `benchmark:tool-performance` exercises live chat paths and measures the end-to-end stream stages. The two reports should not be merged into one metric: persisted observations describe actual calls over a historical window, whereas a controlled benchmark describes a reproducible fixture.

`benchmark:compare-tool-observations` compares those execution reports per tool across calls, errors, retries, p50/p95/p99 latency, args/result/context tokens, result bytes, and estimated cost. Its output uses `reductionPercent` for “after is lower” and explicitly warns that historical windows are not causal controlled experiments.

The initial classification pass also corrected file/source names being treated as web calls merely because they contain “search” or “fetch”; workspace and creative/media families are classified before the generic web-search fallback.
