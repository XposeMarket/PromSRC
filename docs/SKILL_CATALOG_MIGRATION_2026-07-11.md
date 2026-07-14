# Prometheus skill catalog migration — 2026-07-11

## Outcome

The original catalog contained 123 active skill folders. The migrated catalog contains 128 entries:

- 112 active
- 15 deprecated compatibility entries
- 1 archived entry
- 85 active skills passed the full migrated-catalog gate
- 27 skills were deliberately left unchanged after a required dependency or real workflow test failed or remained partial

Phase 1 now records machine-readable health for all 27 exceptions: 10 are hard-blocked from routing and 17 are partial/setup-only. Partial skills require explicit selection and expose their setup reason, verified capabilities, and blocked capabilities. Hard-blocked skills cannot route even when named.

The former Codex desktop app references in the four affected desktop workflows now target the installed `ChatGPT` app. Discovery and live window focus were verified on 2026-07-11. Claude was not open, so destructive restart and the full handoff/cross-app smoke sequences remain partial.

Phase 2 promoted `windows-shell-playbook` after disposable tests passed for file writes, spaced paths, JSON parsing, process inspection, and command discovery. Git local writes, Python-backed SQLite queries, and the frontend static-audit/template path gained verified capabilities but remain partial around remote/provider/browser boundaries.

## Original-catalog classification

### Keep

`airtable-connector`, `approval-policy-designer`, `artifact-registry`, `background-coding-agent-lanes`, `browser-to-connector-migration`, `chart-visualizer`, `cli-adapter-framework`, `codex-desktop-restart`, `competitor-profile`, `connector-smoke-test-harness`, `context-pack-builder`, `credential-scope-auditor`, `data-pipeline`, `database-query`, `discord-connector`, `embedding-search`, `error-budget-tracker`, `git-workflow`, `google-workspace-expansion`, `image-analyst`, `knowledge-import-pipeline`, `linear-connector`, `local-media-utilities`, `long-running-job-inspector`, `mcp-ops-troubleshooting`, `mcp-server-builder`, `meeting-notes`, `pptx-writer`, `report-generator`, `secret-and-token-ops`, `self-repair-protocol`, `subagent-system-prompt-design`, `taskflow-enhancement`, `teams-meeting-pipeline`, `threejs-mobile-webgl`, `trello-connector`, `webhook-receiver-framework`, `website-intelligence`, `website-to-hyperframes`, `x-post-fetch-and-media`, `xpose-lead-outreach-packet`.

### Narrow

`api-integration`, `browser-automation-playbook`, `codex-frontend-engineer`, `cold-outreach-writer`, `competitive-intelligence`, `connector-builder`, `deal-analyzer`, `desktop-automation-playbook`, `dev-debugging`, `email-composer`, `exact-logo-brand-kit-workflow`, `file-surgery`, `financial-analyst`, `financial-model`, `ghostwriter`, `hr-recruiter`, `integration-setup`, `landing-page-blueprint`, `legal-drafting`, `local-file-browser-verification`, `local-lead-hunting`, `market-research`, `marketing-campaign-builder`, `memory-governance-playbook`, `operations-manager`, `pitch-deck-builder`, `professional-blog-posting-engine`, `revenue-manager`, `scheduler-operations-playbook`, `sdr-sales`, `skill-creator`, `social-intel`, `src-edit-proposal-rigor`, `web-design-skill`, `web-researcher`, `web-scraper`, `windows-shell-playbook`, `x-browser-automation-playbook`.

### Split

`task-lifecycle` was split into:

- `execution-mode-routing` for choosing how new work should run
- `task-lifecycle` for inspecting and controlling work already running

### Merge

- `docx-reader` + `docx-writer` → `docx`
- `pdf-reader` + `pdf-writer` → `pdf`
- `xlsx-reader` + `xlsx-writer` → `spreadsheets`
- `html-interactive` + `interactive-visuals` → `interactive-artifacts`
- `json-and-config-surgery` → `file-surgery/references/config-surgery.md`
- `doc-ingestion` → `knowledge-import-pipeline/references/business-document-ingestion.md`
- `connector-recipe-library` → `connector-builder/references/connector-recipes.md`
- `prometheus-x-posts-workflow` → `prometheus-x-growth-operator/references/scheduled-posting.md`
- `prometheus-x-research-replies` → `prometheus-x-growth-operator/references/research-replies.md`
- `x-larp-posting-guidelines` → `prometheus-x-growth-operator/references/larp-guidelines.md`
- `contribute-catalog` was classified for merger into `skill-creator` but was not changed because its end-to-end shipping workflow failed dependency tests.

