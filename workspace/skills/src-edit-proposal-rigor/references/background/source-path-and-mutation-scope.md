# Source path and mutation-scope guardrail — 2026-05-18

Observed during mobile/web-ui source-edit work: failures clustered around mixing workspace file tools/paths with Prometheus source tools and around attempting edits outside the approved mutation scope.

Guardrail:

- For Prometheus source reads/edits, use source/web-ui source tools with source-relative paths (for example `gateway/session.ts`, `gateway/routes/chat.router.ts`, `src/mobile/mobile-pages.js`, `src/styles/mobile.css` depending on the tool family). Do not pass workspace-style paths such as `src/gateway/session.ts` to workspace file tools when source tools are the intended route.
- Before requesting approval or editing, include every file that may be touched in the approved scope. If investigation reveals a needed file outside scope, stop and request/obtain expanded source-edit approval rather than trying to edit around the scope guard.
- When a source edit is rejected as syntactically invalid, re-read the exact surrounding block and retry with a structurally complete anchor/range. Do not stack more small replacements on stale line assumptions.
- After web-ui/mobile edits, keep the standard gate: `npm run sync:web-ui && npm run build`, then apply live with accurate `prom_apply_dev_changes` surfaces when available.

Evidence from 2026-05-18: mobile approval/card/session edits produced errors from `find_replace` on `web-ui/src/styles/mobile.css` via workspace path, `grep_file` on `src/gateway/session.ts`, source edits outside approved scope for `web-ui/src/mobile/mobile-router.js`, and syntax-rejected `mobile-pages.js` brace fixes before re-reading and applying a complete fix.
