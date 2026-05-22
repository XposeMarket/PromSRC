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

Brain Dream skill evolution rules:

- existing skills can be updated automatically by Brain Thought or Brain Dream only when the change is low-risk, bounded, and backed by session evidence
- automatic existing-skill updates should prefer additive triggers, clarified guardrails, corrected tool order, or scoped resource/template additions
- Brain Thought may apply existing-skill maintenance immediately but must explain the change and evidence in its thought artifact for Dream audit
- Brain Dream audits Thought-applied skill changes and may keep, refine, remove/supersede, or defer them if they add noise or duplicate guidance
- the dedicated Brain Skill Curator runs after Dream in `auto-safe` mode and applies only low-risk typed lessons that pass deterministic quality gates
- the Skill Curator auto-rejects weak legacy suggestions that are only raw workflow examples, generic troubleshooting notes, request/outcome dumps, or tool-sequence receipts
- Dream cleanup acts as the model-backed Skill Curator Critic about thirty minutes later; it reviews curator state and can accept, reject, revert, refine, or mark items `needs_review`
- cleanup critic may delete/revert an auto-applied curator resource when it clearly fails the quality gate, but must not rewrite skills broadly, archive/merge/delete skills, or create new skills
- new skills are Dream-only and proposal-based: Dream automatically files `skill_evolution` proposals when the quality gate passes, but does not directly create the skill
- imported or upstream-managed skills should usually receive Prometheus overlays or additive resources instead of broad upstream file rewrites

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
- `website-to-hyperframes`
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
- `skill_curator action=run mode=auto-safe` is the default run mode and can auto-apply safe typed lessons
- `skill_curator action=run mode=dry-run` previews without mutation
- `skill_curator action=apply id=<id>` manually applies a suggestion
- `skill_curator action=reject id=<id>` rejects a suggestion

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
