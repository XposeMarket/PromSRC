## 28) Bundled Skills

Prometheus supports two skill shapes through the shared package-aware runtime in `src/gateway/skills-runtime/`:

- simple skills: `<skillsDir>/<id>/SKILL.md` or `skill.md`
- bundled skills: `<skillsDir>/<id>/skill.json` plus an entrypoint markdown file and optional static resources

The normalized runtime model is loaded by `src/gateway/skills-runtime/skill-package.ts` and exposed through `SkillsManager` in `src/gateway/skills-runtime/skills-manager.ts`.

Bundled skill manifests use `skill.json`. V1 supported fields include:

- `schemaVersion`
- `id`
- `name`
- `version`
- `description`
- `emoji`
- `entrypoint`
- `prompt`
- `triggers`
- `implicitInvocation` (set `false` for broad, role, style, persona, mode, and manually invoked skills)
- `categories`
- `requiredTools`
- `permissions`
- `resources`
- `status`
- `lifecycle`
- `ownership`
- `execution_enabled`
- `risk`

Current lifecycle values are:

- `draft`
- `active`
- `experimental`
- `deprecated`
- `archived`

Current ownership values are:

- `local`
- `imported`
- `upstream-managed`
- `prometheus-owned-overlay`

`status` still represents operational readiness such as ready, needs setup, or blocked. `lifecycle` represents whether the skill should be used, trialed, retired, or hidden from normal routing. `ownership` represents how Prometheus should treat edits, especially for imported and upstream-managed skills.

The main skill tools are core tools:

- `skill_list`
- `skill_read`
- `skill_resource_list`
- `skill_resource_read`
- `skill_create`
- `skill_import_bundle`
- `skill_inspect`
- `skill_manifest_write`
- `skill_create_bundle`
- `skill_resource_write`
- `skill_resource_delete`
- `skill_export_bundle`
- `skill_update_from_source`

Skill metadata layers are resolved in this order:

- native manifest: `<skillDir>/skill.json`
- Prometheus overlay manifest: `<skillsDir>/.manifests/<skillId>.skill.json`
- frontmatter in `SKILL.md`
- synthesized fallback from the folder name

Native manifests win over overlays. Overlays let Prometheus or the user enrich third-party downloaded skills without modifying the upstream skill folder. Import provenance is stored beside overlays as `<skillsDir>/.manifests/<skillId>.source.json`.

Skill write safety is built into `SkillsManager`:

- before skill manifest/resource writes and resource deletes, Prometheus snapshots the current skill into `workspace/skills/.history/<skillId>/<timestamp>-<reason>/`
- every automatic or tool-driven skill write appends `workspace/skills/.history/skill-change-ledger.jsonl`
- ledger entries include `skillId`, `changeType`, `evidence`, `beforeHash`, `afterHash`, `appliedBy`, `status`, `snapshotDir`, `changedPaths`, and `reason`
- `skill_manifest_write`, `skill_resource_write`, and `skill_resource_delete` accept ledger metadata including `changeType`, `evidence`, `appliedBy`, and `reason`
- unified `skill_ops` exposes `triggerPositivePrompts` and `triggerNegativePrompts`; create/update/manifest/repair operations that change triggers must supply both and pass routing evaluation before the manifest write
- fleet metadata audits treat missing triggers on explicit-only skills as informational, report compatibility entries separately, and recognize guidance such as “Use only when”, “Use this skill when”, “Invoke when”, and “Designed for”
- bulk metadata repair performs a whole-request preflight for IDs, changes, and required trigger evaluations before its first write; preview output never invents triggers and marks trigger debt as blocked pending reviewed positive/negative prompts

2026-06-05 batch web research skill alignment:

