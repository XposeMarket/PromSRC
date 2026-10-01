# Migrated chart-visualizer guidance

This reference preserves detailed guidance from the former `chart-visualizer` entrypoint. Read it only for the matching operation.

## Contents

- [Chart type decision](#chart-type-decision)
- [Chart.js config examples](#format-chartjs-config-object)
- [Color palette](#color-palette)
- [Labels and titles](#labels--titles)
- [Rules and anti-patterns](#rules--anti-patterns)
- [Proactive triggering](#proactive-triggering)

# Chart Visualizer

Render live Chart.js charts directly in chat using a fenced `chart` block. The frontend auto-injects Chart.js and wraps the config in a canvas — output only the config object, nothing else.

## CRITICAL OUTPUT RULES

- Output a single fenced ` ```chart ` block containing only the Chart.js config object
- **No boilerplate.** No `new Chart()`, no `<canvas>`, no `<script>` tags
- **No file saving.** Do not call any file tools. Inline output only
- **No declare_plan.** Read skill → output chart block. Done

---

## Chart Type Decision

Pick the right chart type before writing anything:

| Data situation | Chart type |
|---|---|
| Comparing values across categories | `bar` |
| Trend over time (continuous) | `line` |
| Part of a whole (≤6 slices) | `pie` or `doughnut` |
| Two numeric variables, correlation | `scatter` |
| Multiple metrics on one entity | `radar` |
| Three variables (x, y, size) | `bubble` |
| Comparing multiple series over time | `line` (multi-dataset) |
| Distribution or frequency | `bar` (horizontal if many labels) |

**Rules:**
- Pie/doughnut: max 6 slices. More than 6 → use bar
- Scatter: both axes must be numeric, no string labels
- Radar: max 8 axes, all on same scale
- When in doubt: bar for comparison, line for time

---

## Format: Chart.js Config Object

Output only the config. No wrapper.

### Bar chart
```chart
{
  type: "bar",
  data: {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [{
      label: "Revenue ($k)",
      data: [42, 58, 51, 73, 88, 95],
      backgroundColor: ["#E76F3C","#2F6B5F","#D4A72C","#C64B4B","#8B5E3C","#6B7280"]
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { position: "top" },
      title: { display: true, text: "Monthly Revenue" }
    },
    scales: {
      y: { beginAtZero: true }
    }
  }
}
```

### Line chart (single series)
```chart
{
  type: "line",
  data: {
    labels: ["Q1", "Q2", "Q3", "Q4"],
    datasets: [{
      label: "Users",
      data: [1200, 1900, 1700, 2400],
      borderColor: "#E76F3C",
      backgroundColor: "rgba(231,111,60,0.1)",
      tension: 0.4,
      fill: true
    }]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Quarterly Active Users" } },
    scales: { y: { beginAtZero: true } }
  }
}
```

### Multi-series line chart (year-over-year, A/B comparison)
```chart
{
  type: "line",
  data: {
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    datasets: [
      {
        label: "2023",
        data: [30, 45, 40, 60, 55],
        borderColor: "#E76F3C",
        tension: 0.4
      },
      {
        label: "2024",
        data: [40, 55, 62, 78, 90],
        borderColor: "#2F6B5F",
        tension: 0.4
      }
    ]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Revenue YoY" } }
  }
}
```

### Pie / Doughnut
```chart
{
  type: "doughnut",
  data: {
    labels: ["Direct", "Organic", "Referral", "Social", "Email"],
    datasets: [{
      data: [35, 28, 18, 12, 7],
      backgroundColor: ["#E76F3C","#2F6B5F","#D4A72C","#8B5E3C","#6B7280"]
    }]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Traffic Sources" } }
  }
}
```

### Scatter
```chart
{
  type: "scatter",
  data: {
    datasets: [{
      label: "Ad Spend vs Conversions",
      data: [
        { x: 500, y: 42 },
        { x: 1200, y: 89 },
        { x: 800, y: 61 },
        { x: 2000, y: 140 }
      ],
      backgroundColor: "#E76F3C"
    }]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Spend vs Conversions" } },
    scales: {
      x: { title: { display: true, text: "Ad Spend ($)" } },
      y: { title: { display: true, text: "Conversions" } }
    }
  }
}
```

### Radar
```chart
{
  type: "radar",
  data: {
    labels: ["Speed", "Reliability", "Scalability", "Security", "Cost"],
    datasets: [
      {
        label: "Option A",
        data: [85, 92, 78, 88, 65],
        borderColor: "#E76F3C",
        backgroundColor: "rgba(231,111,60,0.15)"
      },
      {
        label: "Option B",
        data: [72, 80, 95, 70, 90],
        borderColor: "#2F6B5F",
        backgroundColor: "rgba(47,107,95,0.15)"
      }
    ]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: "Option Comparison" } },
    scales: { r: { beginAtZero: true, max: 100 } }
  }
}
```

---

## Color Palette

Use these consistently. They work in both dark and light mode:

| Role | Hex |
|---|---|
| Primary | `#E76F3C` (ember) |
| Secondary | `#2F6B5F` (forest) |
| Accent 1 | `#D4A72C` (ochre) |
| Accent 2 | `#8B5E3C` (umber) |
| Accent 3 | `#6B7280` (slate) |
| Danger | `#C64B4B` (red) |
| Success | `#3E8E63` (green) |

For multi-dataset charts, cycle through these in order. For single-dataset bar charts, you can use all colors across bars for visual variety.

For background fills (line charts, radar): append `33` to the hex for ~20% opacity — e.g. `#E76F3C33`.

---

## Labels & Titles

- **Always include a `title`** — unlabeled charts are useless
- **Always include axis labels** for bar/line/scatter — use `scales.x.title` and `scales.y.title`
- **Always include a legend** when there are multiple datasets
- Format numbers in labels when needed: `ticks: { callback: (v) => '$' + v + 'k' }`
- Keep labels short — truncate if needed, the chart is not a data table

---

## Rules & Anti-Patterns

**DO:**
- Always set `responsive: true`
- Always set `beginAtZero: true` on value axes unless negative values are meaningful
- Use `tension: 0.4` on line charts for smooth curves
- Use `fill: true` + low-opacity background for area emphasis on single-line charts

**DON'T:**
- Don't output anything outside the fenced block
- Don't add `new Chart()` or canvas boilerplate — the renderer handles it
- Don't use pie/doughnut for more than 6 categories
- Don't skip titles or axis labels
- Don't hardcode dark-mode-only colors (e.g. `color: "#cdd6f4"`) in the config — Chart.js axis colors are auto-managed by the renderer

---

## Proactive Triggering

Automatically produce a chart (without being asked) when:
- User pastes a table of numbers and asks for analysis
- User asks "how does X compare to Y" with quantifiable data
- User asks about trends, performance, or metrics over time
- A data pipeline, integration sync, or report task produces numeric output

Lead with the chart, then explain the key insight in 1–2 sentences below it.