The superseded entries remain as deprecated, triggerless, explicit-only compatibility redirects. They were not physically deleted.

### Explicit-only

`ai-surface-smoke-research`, `animejs`, `brand-strategist`, `browse-sh-web-skills`, `css-animations`, `day-trading-mnq-mgc`, `gsap`, `hook-library`, `hyperframes-catalog-assets`, `hyperframes-cli`, `hyperframes-media`, `hyperframes-registry`, `lottie`, `mermaid-diagrams`, `polymarket-research`, `product-carousel-builder`, `product-discovery`, `prometheus-ash-archive-style`, `prometheus-x-growth-operator`, `svg-diagrams`, `tailwind`, `three`, `twitter-thread`, `typegpu`, `voice-browser-desktop-smoke-test`, `waapi`.

Passing role, provider, style, and manual skills now declare `implicitInvocation: false`. Failed skills were not edited; the runtime's conservative fallback may still infer explicit-only policy for some of them.

### Deprecated

`workflow-replay-runbook-recorder` is deprecated in favor of Brain candidates and the Skill Curator. Its historical instructions remain in `references/detailed-guide.md`.

### Archived

`craigslist-car-search` is archived and unroutable. The folder remains for recovery/history.

## Entrypoint migration

The nine original 2,000+ word skills now have focused entrypoints below 750 words and stable `references/detailed-guide.md` files:

- `browser-automation-playbook`
- `file-surgery`
- `scheduler-operations-playbook`
- `x-browser-automation-playbook`
- `professional-blog-posting-engine`
- `local-lead-hunting`
- `task-lifecycle`
- `exact-logo-brand-kit-workflow`
- `web-design-skill`

Additional large passing knowledge skills were narrowed using the same preserve-then-focus pattern, including business, writing, research, source-governance, local-browser verification, diagrams, integrations, X operations, and memory governance.

Some passing entrypoints between roughly 750 and 900 words remain because their code/reference density made further extraction low-value. `desktop-automation-playbook` remains above the target because it already contained a recent user-authored six-wrapper rewrite; its desktop contract passed and that work was preserved.

## Resource consolidation

The original inventory contained 124 date-stamped supplemental files.

- 92 passing-skill resources were migrated into stable canonical paths.
- Equivalent workflow, style, and recovery lessons were merged.
- `file-surgery` exact-text failures now converge on `references/recovery/text-match-failures.md`.
- Historical notes/examples were moved under stable `references/background/` or `references/examples/` paths.
- Original source path, date, destination, confidence state, and SHA-256 are stored in `workspace/Brain/skill-curator/catalog-migration-evidence.jsonl`.
- 32 dated files remain only inside skills that failed their real workflow/dependency gate. They were intentionally untouched. One reverted `skill-creator` migration explains the 92 + 32 total against the original 124.

## Routing and trigger changes

- Passing skills use no more than 12 normalized, deduplicated triggers.
- Generic single-word triggers are rejected by the runtime.
- Deprecated and archived skills are now excluded directly by `rankSkillMatches`, including explicit-name requests.
- Exact validated trigger phrases receive decisive positive-route weight.
- Explicit mention matching uses token/phrase boundaries rather than arbitrary substrings.
- Generic short IDs such as `three` do not match ordinary text such as “give me three options.”
- Longer exact skill names outrank contained shorter names; `threejs-mobile-webgl` wins its mobile prompts over `three`.
- The only exact collision found after normalization was repaired.
- `hook-library` no longer claims `email subject line`; `email-composer` owns that intent.
- `connector-builder` no longer claims `add connected app`; `integration-setup` owns setup while connector-builder owns implementation.
- `task-lifecycle` no longer claims the broad `background task`; `long-running-job-inspector` owns stuck long-running work.

## Real workflow and dependency tests

### Passed

- Full backend TypeScript build.
- Browser wrapper/extraction contracts.
- Desktop six-wrapper registry, state, cancellation, and background-worker contracts.
- DOCX create → Mammoth extract round trip.
- PDF create → PDF parse round trip.
- XLSX create → SheetJS read round trip.
- Polymarket helper plus live read-only API query.
- CSS animation seeking plus HyperFrames lint/validate.
- Three.js WebGL frame render and HyperFrames validation.
- Three.js mobile CanvasTexture fallback contract in Chromium.
- TypeGPU import plus a real WebGPU adapter/device/buffer submission in installed Chrome.
- WAAPI seeking plus HyperFrames validation.
- Connector/runtime structural probes and per-skill routing tests for the connector batch.
- Catalog-wide trigger and negative-routing gate.

### Untouched exceptions and corrections

