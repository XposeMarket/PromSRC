# Prometheus skill revamp — final closeout

## Final state

The skill-system remediation and catalog migration are complete.

- 145 catalog entries
- 128 active, 16 deprecated compatibility redirects, 1 archived
- 145/145 health-ready
- 145/145 eligibility-ready
- 69 active implicit candidates and 59 active explicit-only specialists
- 137 skills in the public bundle; 8 development-only skills excluded
- 0 blocked or partial skills
- 0 critical safety quarantines
- 0 canonical date-stamped skill resources
- 0 broken live Markdown links or fragments
- 0 raw trigger-cap violations, generic single-word triggers, or exact trigger collisions
- 0 active Prometheus-owned entrypoints over 750 words

The machine-readable classification is in `docs/SKILL_CATALOG_FINAL_CLASSIFICATION_2026-07-12.json`:

| Disposition | Count |
|---|---:|
| Keep | 67 |
| Narrow | 48 |
| Split | 2 |
| Merge target | 11 |
| Deprecated | 16 |
| Archived | 1 |

`explicitOnly` is recorded separately for every skill so a narrowed or merged skill can also be manual-only.

## Governance and Curator

- Normal chat, Thought, Dream, cleanup, and workflow completion submit candidates rather than mutating skills.
- Brain Curator is the sole automatic writer.
- User preference/approval evidence comes only from user messages.
- Assistant praise, summaries, completion claims, and tool count cannot establish reusable instruction evidence.
- Tool failure, validation failure, and successful verification are separate signals.
- New skills require overlap analysis and review; behavioral edits remain pending unless they are exact metadata repairs.
- Candidate clustering, rejection/duplicate suppression, expiry, and stable evidence storage are implemented and regression-tested.
- Historical resource dates, sessions, confidence, hashes, and migration dispositions live in `workspace/Brain/skill-curator/catalog-migration-evidence.jsonl`, not canonical skill filenames.

## Routing

- Matching is relevance-ranked rather than registry-ordered.
- At most one high-confidence skill is mandatory for a turn; other matches are suggestions.
- Broad role/style/manual skills and HyperFrames specialists are explicit-only behind their entrypoint/orchestrator.
- Stored trigger lists are capped at 12, reject generic short single words, and have no exact collisions.
- Positive and cross-domain negative prompts are exercised catalog-wide.
- Coding prompts do not pull Gmail, X-growth, or HyperFrames skills.
- Deprecated and archived entries are unroutable even by explicit-name matching.

## Catalog migration

- The original long entrypoints were preserved in stable on-demand references and replaced with focused entrypoints.
- All active Prometheus-owned entrypoints are now at or below 750 words.
- The 124 original dated resources were consolidated or retired; no dated resource filename remains in the live catalog.
- 59 canonical files containing personal names, old drive paths, or channel-specific historical wording were generalized. The evidence store retains the migration record; `.history` snapshots remain untouched.
- Frontmatter is normalized to `name` and `description`; Prometheus-owned names equal folder slugs.
- Native and overlay manifests use valid JSON, at most 12 triggers, consistent lifecycle/health, and explicit routing policy.
- `codex-desktop-restart` became `chatgpt-desktop-restart`.
- `codex-frontend-engineer` became `frontend-quality-guard` and enforces the anti-AI-slop frontend rules.
- `voice-browser-desktop-smoke-test` was merged into `ai-surface-smoke-research` and retained only as a deprecated redirect.
- `hyperframes-media` was removed after merging into official `media-use`.
- `website-to-hyperframes` was removed in favor of official `website-to-video` plus `product-launch-video` routing.
- `xpose-lead-outreach-packet` was removed as requested.

## Repaired and live-tested capabilities

### Integrations

- X exact-status reads use official oEmbed and keep thread/media expansion opt-in. A live NASA status returned one post without downloading media.
- Webhook providers now enforce raw-body HMAC, a pre-parse 1 MiB limit, compressed-body rejection, prototype-key rejection, least-privilege provider tools, durable SQLite idempotency, bounded retries, leases, restart recovery, pruning, and safe provider-only mounting.
- Database query defaults to read-only and passed parameterized SQLite reads, EXPLAIN, mutation rejection, write approval gating, and missing-input failure behavior. Postgres/Supabase remain request-specific connection capabilities rather than global prerequisites.

