---
name: "interactive-visuals"
description: "Build analyst-grade inline visuals in chat: dashboards, multi-view breakdowns, design-variant mocks, and explainers using the preloaded Prometheus Viz Kit (window.ui) inside ```html blocks. Also routes /visual to chart, Mermaid, SVG, or HTML. Use when the user asks to visualize, chart, break down, compare designs, mock UI, or make something interactive."
---

# Interactive visuals (Prometheus Viz Kit)

The bar is the Theo / GPT-5.6 "Lauren" standard: a visual that reads like a senior analyst's one-pager, not a toy card. Tiny, hand-rolled divs with three made-up states are the failure mode this skill exists to stop.

## 1. Pick the surface

| Need | Use |
|---|---|
| Live domain data (weather, stocks, products, places, sports, news) | `show_ui_card`, not this skill |
| A single, simple chart from known numbers | ```` ```chart ```` (Chart.js config) or `ui.chart` in html |
| Flow, sequence, state, ERD, timeline | ```` ```mermaid ```` (read `mermaid-diagrams`) |
| Bespoke architecture/annotated schematic | ```` ```svg ```` (read `svg-diagrams`) |
| Anything with numbers + "what does this mean", dashboards, breakdowns, multi-view, filters, UI design variants, simulators | ```` ```html ```` **with the Viz Kit** (this skill) |

For `/visual`, return exactly one complete fenced visual block. No Markdown-table-only answers.

## 2. Get real data first (the step that makes it good)

Theo's model worked 7 minutes before drawing. Do the same:
- Pull the actual numbers with tools: workspace files, `git log --numstat`, session/audit logs, CSVs, APIs, web_fetch, memory/notes.
- Compute the aggregates yourself (by day, by hour × weekday, by category/sub-category, top-N, deltas vs previous period).
- Never invent data. If something is estimated, label it `est.` in the subtitle or footnote. If data is missing, say so in the visual.
- Embed data as JSON: `<script type="application/json" id="data">{...}</script>` then `const D = ui.data();`. Keep it under ~40 KB; pre-aggregate.

## 3. Composition: the analyst pattern

1. **Page header**: kicker (dataset · period), a title that is the *finding* ("Usage peaks Thursday 3 PM", not "Usage chart"), and a subtitle saying what's measured.
2. **KPI strip**: 3–5 headline numbers with deltas + sparklines.
3. **2–4 views, each a `ui.section` with an insight title + one-line caption**: trend over time (stacked area with annotations), a rhythm view (heatmap hour × weekday), a composition view (zoomable treemap or ranked bars), detail (sortable table).
4. **Controls that change the views**: a `ui.segmented` metric/period switch or `ui.tabs` – wired with `onChange` to redraw.
5. **Footer**: source + method notes.

Every number gets hover/tap detail (the kit does this). Mobile 320px works automatically if you use the kit primitives and `ui.grid`.

## 4. The Viz Kit API (preloaded as `window.ui`, no imports)