- `web-researcher` is the canonical skill for `web_search({ fetch_top_k })`, `web_fetch_batch`, and single-URL `web_fetch` routing
- `browser-automation-playbook` and `desktop-automation-playbook` now explicitly say normal web reading belongs to web fetch tools before browser/desktop automation
- `web-scraper`, `browse-sh-web-skills`, `x-post-fetch-and-media`, and `x-browser-automation-playbook` include batch-fetch guidance for multiple URLs or multiple X status URLs
- research/business skills updated with the new path include `website-intelligence`, `local-lead-hunting`, `competitor-profile`, `polymarket-research`, `product-carousel-builder`, `connector-builder`, `integration-setup`, and `ai-surface-smoke-research`
- connector-oriented skill manifests that already listed `web_search`/`web_fetch` now also list `web_fetch_batch` where applicable
- stale "web_search + web_fetch" guidance was scanned out of live non-history skill files after the update

Brain Dream skill evolution rules:

- Brain Thought, Dream, cleanup, and normal chat submit structured candidates instead of mutating skills autonomously
- the dedicated Brain Skill Curator runs after Dream in `dry-run` mode during the mutation freeze
- Curator clusters equivalent candidates and defaults behavioral changes to pending review
- assistant response text is never user approval; confidence comes from explicit user instruction or validated recurrence across distinct sessions
- the Skill Curator auto-rejects weak legacy suggestions that are only raw workflow examples, generic troubleshooting notes, request/outcome dumps, or tool-sequence receipts
- Dream cleanup may reject weak pending suggestions or submit repair candidates, but cannot mutate skill files
- new skills require overlap analysis and explicit Curator approval before a separate `skill_evolution` proposal
- imported or upstream-managed skills should usually receive Prometheus overlays or additive resources instead of broad upstream file rewrites

Skill routing is relevance-ranked rather than registry-ordered. A turn may receive at most one high-confidence mandatory skill read; other plausible matches are advisory and must not be read automatically. Cross-domain lexical matches are discarded, so a coding task does not load an email, HyperFrames, or other unrelated specialist skill. Explicit-only skills (`implicitInvocation: false`) enter routing only when the user names them or a review explicitly requests overlap analysis.

Triggers are normalized, deduplicated, capped at 12 per skill, and generic single-word triggers are rejected. Creating or changing triggers requires positive and negative prompt sets; the proposed route must win its positive cases and stay absent or low-confidence in its negative cases before activation.

New-skill routing preflight evaluates positive prompts against the full candidate so the intended workflow must win. Negative prompts evaluate the proposed trigger phrases only: generic domain words in a skill’s name, description, categories, or tool list must not block installation when the negative prompt does not match a trigger.


2026-07-11 catalog migration:

- the original 123 folders were classified and migrated into a 128-entry catalog with 112 active, 15 deprecated compatibility entries, and 1 archived entry
- the nine original 2,000+ word entrypoints are below 750 words and retain full detail in stable `references/detailed-guide.md` files
- canonical `docx`, `pdf`, `spreadsheets`, `interactive-artifacts`, and `execution-mode-routing` skills were added; merged source entries remain triggerless/unroutable compatibility redirects
- 92 dated resources were consolidated with original path/date/hash evidence in `Brain/skill-curator/catalog-migration-evidence.jsonl`; 32 remain only in dependency-blocked skills that were intentionally not edited
- `npm run test:skill-catalog` validates all migrated triggers against positive cases and two cross-domain negative cases, resource existence, frontmatter, invocation policy, lifecycle routing, and collision boundaries
- the full classification, smoke-test ledger, and 27 untouched dependency exceptions are documented in `docs/SKILL_CATALOG_MIGRATION_2026-07-11.md`

Important V1 boundaries:

- bundled skills are declarative/instructional packages, not executable plugins
- `skill_resource_read` only reads text-like resources such as markdown, JSON, YAML, CSV, HTML, CSS, SVG, XML, and text
- resource paths are scoped to the skill folder; absolute paths and `../` traversal are rejected
- bundled scripts may be present as inert files, but Prometheus does not execute them as skill actions
- `skill_import_bundle` installs from a local directory, local `.zip`, HTTPS URL to a `.zip`, or GitHub tree URL such as `https://github.com/owner/repo/tree/main/skills`
- if the source contains multiple skill folders, `skill_import_bundle` imports the collection

