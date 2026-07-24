# Prometheus Feature Catalog

Source-verified product reference, refreshed 2026-07-22. This is the document-ready, top-down companion to the implementation-oriented notes in `workspace/self/`. It describes the product surface without hiding the important availability boundaries: a capability can be built in yet require a configured provider, connected app, paired device, Windows host, installed skill, or explicit approval.

Use it to create product documents, onboarding, launch material, comparison copy, support explanations, or an implementation brief. Start with the catalog below; follow the linked reference when exact controls, APIs, or runtime behavior matter.

| Reference | Covers |
|---|---|
| [01-product-catalog.md](01-product-catalog.md) | Product promise, operating model, all major capability families, channels, safety/approval model, and document copy hooks |
| [02-tool-catalog.md](02-tool-catalog.md) | Canonical 23-category on-demand tool menu, always-on tools, browser/desktop controls, connectors, and availability rules |
| [03-desktop-web-ui.md](03-desktop-web-ui.md) | Every desktop page mode, Chat workspaces, settings, cross-page controls, and Electron shell context |
| [04-mobile-app.md](04-mobile-app.md) | Pairing/PWA model, router, every mobile surface, voice and push workflows, and desktop parity boundaries |
| [05-creative-studio.md](05-creative-studio.md) | Creative modes, editor, media intake, image/video/audio generation, HTML motion/HyperFrames, templates, and QA |
| [06-runtime-architecture.md](06-runtime-architecture.md) | Gateway/runtime structure, turn lifecycle, agents, teams, schedules, memory, Brain, data boundaries, and release surfaces |
| [07-api-surface.md](07-api-surface.md) | Gateway route-family map for documentation and integration planning (not a public API contract) |
| [08-static-tool-schema-inventory.md](08-static-tool-schema-inventory.md) | Exact source-generated index of all 430 static gateway tool schemas, grouped by definition module |
| [09-client-surface-inventory.md](09-client-surface-inventory.md) | Detailed desktop and mobile page/tabs/actions inventory, including current mobile Creative routing status |
| [10-self-reference-matrix.md](10-self-reference-matrix.md) | Complete map from the split self-reference source files to the catalog and document-building workflow |
| [11-static-tool-capability-index.md](11-static-tool-capability-index.md) | Source-derived description of each of the 430 static gateway tool schemas for precise feature/tool documents |
| [12-bundled-connector-tool-index.md](12-bundled-connector-tool-index.md) | Source-derived description of all 56 bundled dynamic connector tools, with configured-availability boundaries |
| [13-browser-and-desktop-tool-index.md](13-browser-and-desktop-tool-index.md) | Source-derived description of all 90 current browser and Windows desktop control tool schemas |
| [14-voice-tool-capability-index.md](14-voice-tool-capability-index.md) | Voice/realtime worker tool surface: 39 schemas with source-derived behavior and safety boundaries |
| [15-gateway-core-and-agent-builder-tools.md](15-gateway-core-and-agent-builder-tools.md) | Gateway-assembly layer: 21 inline core/wrapper tools plus 8 optional Agent Builder workflow tools |
| [16-voice-agent-and-worker.md](16-voice-agent-and-worker.md) | Complete Voice Agent/realtime versus Prometheus Worker architecture, handoff, safety, camera, interruption, and recovery behavior |
| [17-special-prometheus-tools-and-flows.md](17-special-prometheus-tools-and-flows.md) | Narrative guide to Prometheus-only one-off systems: X/xurl, fetch/media, delivery, goals, watches, evidence, proposals, deployment, Brain, and dynamic connections |
| [18-settings-plugins-connectors.md](18-settings-plugins-connectors.md) | Every Settings control plane, configuration/vault behavior, onboarding, connector discovery/setup/repair, plugin/extension lifecycle, MCP, and integration troubleshooting |
| [19-goals-context-continuity.md](19-goals-context-continuity.md) | Goal lifecycle, checkpoints, summaries and compaction, session/audit continuity, recovery, background work, threads, watches, timers, schedules, and heartbeats |
| [20-operational-systems.md](20-operational-systems.md) | Governed source edits and proposals, evidence/diagnostics, delivery/artifacts, Browser Teach/composites/Brain, repo/deployment/update, and media flows |
| [21-every-system-map.md](21-every-system-map.md) | Start-here map of all Prometheus subsystems, system boundaries, ownership, and links to the exact page/tool/system reference |
| [22-gateway-streams-audit-and-context.md](22-gateway-streams-audit-and-context.md) | Gateway turn flow, tool stream event types and UI rendering, audit mirror, recovery discipline, context-window calculations, and compaction UI |
| [pages/](pages/README.md) | Individual page references with state, controls, data flow, process logs, approvals, and recovery behavior |
| [mobile-pages/](mobile-pages/README.md) | Individual paired-mobile route references, including voice, recovery, team/agent tabs, settings reuse, and Creative routing status |

## Status vocabulary

- **Built in**: implemented in the current source tree.
- **Configured**: built in, but inactive until credentials, a provider, connection, device pairing, or local dependency exists.
- **Conditional**: shown only in an applicable mode or on an applicable host; it is not a universal UI promise.
- **Approval-gated**: available only after the user/operator authorizes the action.
- **Internal**: an implementation or operator surface, useful for architecture documents but not normal end-user marketing.

## Source authority and maintenance

This catalog was checked against the current `src/`, `web-ui/`, `electron/`, `native/`, package configuration, route modules, the canonical runtime tool-category manifest, and the split `workspace/self` reference. The canonical sources for implementation detail remain the linked self-reference files. The older [findings.md](findings.md) and [deep-cuts.md](deep-cuts.md) are retained as dated research notes; this set supersedes them for new documents.

When behavior changes, update the owning catalog page and its source anchors. Do not turn a configured, conditional, or approval-gated capability into an unconditional product claim.
