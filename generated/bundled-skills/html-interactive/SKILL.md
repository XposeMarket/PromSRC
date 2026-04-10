---
name: HTML Interactive
description: Build rich interactive HTML widgets, dashboards, calculators, progress trackers, forms, games, and multi-panel tools directly in chat. Use when the user needs something they can interact with — click, adjust sliders, filter, toggle, step through — not just look at. Outputs a fenced ```html block rendered as a live sandboxed iframe. Use this skill when interactivity or state is required. For pure data charts use chart-visualizer. For static diagrams use svg-diagrams. Triggers on: interactive, dashboard, calculator, tracker, form, step through, simulate, adjust, toggle, filter table, sortable, progress tracker, build a tool, create a widget, make this interactive, multi-panel.
emoji: "🧩"
version: 1.0.0
triggers: interactive, dashboard, calculator, tracker, form, step through, simulate, adjust, toggle, filter, sortable table, progress tracker, build a tool, widget, make this interactive, multi-panel, checklist, kanban, timer, countdown, configurator, comparison tool, what-if, scenario builder, interactive report, live preview
---

# HTML Interactive

Build live interactive widgets directly in chat using a fenced `html` block. The frontend renders it as a sandboxed iframe — JS executes, event listeners fire, state persists while the widget is visible.

## CRITICAL OUTPUT RULES

- Output a single fenced ` ```html ` block
- **No file saving.** Inline output only — do not call file tools
- **No declare_plan.** Read skill → output html block. Done
- Keep total output under ~200 lines — split into multiple widgets if needed

---

## Core Design Rules

### Backgrounds — the most common mistake
```html
<!-- ✅ CORRECT: no background on outer wrapper -->
<div style="font-family:sans-serif; padding:16px;">
  <!-- inner cards CAN have backgrounds -->
  <div style="background:rgba(99,102,241,0.1); border-radius:8px; padding:12px;">...</div>
</div>

<!-- ❌ WRONG: hardcoded dark background breaks light mode -->
<div style="background:#1e1e2e; font-family:sans-serif;">...</div>
```

The renderer injects `background:transparent` — **never set a background on the outermost wrapper**. Inner cards, panels, and components can have their own backgrounds.

### Colors that work in both dark and light mode
Use rgba with low opacity for backgrounds — they work in both themes:
```css
background: rgba(99,102,241,0.1)   /* indigo tint — works everywhere */
background: rgba(34,211,238,0.1)   /* cyan tint */
background: rgba(74,222,128,0.1)   /* green tint */
border: 1px solid rgba(99,102,241,0.3)
color: inherit                      /* inherits from host theme */
```

For text: use `color: inherit` on containers and specific colors only on emphasis elements.

### Typography
```css
font-family: sans-serif  /* always set on outer wrapper */
font-size: 14px          /* body */
font-size: 13px          /* secondary / labels */
font-size: 11px          /* captions / metadata */
font-size: 20-28px       /* KPI numbers */
font-weight: 600         /* bold */
```

### Spacing
```css
padding: 16px            /* standard panel padding */
gap: 12px                /* grid/flex gap */
border-radius: 8px       /* cards */
border-radius: 6px       /* smaller elements */
```

---

## Component Patterns

### KPI Card Row
```html
<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px;">
  <div style="background:rgba(74,222,128,0.1); border:1px solid rgba(74,222,128,0.25); border-radius:8px; padding:14px; text-align:center;">
    <div style="font-size:26px; font-weight:700; color:#16a34a;">$142k</div>
    <div style="font-size:12px; opacity:0.6; margin-top:4px;">Revenue</div>
  </div>
  <div style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.25); border-radius:8px; padding:14px; text-align:center;">
    <div style="font-size:26px; font-weight:700; color:#6366f1;">2,847</div>
    <div style="font-size:12px; opacity:0.6; margin-top:4px;">Customers</div>
  </div>
  <div style="background:rgba(236,72,153,0.1); border:1px solid rgba(236,72,153,0.25); border-radius:8px; padding:14px; text-align:center;">
    <div style="font-size:26px; font-weight:700; color:#ec4899;">94%</div>
    <div style="font-size:12px; opacity:0.6; margin-top:4px;">Satisfaction</div>
  </div>
</div>
```

### Progress Bar
```html
<div style="margin-bottom:8px;">
  <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
    <span>Phase 2 — Website Intelligence</span>
    <span style="opacity:0.6;">100%</span>
  </div>
  <div style="background:rgba(255,255,255,0.1); border-radius:4px; height:6px; overflow:hidden;">
    <div style="width:100%; height:100%; background:#4ade80; border-radius:4px;"></div>
  </div>
</div>
```

### Toggle / Switch
```html
<label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; font-size:13px;">
  <input type="checkbox" id="tog" style="display:none;" onchange="toggle(this)">
  <div id="track" style="width:32px; height:18px; background:rgba(255,255,255,0.15); border-radius:9px; position:relative; transition:background 0.2s;">
    <div id="thumb" style="position:absolute; top:2px; left:2px; width:14px; height:14px; background:#fff; border-radius:50%; transition:transform 0.2s;"></div>
  </div>
  <span>Enable Feature</span>
</label>
<script>
function toggle(cb) {
  document.getElementById('track').style.background = cb.checked ? '#6366f1' : 'rgba(255,255,255,0.15)';
  document.getElementById('thumb').style.transform = cb.checked ? 'translateX(14px)' : 'none';
}
</script>
```