Packaged app seeding in `src/config/public-workspace.ts` now accepts either `SKILL.md`, `skill.md`, or `skill.json`, and still never overwrites an existing user skill.

Resource discovery includes common static skill folders: `templates`, `schemas`, `examples`, `assets`, `prompts`, `prompt-fragments`, `docs`, `references`, `palettes`, `rules`, `data`, `fixtures`, and `scripts`. Script files are readable as text resources only; they are not runnable skill actions.

The HyperFrames skill pack from `https://github.com/heygen-com/hyperframes/tree/main/skills` is the first curated external-pack test case. It imports as a multi-skill collection and is enriched with Prometheus overlay manifests for:

- `hyperframes`
- `gsap`
- `hyperframes-cli`
- `hyperframes-registry`
- `website-to-video`
- `remotion-to-hyperframes`

Prometheus also has a local bridge skill, `prometheus-hyperframes-bridge`, that maps HyperFrames resources into Prometheus Creative Video mode. It tells agents to prefer Prometheus Creative HTML Motion tools for in-app video creation and use HyperFrames/GSAP resources as guidance rather than assuming the external HyperFrames CLI is installed.

Skill authoring now supports first-class bundle creation:

- `skill_create` remains the simple one-file `SKILL.md` path
- `skill_create_bundle` creates `skill.json`, `SKILL.md`, resources, metadata, permissions, and provenance
- `skill_resource_write` and `skill_resource_delete` mutate scoped text resources inside a skill folder
- `skill_export_bundle` writes a shareable `.zip`, materializing overlay manifests as `skill.json` inside the export
- `skill_update_from_source` re-imports from recorded provenance while preserving local overlays

`skill_curator` is the tool surface for the dedicated Brain Skill Curator:

- `skill_curator action=status` returns current curator suggestions
- `skill_curator action=run` defaults to `dry-run`; the scheduled post-Dream run also uses `dry-run`
- `skill_curator action=run mode=pending` persists reviewable suggestions without mutating skills
- `skill_curator action=run mode=auto-safe` remains compatibility-visible, but behavioral auto-application is frozen
- `skill_curator action=run mode=dry-run` previews without mutation
- `skill_curator action=apply id=<id>` manually applies a suggestion
- `skill_curator action=reject id=<id>` rejects a suggestion
- `skill_candidate_submit` records a structured candidate without changing skill files

Resource authoring is intentionally text-only and path-scoped. Absolute paths, `../` traversal, unsupported extensions, and oversized resources are rejected.

`src/config/soul-loader.ts` also uses the same package loader now, so subagent/bootstrap skill selection and chat/tool skill selection no longer parse incompatible skill formats.

## 28A) Hub and Frontend Views

The frontend mode router in `web-ui/src/app.js` includes `hub`, and the popover grouping now has audit, memory, and hub-oriented entries.

`web-ui/src/pages/HubPage.js` is a real usage surface, not just placeholder navigation. Current Hub facts:

- top skills and skill usage are read through the Hub API
- tool usage is shown as heatmap-style activity
- skill content can be previewed in a modal
- skill lifecycle and ownership are visible as badges
- recent skill changes are surfaced from the skill change ledger
- skill modals include lifecycle metadata and recent change history when available
- Skill Curator suggestions are visible on the Hub page and mobile Hub view
- curator cards should show typed lesson information first: what approval/apply changes, future trigger, learned behavior, why it helps, target path, quality, auto eligibility, risk, scan verdict, and raw evidence only behind details
- curator UI should avoid exposing raw plumbing as the main review surface; request excerpts, outcome excerpts, and tool lists are audit evidence, not the lesson
- achievements are scaffolded but still empty/stubbed in the current implementation