### Operations and self-repair

- Self Repair diagnoses from live system/task/team/schedule state and freshness-aware redacted `workspace/audit` evidence.
- It emits a structured diagnostic packet. Development builds privately route proven source defects into `src-edit-proposal-rigor`; public builds never receive that reference.
- The legacy independent Self Repair patch executor is retired, leaving one governed source-edit lane.
- Contribution, ChatGPT restart discovery/disposable lifecycle, five-call developer handoff, and Ash & Archive application all passed bounded operational tests.

### Creative and artifacts

- Official HyperFrames skills and Prometheus Creative Mode are connected through the Creative Director and bridge skills.
- HyperFrames CLI found bundled FFmpeg/FFprobe and rendered a real 320x180, 30-frame H.264 proof.
- dotLottie Web 0.77.1 rendered a real 320x180, 60-frame animation with distinct sampled frames.
- The official website workflow captured a local branded site and rendered a visually checked 1920x1080, 30 fps, 6-second/180-frame H.264 tour.
- The HyperFrames catalog is refreshed from 47 to 134 entries with exact live/offline slug parity.
- `media-use` passed real Kokoro TTS, shared audio metadata/timestamps, Parakeet transcription, background removal with real alpha, FFmpeg/FFprobe discovery, and 213 passing local unit assertions (5 intentional platform/capability skips, 0 failures).
- Ash & Archive rendered a visually reviewed 4-second 1920x1080 H.264 proof.
- PPTX Writer generated an editable two-slide deck with `pptxgenjs@4.0.1`, rendered it through a user-local isolated LibreOffice profile, and passed PDF/PNG visual and structural QA.

## Public/development boundary

The public bundler now emits exactly 137 skills and performs generic per-skill resource exclusion for development-only references.

Verified public properties:

- includes Self Repair, ChatGPT restart, Ash & Archive, webhook, PPTX, HyperFrames, media-use, and website-to-video;
- excludes source-edit rigor, developer debugging, internal smoke/design skills, and Windows shell internals;
- omits Self Repair's `references/dev-escalation.md` and Git's private release pointer;
- excludes removed/renamed legacy IDs;
- contains none of the configured private names, machine paths, development tools, or source-edit markers.

## Verification

The final aggregate command passed 19/19 groups, including live X:

```powershell
npm run build:backend
node scripts/test-skill-revamp-closeout.mjs --with-live
```

It covers catalog safety/structure/routing, Curator evidence policy, Self Repair boundaries, Phase 3/4 contracts, database, webhook security, live X, HyperFrames catalog/status/roundtrip/render, the public bundle, and every media-use/HyperFrames skill-local test.

Additional independent results:

- 145/145 skills passed `quick_validate.py`.
- 17/17 core runtime regressions passed.
- Backend TypeScript build passed.
- ESLint passed.
- Web UI/generated UI parity passed.
- `git diff --check` passed; only Windows LF→CRLF advisory messages remain.
- The HyperFrames catalog producer regression now uses Prometheus's production wrapper, rational FPS, bundled media binaries, runtime bridge, and automatic disposable-artifact cleanup.

Future one-command non-live verification:

```powershell
npm run test:skill-revamp
```

Add `-- --with-live` to include the external X smoke test.

## Intentional external gates

These are not catalog-health defects:

- A real ChatGPT app restart remains confirmation-bound and was not performed because this task did not explicitly request closing the running app; discovery and a disposable process lifecycle passed.
- Publishing a contribution/PR still requires explicit authorization and configured GitHub credentials; the complete local contribution/commit/patch lifecycle passed without publishing.
- External Postgres/Supabase execution requires a request-specific connection.
- HeyGen CLI/auth is optional; local TTS, transcription, background removal, and rendering work without it.
- HyperFrames 0.6.20 advertises Node 22+, while this checkout currently runs Node 20.20.2; the real wrapper, catalog, dotLottie, and website renders all passed on the current runtime, but a future runtime upgrade should align the declared engine.