### Filterable / Sortable Table
```html
<input type="text" id="search" placeholder="Filter..." oninput="filterTable()"
  style="width:100%; padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:inherit; font-size:13px; margin-bottom:10px; box-sizing:border-box;">
<table id="tbl" style="width:100%; border-collapse:collapse; font-size:13px;">
  <thead>
    <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
      <th style="text-align:left; padding:8px; opacity:0.6;" onclick="sortBy(0)">Name ↕</th>
      <th style="text-align:right; padding:8px; opacity:0.6;" onclick="sortBy(1)">Value ↕</th>
    </tr>
  </thead>
  <tbody id="tbody">
    <tr><td style="padding:8px;">Alpha</td><td style="padding:8px; text-align:right;">142</td></tr>
    <tr><td style="padding:8px;">Beta</td><td style="padding:8px; text-align:right;">89</td></tr>
  </tbody>
</table>
<script>
function filterTable() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
let sortDir = 1;
function sortBy(col) {
  const rows = [...document.querySelectorAll('#tbody tr')];
  rows.sort((a, b) => {
    const av = a.cells[col].textContent.trim();
    const bv = b.cells[col].textContent.trim();
    const an = parseFloat(av), bn = parseFloat(bv);
    return (!isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv)) * sortDir;
  });
  sortDir *= -1;
  rows.forEach(r => document.getElementById('tbody').appendChild(r));
}
</script>
```

### Step-Through / Stepper
```html
<div id="stepper" style="font-family:sans-serif; padding:16px;">
  <div style="display:flex; gap:8px; margin-bottom:16px;" id="dots"></div>
  <div id="step-content" style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:8px; padding:16px; min-height:80px; font-size:14px;"></div>
  <div style="display:flex; justify-content:space-between; margin-top:12px;">
    <button onclick="step(-1)" style="padding:7px 16px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:transparent; color:inherit; cursor:pointer; font-size:13px;">← Back</button>
    <button onclick="step(1)" style="padding:7px 16px; border-radius:6px; border:none; background:#6366f1; color:#fff; cursor:pointer; font-size:13px;">Next →</button>
  </div>
</div>
<script>
const steps = [
  { title: "Step 1", body: "Description of step one." },
  { title: "Step 2", body: "Description of step two." },
  { title: "Step 3", body: "Description of step three." }
];
let cur = 0;
function render() {
  const dots = document.getElementById('dots');
  dots.innerHTML = steps.map((s,i) =>
    `<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;
     background:${i===cur?'#6366f1':'rgba(255,255,255,0.08)'};color:${i===cur?'#fff':'inherit'};border:1px solid ${i<cur?'#6366f1':'rgba(255,255,255,0.15)'};">${i+1}</div>`
  ).join('');
  document.getElementById('step-content').innerHTML = `<strong>${steps[cur].title}</strong><br><br>${steps[cur].body}`;
}
function step(d) { cur = Math.max(0, Math.min(steps.length-1, cur+d)); render(); }
render();
</script>
```

### Slider + Live Readout
```html
<div style="padding:16px; font-family:sans-serif;">
  <label style="font-size:13px; opacity:0.7;">Budget: <strong id="val">$5,000</strong></label>
  <input type="range" min="1000" max="20000" step="500" value="5000" oninput="upd(this.value)"
    style="width:100%; margin:10px 0;">
  <div id="result" style="font-size:14px; color:#6366f1;"></div>
</div>
<script>
function upd(v) {
  document.getElementById('val').textContent = '$' + parseInt(v).toLocaleString();
  const roi = (v * 2.4).toFixed(0);
  document.getElementById('result').textContent = 'Estimated ROI: $' + parseInt(roi).toLocaleString();
}
upd(5000);
</script>
```

---

## CDN Libraries (available via jsdelivr/cdnjs)

Import in a `<script src="...">` tag before using:

| Library | CDN URL |
|---|---|
| Chart.js | `https://cdn.jsdelivr.net/npm/chart.js` |
| D3.js | `https://cdn.jsdelivr.net/npm/d3` |
| Mermaid | `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js` |

**Combining Chart.js with the html block** (for dashboards that need both KPI cards and a chart):
```html
<div style="font-family:sans-serif; padding:16px;">
  <!-- KPI row here -->
  <canvas id="myChart" style="max-height:200px;"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    new Chart(document.getElementById('myChart'), {
      type: 'line',
      data: { labels: ['Jan','Feb','Mar'], datasets: [{ label: 'Revenue', data: [40,65,55], borderColor:'#6366f1', tension:0.4 }] },
      options: { responsive:true }
    });
  </script>
</div>
```

---

## Rules & Anti-Patterns

**DO:**
- Keep outer wrapper `background:transparent` — inner panels can have backgrounds
- Use `color:inherit` on containers so text adapts to dark/light mode
- Keep scripts simple and self-contained — no external state, no `fetch()` to unknown APIs
- Use `box-sizing:border-box` on inputs and full-width elements
- Test JS logic mentally before writing — no runtime errors

**DON'T:**
- Don't use `document.write()`
- Don't import large libraries when plain JS handles it
- Don't set hardcoded `color: #1e1e2e` or `color: #cdd6f4` — mode-specific colors break the other theme
- Don't use `position:fixed` — the iframe auto-sizes to content height, fixed elements collapse it
- Don't exceed 200 lines in a single html block — split into multiple widgets

---

## Proactive Triggering

Automatically produce an interactive widget (without being asked) when:
- User shares a multi-step process and wants to "walk through" it
- User has a dataset with multiple dimensions they want to filter or explore
- A task produces results that benefit from adjustable parameters (budget, timeline, thresholds)
- User asks a "what if" or scenario question with numeric variables
- A team report is delivered and a summary dashboard would make it immediately readable
