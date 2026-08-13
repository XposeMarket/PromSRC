---
name: "chart-visualizer"
description: "Render a live inline Chart.js chart in chat when the user asks to chart, graph, plot, or visualize numeric data, KPI trends, comparisons, distributions, or correlations. Use only for inline charts; do not save files or use this for dashboards, interactive apps, or presentation decks."
---

# Chart Visualizer

Return one fenced `chart` block containing only a Chart.js configuration object. The frontend creates the canvas and loads Chart.js.

```chart
{
  type: "bar",
  data: {
    labels: ["Q1", "Q2", "Q3", "Q4"],
    datasets: [{
    label: "Revenue ($k)",
      data: [42, 58, 73, 95]
    }]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Quarterly Revenue" } },
    scales: {
      x: { title: { display: true, text: "Quarter" } },
      y: { beginAtZero: true, title: { display: true, text: "Revenue ($k)" } }
    }
  }
}
```

Do not emit `new Chart()`, `<canvas>`, `<script>`, HTML, file writes, or implementation commentary around the block. A short insight may follow only when the user asked for analysis as well as a chart.

## Choose the shape

| Data relationship | Type |
| --- | --- |
| compare categories | `bar` |
| continuous time trend | `line` |
| part of a whole with at most six slices | `pie` or `doughnut` |
| correlation between two numeric variables | `scatter` |
| several same-scale metrics for one or more entities | `radar` |
| x, y, and magnitude | `bubble` |
| distribution/frequency without a histogram plugin | `bar` |

Use horizontal bars for many or long category labels. Use a multi-dataset line for series over time. When uncertain, choose bar for comparison and line for time. Never force a pie chart past six categories or a radar chart past eight axes.

## Chart contract

- Use only values actually supplied or derived from cited data. Never invent missing rows.
- Always include a useful title.
- Label value axes and units for bar, line, scatter, and bubble charts.
- Include a legend when multiple datasets need identification; omit redundant single-series legends.
- Use deterministic label order and keep labels short.
- Set `responsive:true` and `beginAtZero:true` on value axes unless negative values or a meaningful nonzero baseline require otherwise.
- For scatter and bubble charts, x and y must remain numeric objects rather than category labels.
- Preserve null/missing values as gaps unless the user authorizes interpolation.

Leave dataset colors unset by default. Prometheus injects a theme-aware series palette from `--prom-series-*` / the active accent and semantic tokens, so the same chart follows light, dark, blue, purple, gray, and custom themes. Only provide explicit colors when the user supplied a meaningful semantic color or explicitly asked for one; never bake a light/dark canvas into the config.

Read [references/config-examples.md](references/config-examples.md) only when the requested shape needs a scatter, radar, doughnut, or multi-series configuration example. The rules in this entrypoint override any legacy styling shown in preserved examples.