- `ai-surface-smoke-research`: Codex is absent from installed-app discovery. Register/refresh the actual Codex application identity before retesting.
- `animejs`: installed Anime.js v4 exposes `animate()`/`createTimeline()` rather than the documented callable v3 API. Rewrite examples for v4 or pin v3.
- `codex-desktop-restart`: installed-app discovery finds no Codex target. Repair discovery and remove stale app IDs.
- `codex-frontend-engineer`: audits/browser contract pass, but the copied Vite template cannot build because Vite, the React plugin, and Lucide are missing. Add a locked bootstrap or a dependency-free fallback.
- `contribute-catalog`: lint/validation/snapshots/local Git pass, but FFmpeg/FFprobe, `gh`, and local `oxfmt` are absent; upstream catalog generation also produces unrelated drift. Fix all before claiming PR shipping.
- `database-query`: Python stdlib SQLite works, but `sqlite3`, `psql`, pandas, and psycopg2 are absent. Make stdlib SQLite the default and gate optional databases.
- `dev-debugging`: its required Codex desktop handoff cannot be verified because Codex is not discoverable.
- `git-workflow`: Git works, but GitHub CLI is absent. Split/gate GitHub operations or install/authenticate `gh`.
- `gsap`: core timeline seeking passes, but audio extraction fails without FFmpeg and optional plugins require explicit scripts. Add dependency checks and plugin loading.
- `hyperframes-catalog-assets`: export QA is blocked by missing FFmpeg/FFprobe.
- `hyperframes-cli`: init/lint/validate/inspect/snapshot/preview pass; render fails without FFmpeg. `info` and `compositions` also misread the CLI blank scaffold. Upgrade/fix parser and install media dependencies.
- `hyperframes-media`: TTS lacks `kokoro-onnx`; transcription lacks whisper.cpp; removal lacks FFmpeg/FFprobe; non-English TTS lacks espeak-ng. Correct default-model and segment/word claims too.
- `hyperframes-registry`: final add/wire/export verification is blocked by missing FFmpeg/FFprobe.
- `lottie`: lottie-web passes, but the documented dotLottie global is absent; use the verified ESM export or correct UMD build.
- `local-media-utilities`: FFmpeg and FFprobe are absent from PATH/bundled resolution.
- `pptx-writer`: `pptxgenjs` is missing and the documented `D:\Prometheus` setup path/script does not exist.
- `product-carousel-builder`: live shopping search returned an editorial review article as a product with questionable inferred price and no image. Enforce product identity/direct URL/image and fallback.
- `prometheus-ash-archive-style`: mandatory MP4 verification is blocked by missing FFmpeg/FFprobe.
- `self-repair-protocol`: documented `ls -la`/`python3` checks fail on Windows and some defaults risk secret exposure or unapproved installs. Add platform-safe diagnostics.
- `skill-creator`: runtime tools exist, but its own examples teach the obsolete frontmatter/direct-write contract and omit positive/negative trigger tests. Update only after a dedicated passing forward test.
- `voice-browser-desktop-smoke-test`: cannot complete its Codex-focus step because Codex is not discoverable.
- `web-scraper`: native fetch works, but optional Python scraping dependencies are absent and live browser extraction timed out. Make native fetch canonical and add bounded browser recovery.
- `webhook-receiver-framework`: registered routes are stored but no gateway consumer mounts them. Implement route mounting before changing the skill.
- `website-to-hyperframes`: capture/TTS/transcribe surfaces exist, but end-to-end media/export completion is blocked by missing dependencies.
- `windows-shell-playbook`: core shell/background tests pass, but documented `Select-String -Recurse` is invalid and `D:\Prometheus` is stale. Use `Get-ChildItem -Recurse | Select-String` and dynamic roots.
- `x-post-fetch-and-media`: a real X status fetch returned success with zero tweets. Treat empty extraction as failure and add login/deleted/blocked/fallback handling.
- `xpose-lead-outreach-packet`: required default scorecard/input tree is absent. Parameterize or restore the canonical lead root and add a fixture.

Provider-specific connector playbooks for Airtable, Discord, Linear, Teams, and Trello passed structural tests but do not have installed provider implementations. Google currently exposes Gmail and Drive, not the full expansion set. These skills must not be described as end-to-end configured until providers, vault credentials/scopes, and read plus dry-run/write probes exist.

## Regression command

Run:

```powershell
npm run test:skill-catalog
```

The gate validates strict two-field frontmatter for migrated skills, manifest loading, trigger caps, exact collisions, every positive trigger, two cross-domain negative prompts per skill, canonical resources, explicit-only policy, the nine priority entrypoint limits, deprecated/archived unroutability, `three` ambiguity, and the one-mandatory-skill routing contract.