The matching backend surface is `src/gateway/routes/hub.router.ts`. The skills API in `src/gateway/routes/skills.router.ts` also exposes lifecycle, ownership, manifest source, and recent changes for skill views.

Current notable frontend surfaces also include:

- `web-ui/src/pages/ConnectionsPage.js`, including Obsidian vault connect/sync/remove UI
- `web-ui/src/components/CodingWorkspacePanel.js`, backed by `/api/coding/*`
- `web-ui/src/components/ProcessRunCard.js`, backed by `/api/processes/*`
- `web-ui/src/components/model-provider-credentials.js`, for provider credential status/setup
- Creative HyperFrames UI components under `web-ui/src/components/creative/`
- Onboarding UI under `web-ui/src/onboarding/`

Chat context-window UI:

- the desktop chat composer shows the active model/provider at the bottom right through `chat-model-name` and `chat-provider-name`
- beside that label is `chat-context-window-btn`, a small circular context indicator
- clicking the circle opens `chat-context-window-popover`; it intentionally mirrors the compact context-window style and does not show plan-usage/account quota information
- the popover displays current estimated input tokens, active model context window, message-token estimate, tool-observation-token estimate, and compaction trigger
- the UI fetches `GET /api/sessions/:id/context-window`
- `web-ui/src/pages/ChatPage.js` owns `refreshChatContextWindow(...)`, `scheduleChatContextWindowRefresh(...)`, `toggleChatContextWindowPopover(...)`, and `closeChatContextWindowPopover(...)`
- the indicator refreshes when the active chat syncs, after server session load, after persisted turns, after model changes, and on a 15-second fallback interval
- `web-ui/src/styles/components.css` owns the ring, popover, progress bar, and dark-theme styling
- generated public bundle files under `generated/public-web-ui/` must be resynced with `npm run sync:web-ui` after editing `web-ui/`

Backend endpoint for the UI:

- `GET /api/sessions/:id/context-window` lives in `src/gateway/routes/chat.router.ts`
- it resolves the active model context profile and budget, estimates the current API history tokens, adds recent tool observation context tokens, and returns both totals and breakdowns
- it uses `getHistoryForApiCall(...)`, `getRecentToolObservationsForContext(...)`, `estimateMessagesTokensForModel(...)`, and `estimateTextTokensForModel(...)`
- the endpoint is an estimate/diagnostic surface; it must not mutate session history or trigger compaction by itself

## 28B) Onboarding and Migration

Onboarding is account-scoped through `src/gateway/routes/onboarding.router.ts` and `src/gateway/onboarding/`.

Current onboarding routes:

- `GET /api/onboarding/status`
- `POST /api/onboarding/tutorial-shown`
- `POST /api/onboarding/tutorial-complete`
- `POST /api/onboarding/migration-complete`
- `GET /api/onboarding/model/health`
- `POST /api/onboarding/model-connected`
- `POST /api/onboarding/meet/start`
- `POST /api/onboarding/meet/complete`
- `POST /api/onboarding/memory-seed`
- `POST /api/onboarding/reset`
- `POST /api/onboarding/replay-tutorial`
- `POST /api/onboarding/redo`

Important onboarding facts:

- routes require an account user ID from `account.router.ts`
- memory seed has a dry-run mode and writes only approved paths
- redo onboarding has a server-side confirmation phrase guard: `redo onboarding`
- model health checks flow through `src/gateway/onboarding/model-health.ts`

Migration is implemented in `src/gateway/routes/migration.router.ts` and `src/gateway/migration/migration-service.ts`.

Current migration routes:

- `GET /api/migration/sources`
- `POST /api/migration/preview`
- `POST /api/migration/execute`
- `GET /api/migration/reports`
- `GET /api/migration/reports/:id`

Migration options currently support:

- source kinds: `hermes`, `openclaw`, `localclaw`, `custom`
- modes: `user-data` and `full`
- categories filtering
- optional secret inclusion
- overwrite behavior
- skill conflict handling: `skip`, `overwrite`, or `rename`
