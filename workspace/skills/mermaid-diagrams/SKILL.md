---
name: Mermaid Diagrams
description: Render text-defined flowcharts, sequence diagrams, ER diagrams, Gantt charts, state machines, and class diagrams directly in chat using Mermaid.js syntax. Use when the diagram structure can be expressed as relationships between named entities — not for custom-positioned layouts (use svg-diagrams) or data charts (use chart-visualizer). Fast, readable, version-control friendly. Outputs a fenced ```mermaid block. Triggers on: flowchart, sequence diagram, process flow, ER diagram, entity relationship, Gantt chart, state machine, class diagram, timeline, decision tree, workflow diagram, data model.
emoji: "🗺️"
version: 1.0.0
triggers: flowchart, sequence diagram, process flow, ER diagram, entity relationship, gantt, state machine, class diagram, timeline, decision tree, workflow, data model, user journey, git graph, mindmap, quadrant, flow chart, flow diagram, steps diagram, approval flow, onboarding flow, login flow, auth flow, database schema
---

# Mermaid Diagrams

Render flowcharts, sequence diagrams, ERDs, Gantt charts, and more directly in chat using Mermaid.js syntax in a fenced `mermaid` block.

## CRITICAL OUTPUT RULES

- Output a single fenced ` ```mermaid ` block
- **No file saving.** Inline output only — no file tools
- **No declare_plan.** Read skill → output mermaid block. Done
- Mermaid.js is auto-injected — no imports needed
- Theme auto-switches with dark/light mode — never configure theme manually

---

## When to Use Mermaid vs Other Formats

| Need | Use |
|---|---|
| Nodes and edges defined by names/relationships | **This skill (Mermaid)** |
| Precise spatial layout / custom box positions | `svg-diagrams` skill |
| Data visualization (bar, line, pie) | `chart-visualizer` skill |
| Interactive widget with state/controls | `html-interactive` skill |

Mermaid wins when the diagram is **relationship-driven**: A connects to B, B connects to C. If you find yourself thinking about x/y coordinates, use SVG instead.

---

## Diagram Types & Syntax

### Flowchart (most common)

```mermaid
flowchart TD
  A[User Request] --> B{Auth Check}
  B -- Valid --> C[Load Context]
  B -- Invalid --> D[Return 401]
  C --> E[Run Agent]
  E --> F{Tool Needed?}
  F -- Yes --> G[Execute Tool]
  F -- No --> H[Generate Response]
  G --> H
  H --> I[Return to User]
```

**Direction options:**
- `TD` — top-down (default, most readable)
- `LR` — left-right (good for pipelines)
- `BT` — bottom-top
- `RL` — right-left

**Node shapes:**
- `[Label]` — rectangle (process step)
- `{Label}` — diamond (decision)
- `(Label)` — rounded rectangle (start/end)
- `([Label])` — stadium/pill
- `[[Label]]` — subroutine
- `[(Label)]` — cylinder (database)
- `>Label]` — flag/ribbon

**Edge types:**
- `-->` — solid arrow
- `---` — solid line, no arrow
- `-.->` — dashed arrow
- `==>` — thick arrow
- `-- label -->` — labeled arrow
- `-- label ---` — labeled line

**Subgraphs (grouping):**
```mermaid
flowchart LR
  subgraph Frontend
    A[Browser] --> B[React App]
  end
  subgraph Backend
    C[API Server] --> D[(Database)]
  end
  B --> C
```

---

### Sequence Diagram

Use for API calls, auth flows, inter-service communication, user interaction flows.

```mermaid
sequenceDiagram
  participant User
  participant App
  participant Auth
  participant DB

  User->>App: POST /login
  App->>Auth: validate(token)
  Auth-->>App: {valid: true, userId: 123}
  App->>DB: getUserById(123)
  DB-->>App: user record
  App-->>User: 200 OK + session cookie
```

**Message types:**
- `->>` — solid arrow (synchronous call)
- `-->>` — dashed arrow (async response)
- `-x` — solid, crossed (failure)
- `--x` — dashed, crossed
- `-)` — async message (open arrowhead)

**Extras:**
```mermaid
sequenceDiagram
  Note over Auth: Validates JWT signature
  loop Retry logic
    App->>External: fetch()
    External-->>App: timeout
  end
  alt Success
    App-->>User: 200
  else Failure
    App-->>User: 500
  end
```

---

### ER Diagram

Use for database schemas, data models, entity relationships.