```js
ui.page({kicker, title, subtitle, source})            // page header + footer
ui.kpis(null, [{label, value, format, delta, good:'up'|'down', spark:[..], note}])
const s = ui.section(null, {kicker, title, subtitle, card:true})  // returns body el; s.head = right-side slot
ui.chart(s, {type:'line'|'area'|'stacked'|'bar'|'stackedBar', x:[labels], series:[{name, values, color?, dash?}],
             format, xFormat:(label,i)=>str, height, annotations:[{x, label}], band:{from,to}, target:{value,label}, onClick:(i,label)=>{}})
ui.bars(s, {items:[{label, value, note?}], format, highlight:'max'|label, limit:8, onClick})
ui.heatmap(s, {rows, cols, values:[[r][c]], format, mark:'max', diverging:false, legendLabel})
ui.treemap(s, {data:{name, children:[{name, value} | {name, children:[...]}]}, format, height})  // tap to zoom, breadcrumbs
ui.donut(s, {items:[{label, value}], format, center:{value, label}})
ui.table(s, {columns:[{key, label, format, bar:true, tone:true, render}], rows, sort:{key, dir:'desc'}, limit})
ui.tabs(s, {tabs:[{label, render:(el)=>{...}}], key:'tab'})
ui.segmented(s, {options:['Tokens','Cost'], value:'Tokens', key:'metric', onChange:(v)=>{...}})  // goes into the section header
ui.compare(null, {variants:[{name, note, css, html | render(el)}], pickPrompt:'Build variant {letter} ({name})'})
ui.grid(null, 2)  ui.card(t)  ui.callout(t, html)  ui.badge(text, 'ok'|'bad'|'warn'|'accent')
ui.fmt(v, 'compact'|'int'|'usd'|'usd0'|'usd2'|'pct'|'pct1'|'delta'|'ms'|'dur'|'bytes'|'{v} tok')
ui.state.get(key, fallback) / ui.state.set(key, value)   // persists across reloads
ui.ask('prompt')                                          // sends a follow-up into chat (drill-down CTA)
ui.color.cat(i) / ui.color.seq(t) / ui.color.theme()      // theme-aware palettes
```
`target` may be `null` (append to page), a selector, or an element (e.g. a section body). Redraw on control change by clearing the element: `el.innerHTML=''; ui.chart(el, {...})`.

Formats: values like `85000` render `85.0k`, `24000000` → `24.0M`. Pass numbers, not pre-formatted strings.

## 5. Design rules
- Transparent root, theme tokens only. Never hardcode a page background or white text on accent; use `var(--pv-on-accent)` / `var(--prom-on-accent)` when text sits on the accent color.
- Insight titles beat topic titles. Annotate the peak/outlier directly on the chart.
- One accent for "the point"; muted for context. Don't rainbow everything.
- Monospace tabular numbers (the kit does this). Round sensibly.
- No purple-blue-cyan "AI SaaS" gradients, no emoji icons as data, no lorem ipsum.
- Keep the html block self-contained; no external network fetches.

## 6. UI design variants (Theo-style mocks)
When discussing a UI change, show 3–5 genuinely different variants with `ui.compare`. Mock with real Prometheus tokens and real copy/data, each with a one-line tradeoff note. The Pick button sends the choice back to chat; then build that one.

## 7. Reference skeleton

```html
<script type="application/json" id="data">{"days":["Sep 1","Sep 2"],"models":{"Opus":[120,180],"GPT":[60,40]},"heat":[[0,1],[2,3]],"hours":["0","1"],"weekdays":["Mon","Tue"],"tree":{"name":"All","children":[{"name":"Coding","children":[{"name":"PRs","value":40}]}]}}</script>
<script>
const D = ui.data();
ui.page({kicker:'Prometheus usage · Sep 2026', title:'Usage peaks Thursday afternoon', subtitle:'Tokens by model, from session logs', source:'tool_audit.log, 30 days'});
ui.kpis(null,[{label:'Total tokens',value:24e6,delta:.12,spark:[3,5,4,8]},{label:'Sessions',value:412,format:'int'}]);
const g = ui.grid(null, 1);
const s1 = ui.section(g,{title:'Opus carries 72% of volume',subtitle:'Daily tokens, stacked by model'});
ui.chart(s1,{type:'stacked',x:D.days,series:Object.entries(D.models).map(([name,values])=>({name,values})),annotations:[{x:'Sep 2',label:'Opus 5.5 ships'}]});
const s2 = ui.section(g,{title:'Peak is Thursday 3 PM',subtitle:'Tokens by hour × weekday'});
ui.heatmap(s2,{rows:D.weekdays,cols:D.hours,values:D.heat,mark:'max'});
const s3 = ui.section(g,{title:'Coding dominates',subtitle:'Tap a block to zoom'});
ui.treemap(s3,{data:D.tree});
</script>
```

## 8. Before sending
- Data is real (or labeled est.), the title states a finding, every view has a caption.
- Works at 320px (grid collapses, tables scroll).
- No hardcoded light/dark backgrounds; text on accent uses on-accent.
- Refining an existing visual: keep its structure and `ui.state` keys stable.

Read [references/soul-visual-defaults.md](references/soul-visual-defaults.md) only when native rich-output selection is ambiguous.
