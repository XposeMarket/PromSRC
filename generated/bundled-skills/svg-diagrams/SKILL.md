---
name: SVG Diagrams
description: Render architecture diagrams, system maps, flowcharts, and technical illustrations as raw SVG directly in chat. Use for any visual where the structure, layout, or spatial relationships between components matters — not data charts (use chart-visualizer) and not flowcharts-as-text (use mermaid-diagrams). Outputs a fenced ```svg block. Triggers on: architecture diagram, system diagram, draw this, component diagram, network diagram, infrastructure diagram, diagram the flow, show the structure, illustrate, box and arrow, data flow diagram, pipeline diagram, relationship diagram, technical diagram.
emoji: "🔷"
version: 1.0.0
triggers: architecture diagram, system diagram, draw this, component diagram, network diagram, infrastructure diagram, diagram the flow, show the structure, illustrate, box and arrow, data flow, pipeline diagram, relationship diagram, technical diagram, service map, entity diagram, class diagram, deployment diagram, aws diagram, cloud architecture
---

# SVG Diagrams

Render architecture diagrams, system maps, and technical illustrations as live SVG directly in chat using a fenced `svg` block.

## CRITICAL OUTPUT RULES

- Output a single fenced ` ```svg ` block containing raw SVG
- **No file saving.** Inline output only — no file tools
- **No declare_plan.** Read skill → output SVG. Done
- The frontend renders it as a live scaled widget automatically

---

## When to Use SVG vs Other Formats

| Need | Use |
|---|---|
| Data chart (bar, line, pie) | `chart-visualizer` skill |
| Text-defined flowchart or sequence diagram | `mermaid-diagrams` skill |
| Architecture with custom layout/spatial positioning | **This skill (SVG)** |
| Multi-panel interactive dashboard | `html-interactive` skill |
| Icon or small illustration inline | **This skill (SVG)** |

Use SVG when **you need precise control over position** — exact box placement, specific arrow routing, custom shapes, color-coded regions.

---

## SVG Setup Rules

```svg
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif; width:100%">
  <!-- content here -->
</svg>
```

**Always:**
- Set `viewBox` — this makes it responsive
- Set `width="100%"` on the root `<svg>` — fills the chat panel
- Set `font-family:sans-serif` as a base style
- Define arrow markers in `<defs>` if using arrows

**Never:**
- Set a `background` on the root `<svg>` — leaves transparent so it works in dark and light mode
- Hardcode pixel widths without `viewBox` — it won't scale
- Use absolute font sizes above 16px for labels

---

## Arrow Marker (always include when using arrows)

```svg
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M2 1L8 5L2 9" fill="none" stroke="#94a3b8" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>
<!-- Usage: -->
<line x1="120" y1="50" x2="200" y2="50" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>
```

For colored arrows, define a separate marker per color — the marker stroke doesn't inherit from the line.

---

## Component Box Patterns

### Standard component box (single label)
```svg
<rect x="50" y="40" width="140" height="44" rx="8" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.5"/>
<text x="120" y="67" text-anchor="middle" fill="#a5b4fc" font-size="13" font-weight="500">API Gateway</text>
```

### Two-line box (title + subtitle)
```svg
<rect x="50" y="40" width="160" height="56" rx="8" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.5"/>
<text x="130" y="62" text-anchor="middle" fill="#a5b4fc" font-size="13" font-weight="600">Auth Service</text>
<text x="130" y="80" text-anchor="middle" fill="#6366f1" font-size="11">JWT + OAuth2</text>
```

### Container / group box (dashed boundary)
```svg
<rect x="20" y="20" width="360" height="200" rx="12" fill="none" stroke="#334155" stroke-width="1.5" stroke-dasharray="6,4"/>
<text x="40" y="42" fill="#64748b" font-size="12" font-weight="500">AWS Region us-east-1</text>
```

### Database cylinder (approximated)
```svg
<ellipse cx="300" cy="65" rx="50" ry="12" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
<rect x="250" y="65" width="100" height="60" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
<ellipse cx="300" cy="125" rx="50" ry="12" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
<text x="300" y="100" text-anchor="middle" fill="#67e8f9" font-size="12">PostgreSQL</text>
```

---

## Color System

Use these consistently. Dark backgrounds, colored borders and labels:

| Component type | Fill | Border | Label |
|---|---|---|---|
| Service / app | `#1e1b4b` | `#6366f1` | `#a5b4fc` |
| Database | `#0f172a` | `#22d3ee` | `#67e8f9` |
| Queue / broker | `#1a0a2e` | `#8b5cf6` | `#c4b5fd` |
| External / 3rd party | `#1c1917` | `#94a3b8` | `#cbd5e1` |
| User / client | `#0c1a0c` | `#4ade80` | `#86efac` |
| Warning / error state | `#1f0a0a` | `#f43f5e` | `#fca5a5` |
| Container boundary | `none` | `#334155` (dashed) | `#64748b` |

Arrow / connector color: `#94a3b8` (neutral gray) unless the connection type matters — use colored arrows sparingly.

---

## Layout Guidelines

**Horizontal flow (left → right):** Use for request pipelines, data flows, CI/CD pipelines
- Start x at ~40, increment by box-width + gap (usually 60–80px gap)
- Keep all boxes vertically centered on the same y baseline
- Total width: stay within viewBox width minus 40px padding each side

**Vertical flow (top → bottom):** Use for layered architectures (frontend → backend → DB)
- Start y at ~40, increment by box-height + gap (usually 40–60px)
- Center boxes horizontally in the viewBox

**Grid layout:** Use for microservice maps
- Define rows and columns, space evenly
- Connect with L-shaped paths for non-adjacent boxes to avoid crossing

**Avoid:**
- Arrows that cross through unrelated boxes — route around them with `<path d="M x1 y1 L x1 ymid L x2 ymid L x2 y2"/>`
- Text that overflows its box — shorten labels or widen boxes
- More than ~12 components in one diagram — split into sub-diagrams

---

## Full Example: 3-Tier Web Architecture

```svg
<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" style="font-family:sans-serif; width:100%">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>

  <!-- Browser -->
  <rect x="20" y="78" width="120" height="44" rx="8" fill="#0c1a0c" stroke="#4ade80" stroke-width="1.5"/>
  <text x="80" y="105" text-anchor="middle" fill="#86efac" font-size="13" font-weight="500">Browser</text>

  <line x1="142" y1="100" x2="178" y2="100" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- API Gateway -->
  <rect x="180" y="68" width="140" height="64" rx="8" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.5"/>
  <text x="250" y="95" text-anchor="middle" fill="#a5b4fc" font-size="13" font-weight="600">API Gateway</text>
  <text x="250" y="115" text-anchor="middle" fill="#6366f1" font-size="11">Rate limit · Auth</text>

  <line x1="322" y1="100" x2="358" y2="100" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- App Server -->
  <rect x="360" y="68" width="140" height="64" rx="8" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.5"/>
  <text x="430" y="95" text-anchor="middle" fill="#a5b4fc" font-size="13" font-weight="600">App Server</text>
  <text x="430" y="115" text-anchor="middle" fill="#6366f1" font-size="11">Node.js · Express</text>

  <line x1="502" y1="100" x2="538" y2="100" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Database -->
  <ellipse cx="610" cy="92" rx="52" ry="13" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
  <rect x="558" y="92" width="104" height="52" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
  <ellipse cx="610" cy="144" rx="52" ry="13" fill="#0f172a" stroke="#22d3ee" stroke-width="1.5"/>
  <text x="610" y="123" text-anchor="middle" fill="#67e8f9" font-size="12">PostgreSQL</text>

  <!-- Cache (below gateway) -->
  <rect x="200" y="160" width="100" height="34" rx="6" fill="#1a0a2e" stroke="#8b5cf6" stroke-width="1.5"/>
  <text x="250" y="182" text-anchor="middle" fill="#c4b5fd" font-size="11">Redis Cache</text>
  <line x1="250" y1="132" x2="250" y2="158" stroke="#8b5cf6" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
</svg>
```

---

## Pro Tips

- **Label placement:** Center text with `text-anchor="middle"` at the horizontal midpoint of the box and `y` at about 60% of the box height
- **Consistent spacing:** Define your column x-positions and row y-positions as variables mentally before drawing — inconsistent gaps look sloppy
- **Dashed lines for async/optional:** Use `stroke-dasharray="5,4"` for async connections, webhooks, optional paths
- **Group related components** with a dashed container rect behind them (lower z-order = earlier in SVG source)
- **Keep viewBox height tight** — calculate the actual bottom of your lowest element + 30px padding and use that as the viewBox height

---

## Proactive Triggering

Automatically produce an SVG diagram (without being asked) when:
- User describes a system with multiple components and asks how it works
- User asks to "design" or "architect" something with services, databases, or queues
- A multi-agent team completes a task and the result is a system or workflow worth mapping
- User asks "what does the relationship between X and Y look like"