```mermaid
erDiagram
  USERS ||--o{ ORDERS : places
  ORDERS ||--|{ ORDER_ITEMS : contains
  PRODUCTS ||--o{ ORDER_ITEMS : "included in"
  USERS {
    uuid id PK
    string email
    string name
    timestamp created_at
  }
  ORDERS {
    uuid id PK
    uuid user_id FK
    decimal total
    string status
    timestamp placed_at
  }
  PRODUCTS {
    uuid id PK
    string name
    decimal price
    int stock
  }
```

**Relationship notation:**
- `||--||` — one to one
- `||--o{` — one to zero-or-many
- `||--|{` — one to one-or-many
- `}o--o{` — zero-or-many to zero-or-many

---

### Gantt Chart

Use for project timelines, sprint planning, build schedules.

```mermaid
gantt
  title Prometheus CIS — Phase 5
  dateFormat YYYY-MM-DD
  section Policy Engine
    policy.ts core logic      :done, 2024-03-01, 3d
    audit-log.ts              :done, 2024-03-03, 2d
  section Wiring
    registry.ts wrapper       :active, 2024-03-10, 2d
    approval UI update        :2024-03-12, 1d
  section UI
    Audit log viewer          :2024-03-13, 3d
```

---

### State Diagram

Use for state machines, lifecycle flows, status transitions.

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Running : dispatch()
  Running --> Paused : pause()
  Paused --> Running : resume()
  Running --> Complete : finish()
  Running --> Failed : error()
  Failed --> Pending : retry()
  Complete --> [*]
```

---

### Class Diagram

Use for OOP structures, TypeScript interfaces, system object models.

```mermaid
classDiagram
  class Agent {
    +string id
    +string model
    +string[] tools
    +run(task) Promise
    +spawn(config) Agent
  }
  class ManagedTeam {
    +string teamId
    +Agent[] members
    +dispatch(goal) void
    +getStatus() TeamStatus
  }
  class ToolRegistry {
    +register(tool) void
    +execute(name, args) ToolResult
    +list() Tool[]
  }
  Agent --> ToolRegistry : uses
  ManagedTeam --> Agent : manages
```

---

### Timeline

Use for historical sequences, roadmap milestones, chronological events.

```mermaid
timeline
  title Prometheus CIS Build Phases
  Phase 1 : Business Brain
           : BUSINESS.md + entities/
  Phase 2 : Website Intelligence
           : deploy_analysis_team.ts
  Phase 3 : Social Media Coach
           : social-scraper.ts
  Phase 4 : CIS Integrations
           : Gmail, Slack, GitHub + more
  Phase 5 : Policy + Audit
           : policy.ts + audit-log.ts
```

---

## Rules & Anti-Patterns

**DO:**
- Use `TD` (top-down) as default — only switch to `LR` when the flow reads better horizontally (pipelines, CI/CD)
- Keep node labels short — 3–5 words max. Longer text → truncate or use a subtitle in a subgraph
- Use subgraphs to group related nodes instead of adding visual noise with long names
- Use sequence diagrams for any inter-service or API call flow — flowcharts get confusing with back-and-forth

**DON'T:**
- Don't use Mermaid for diagrams needing exact component positioning — use `svg-diagrams`
- Don't use `pie` type in Mermaid — use `chart-visualizer` for all data charts
- Don't write more than ~20 nodes in a single flowchart — split into sub-diagrams
- Don't add manual theme configuration — the renderer auto-applies dark/light theme
- Don't use special characters (`<`, `>`, `"`) in node labels without quoting — wrap in `"quotes"` if needed

---

## Quick Decision Guide

| User says | Diagram type |
|---|---|
| "flowchart / workflow / process steps" | `flowchart TD` |
| "how does the login / auth flow work" | `sequenceDiagram` |
| "database schema / data model / ERD" | `erDiagram` |
| "project timeline / sprint plan / milestones" | `gantt` |
| "state transitions / lifecycle / status flow" | `stateDiagram-v2` |
| "class structure / interfaces / type hierarchy" | `classDiagram` |
| "chronological events / history / roadmap" | `timeline` |

---

## Proactive Triggering

Automatically produce a Mermaid diagram (without being asked) when:
- User describes a multi-step approval or onboarding process
- User asks how a feature or API flow works end-to-end
- A team produces a workflow that would benefit from visual documentation
- User describes relationships between database tables or objects
- User plans a project with phases, milestones, or dependencies
