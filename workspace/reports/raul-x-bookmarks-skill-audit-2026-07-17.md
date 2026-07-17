# Raul's X Bookmarks → Prometheus Skill Roadmap

**Audit date:** 2026-07-17  
**Report status:** Complete and verified  
**Source:** Raul's authenticated X Bookmarks timeline (`https://x.com/i/bookmarks`)  
**Corpus:** 499 unique canonical status URLs collected in the first full pass; a second classification pass reproduced 497 items (two-item variance from X's virtualized timeline/loading).  
**Catalog baseline:** 147 installed skills; 130 available; 17 unavailable/quarantined/disabled/deprecated.

## Executive judgment

The bookmarks are not random inspiration. They form a strong operating thesis: **Prometheus should turn a spoken or loosely stated objective into parallel, supervised work, choose the right model for each lane, independently review the result, and preserve the reusable method as a skill.**

The highest-value gap is not another generic coding or web-design skill. The installed catalog already covers those surfaces well. The clearest missing layer is a reusable **goal supervision workflow** that converts a brain dump into scoped threads, actively steers them, demands artifacts/evidence, and runs an independent final review. The next gaps are a formal **fresh-context review protocol**, **evidence-driven model routing**, and a **bookmark-to-skill distillation loop**.

## Method and confidence

1. Opened Raul's authenticated X bookmarks in Prometheus's browser lane.
2. Deduplicated posts by canonical `/status/<id>` URL while scrolling the virtualized timeline.
3. Captured visible post text, author, date label, engagement text, quote-post context, and URL.
4. Clustered a fresh 497-post pass with broad workflow signals. Two important measured clusters were **agent orchestration: 115 matches** and **skills/prompts/context: 95 matches**. Other repeated families were creative/web production, browser/desktop automation, research/review, business growth, connectors/MCP, and voice/media.
5. Queried the live skill catalog globally and with workflow-specific semantic searches. Conclusions below distinguish **new gap**, **improve existing**, and **already covered**.

**Limitations:** X exposes a virtualized, mutable timeline. Counts may drift as posts load, disappear, or get unbookmarked. Keyword cluster counts overlap and indicate prevalence, not exclusive taxonomy. Recommendations are based on repeated workflow evidence and concrete catalog matches, not engagement totals alone.

---

## Ranked recommendations

### 1. NEW — `supervised-goal-orchestrator`

**Priority:** P0  
**Why:** This is the most repeated and most Prometheus-native pattern in the corpus, yet the catalog returned no strong match for the complete workflow.

**Bookmark evidence**

- [Victor Nunez, Jul 14](https://x.com/nunezvice/status/2077162415310184877): voice brain-dump into one master thread, then multiple threads on separate worktrees, delegation to subagents, and parallel completion.
- [Nick Baumann, Jul 14](https://x.com/nickbaumann_/status/2077104472598442145): ask one thread to write a goal for another and “babysit it until it figures it out,” adding steering and taste verification.
- [Daniel Steigman, Jul 16](https://x.com/trekedge/status/2077609560723099676): spin up Codex threads to accelerate work and consume available capacity.
- The classification pass found **115/497 posts** matching agent/thread/delegation/orchestration signals.

**Catalog comparison**

- `background-coding-agent-lanes` is a strong partial match, but is repository/coding-lane oriented: investigation, implementation, code review, diff handoff, verification, reconciliation.
- `task-lifecycle` manages existing tasks, not objective decomposition and active supervision.
- `taskflow-enhancement` is for building Prometheus task orchestration itself, not running a reusable user workflow.
- No strong catalog result matched voice/brain-dump → master goal → parallel threads/worktrees → supervision → synthesis.

**Concrete skill contract**

- Input: loose objective, voice transcript, or messy brief.
- Normalize into: objective, acceptance criteria, non-goals, constraints, artifacts, verification.
- Map unknowns first; do not prematurely lock a goal from a bad premise.
- Decide between background agents, first-class Prometheus threads, or a managed team.
- Dispatch bounded lanes with self-contained prompts and explicit evidence requirements.
- Supervise with progress checks, steering, no-progress limits, and recovery.
- Reconcile artifacts/conflicts and run an independent final review.
- Produce a final evidence ledger: lane, owner, output, verification, unresolved risk.

**Suggested triggers:** “babysit this goal,” “run this in parallel,” “turn this brain dump into threads,” “delegate and supervise,” “keep working until verified,” “master thread.”

---

### 2. NEW — `independent-fresh-context-review`

**Priority:** P0  
**Why:** Independent review is a distinct reusable protocol, not just “ask another agent to review.” It directly counters reasoning inertia and should be callable after any significant implementation or artifact build.

**Bookmark evidence**

- [Vox, Jul 14](https://x.com/Voxyz_ai/status/2077061729985437716): review completed work in a **fresh Codex session** because it did not participate in implementation and does not carry the original session's reasoning inertia; create `review-brief.md` before closing the implementation session.
- The quoted companion method in that post: map code/docs/unknowns in parallel, have a strong model attack the plan, then check objections against local evidence before writing the final goal.
- [Nick Baumann, Jul 14](https://x.com/nickbaumann_/status/2077104472598442145): a supervising thread adds another layer of taste verification.

**Catalog comparison**

- `background-coding-agent-lanes` mentions code review and handoff, but fresh-session independence, review-brief structure, reasoning-inertia avoidance, objection adjudication, and reviewer non-contamination are not surfaced in its catalog contract.
- `frontend-quality-guard` is excellent domain-specific QA, not a general independent-review protocol.

**Concrete skill contract**

1. Implementation lane writes `review-brief.md`: objective, acceptance criteria, changed artifacts, decisions, known doubts, tests run, and exact evidence paths.
2. Spawn a reviewer with no implementation conversation/history beyond the brief and artifacts.
3. Reviewer attacks assumptions first, then inspects actual files/UI/output.
4. Every objection is labeled confirmed, disproven, or unresolved with evidence.
5. Implementation lane receives only actionable findings; no vague “looks good.”
6. Final verdict: verified, needs remediation, or blocked.

**Improve alongside:** add this as a referenced mode/resource inside `background-coding-agent-lanes`, even if a standalone cross-domain skill is created.

---

### 3. NEW — `evidence-driven-agent-model-router`

**Priority:** P1  
**Why:** Raul's bookmarks repeatedly encode task-specific model assignment and benchmark-based routing. The installed catalog has model administration and coding lanes, but no reusable operational playbook that measures, selects, and revises model routing per lane.

**Bookmark evidence**

- [Pietro Schirano, Jul 10](https://x.com/skirano/status/2075672649741861005): Sol Ultra for planning, Sol Medium for plan execution/general coding, Terra High for quick context/search subagents, Luna for chat or small computer actions.
- [Vox, Jul 12](https://x.com/Voxyz_ai/status/2076320930188427363): reports a harness benchmark with speed and output-token differences before changing subagent choice.
- [Max Weinbach, Jul 11](https://x.com/mweinbach/status/2075996738779795547): a stronger model delegates threads to a lighter model.
- [Theo, Jul 15](https://x.com/theo/status/2077317685679985119): models with all required tools still chased irrelevant causes, showing that model strength alone is not sufficient; task framing and evidence gates matter.

**Catalog comparison**

- Targeted catalog search returned `background-coding-agent-lanes` as the only strong match, but its public contract does not define benchmark collection or adaptive model policy.
- Model-management tools configure defaults; they do not provide a repeatable empirical routing workflow.

**Concrete skill contract**

- Define lane classes: planning, coding, research/context, computer actions, review, summarization.
- Benchmark candidates on representative tasks with latency, success, verification pass rate, output tokens, tool errors, and cost.
- Keep routing as a versioned decision table with fallback routes and provider-quota handling.
- Re-benchmark after model/provider changes or when live evidence contradicts policy.
- Never route solely from social claims; treat bookmarks as hypotheses and local benchmark evidence as authority.

---

### 4. NEW — `bookmark-to-skill-distiller`

**Priority:** P1  
**Why:** This audit itself is a reusable loop. Raul bookmarks workflows faster than they can be operationalized. Prometheus should systematically turn that stream into candidates, dedupe them against the catalog, and preserve evidence.

**Bookmark evidence**

- **95/497 posts** matched skill/prompt/context/memory signals.
- [Leon Lin, May 2](https://x.com/LexnLin/status/2050709691978936715) and [May 4](https://x.com/LexnLin/status/2051395089377660989): a reusable `imagegen-frontend-web` skill turns one prompt into a coherent multi-section visual system.
- [Vox, Jul 10](https://x.com/Voxyz_ai/status/2075558574617460781): describes “kill AI slop” explicitly as a reusable agent audit skill.
- [Higgsfield, Jun 4](https://x.com/higgsfield_ai/status/2062607081010864364): packages brand kit → motion generation → scroll-driven site as a skill.

**Catalog comparison**

- `x-browser-automation-playbook` can inspect bookmarks, and `x-post-fetch-and-media` can read known posts.
- Skill maintenance tools exist, but the catalog lacks a skill whose product is a ranked, evidence-backed skill-gap audit from bookmarks/saved links.

**Concrete skill contract**

- Collect canonical URLs and full visible text with a stable cutoff.
- Extract workflow claims, inputs, outputs, tools, checks, and failure modes.
- Group duplicate ideas and distinguish inspiration from repeatable procedure.
- Compare against installed skill IDs/descriptions/triggers/resources.
- Score novelty, frequency, Raul relevance, implementation leverage, evidence quality, and overlap risk.
- Output: ranked report, proposed skill metadata/triggers, improvement patches, and a rejected/covered appendix.
- Never auto-install third-party skill text; inspect and manually adapt to Prometheus tools and policies.

---

### 5. IMPROVE — `background-coding-agent-lanes`

**Priority:** P1  
**Why improve instead of duplicate:** It is already the strongest catalog match for parallel coding work. The bookmarks add missing operating modes.

**Add these resources/modes**

- **Map-before-goal:** map code, docs, and unknowns in parallel; adversarially attack the premise before committing.
- **Supervisor lane:** one agent/thread owns steering and acceptance, not implementation.
- **Fresh reviewer lane:** reviewer receives a structured brief and artifacts, not implementation reasoning.
- **Model-role matrix:** planning/coding/context/review/computer-action assignments with measured fallbacks.
- **Reasoning relevance check:** require profiling/evidence for performance work so agents do not optimize non-render-path distractions, motivated by [Theo's GPU investigation](https://x.com/theo/status/2077317685679985119).
- **Goal completion ledger:** acceptance criterion → evidence → verifier → status.

**Acceptance test:** Given a difficult repo goal, the skill should produce separate mapping, planning, implementation, and independent-review artifacts, and reconcile reviewer objections before claiming completion.

---

### 6. IMPROVE — `frontend-quality-guard` + `web-design-skill`

**Priority:** P2  
**Why:** The catalog already strongly covers the “kill AI slop” idea. A new overlapping skill would add noise. Improve the existing quality gate with stronger evidence and reusable taste checks.

**Bookmark evidence**

- [Vox, Jul 10](https://x.com/Voxyz_ai/status/2075558574617460781): an agent audit strips the generic AI look in one pass.
- [Viktor Oddy, Jun 6](https://x.com/viktoroddy/status/2063266582034284940): cheap-looking AI sites are often afraid of empty space.
- [Leon Lin, May 2](https://x.com/LexnLin/status/2050709691978936715): generate one coherent image per page section before constructing the real site.
- [Abhijeet Singh, Jun 5](https://x.com/abjt14/status/2062934834402799710): modern web visual quality can use real DOM/refraction rather than flat imitation.

**Catalog comparison**

- `frontend-quality-guard` was a very strong semantic match (score 218) for AI-slop removal.
- `web-design-skill`, `imagegen`, `landing-page-blueprint`, and `exact-logo-brand-kit-workflow` together cover most of the visual pipeline.

**Concrete improvements**

- Add an explicit anti-slop checklist: generic gradient/glow, excessive pills, cramped density, fake dashboards, random glass, repeated card grids, weak type hierarchy, stock icon monotony, and insufficient negative space.
- Add a section-by-section visual asset plan before generation.
- Require screenshot-based before/after evidence at desktop and mobile widths.
- Add novelty restraint: use advanced effects only when brand/content justify them.
- Cross-reference Raul's standing non-purple/blue/cyan editorial/industrial preference.

---

### 7. NEW — `revenue-agent-system-designer`

**Priority:** P2  
**Why:** Existing `local-lead-hunting` covers discovery and qualification, but bookmarks point toward a broader shared-company-brain and CRM feedback system.

**Bookmark evidence**

- [Shann Holmberg, Jun 15](https://x.com/shannholmberg/status/2066463717097877870): build revenue-generating AI systems before content/ops agents; ten agents connected to one company brain and CRM, beginning with instant post-call transcript scoring.
- This aligns directly with Raul's Xpose Market client acquisition and Prometheus-for-business operating-layer thesis.

**Catalog comparison**

- `local-lead-hunting` is a strong match for public-source lead discovery, qualification, and persistence.
- No strong result covered CRM-connected call feedback, pipeline intervention, next-best action, and closed-loop revenue measurement.

**Concrete skill contract**

- Map funnel stages and authoritative systems.
- Prioritize agents by time-to-revenue and measurable intervention point.
- Start read-only/draft-first; require approval for external sends and CRM mutations.
- Standard agent modules: call scorer, follow-up drafter, stalled-deal detector, objection miner, lead enricher, proposal QA, churn/renewal signaler.
- Shared evidence schema: customer, event, source, confidence, recommended action, owner, outcome.
- Measure conversion lift and false-positive cost before adding more agents.

---

### 8. IMPROVE — `x-browser-automation-playbook`

**Priority:** P2  
**Why:** The live audit worked, but exposed specific collection/tooling gaps worth preserving.

**Observed evidence from this run**

- User Chrome could not attach on debug port 9223 while normal Chrome processes were open; full process closure still did not recover the lane immediately. Prometheus's authenticated browser profile worked.
- `scroll_collect_v2` rejected the supplied structured arguments (“Too many arguments”), and `scroll_collect` unexpectedly demanded structured extraction configuration.
- Direct DOM collection succeeded and yielded 499 unique posts; a second pass yielded 497, demonstrating X virtualization drift.
- The collection needed canonical URL dedupe and a stable-no-new boundary.

**Concrete improvements**

- Add a bookmarks-audit recipe: start at top, collect `article` text + canonical status URL, dedupe, use a bounded 60–80 scroll ceiling, record first/last URL and count, and rerun a short verification pass.
- Add explicit fallback order: user Chrome → close/reopen exact profile → Prometheus authenticated profile → desktop-only extraction.
- Document that X bookmark corpus counts can vary slightly between passes.
- Add a raw JSON/JSONL persistence recipe using workspace-native write when browser download paths are unavailable.

---

### 9. IMPROVE — `local-lead-hunting`

**Priority:** P3  
**Why:** Do not replace it with a generic sales-agent skill. Extend its handoff into the revenue system.

**Improvements**

- Emit CRM-ready evidence records, not only lead lists.
- Add “next best revenue action,” owner, due date, and approval state.
- Add closed-loop outcome updates so qualification rules learn from replies/calls/wins.
- Cross-reference `revenue-agent-system-designer` if created.

---

### 10. NEW — `brand-assets-and-logo-retrieval`

**Priority:** P3  
**Why:** Small scope, high frequency in design work, and distinct from preserving an already supplied logo.

**Bookmark evidence**

- [Matt Palmer, Jun 6](https://x.com/mattyp/status/2063279978620571745): a searchable source for company logos, SVGs, brand assets, API access, and desktop retrieval.

**Catalog comparison**

- `exact-logo-brand-kit-workflow` preserves supplied logos but does not promise authoritative discovery/retrieval.
- `media-use` resolves assets for HyperFrames, but catalog semantics are production-oriented rather than brand-source verification.

**Concrete skill contract**

- Search official brand/press kits first, then reputable asset indexes.
- Verify company/domain, license/usage terms, logo variant, and freshness.
- Prefer SVG; preserve exact paths/colors; never AI-redraw an official mark.
- Save source URL, retrieval date, variant metadata, and local path.

---

## Ideas already covered — do not create duplicates

| Bookmark theme | Existing coverage | Decision |
|---|---|---|
| Generic “kill AI slop” frontend audit | `frontend-quality-guard`, `web-design-skill` | Improve existing resources/checklists |
| Parallel coding worktrees/lanes | `background-coding-agent-lanes` | Expand supervision and independent review modes |
| Multi-section website design | `web-design-skill`, `landing-page-blueprint`, `imagegen`, `frontend-quality-guard` | Add section-image pipeline resource, not a parallel top-level skill |
| X bookmark navigation/collection | `x-browser-automation-playbook` | Add audit recipe and recovery notes |
| Local business lead discovery | `local-lead-hunting` | Extend downstream CRM/revenue handoff |
| Known X post/thread reading | `x-post-fetch-and-media` | Already appropriate |
| MCP/server creation and diagnosis | `mcp-server-builder`, `mcp-diagnostics`, `connector-builder`, `integration-setup` | Existing coverage is strong |
| General web scraping/research | `web-scraper`, `web-researcher`, `competitive-intelligence` | No new generic scraper skill |

## Recommended implementation sequence

1. Create `supervised-goal-orchestrator` as a bundle with templates for normalized goal, lane brief, supervision log, and evidence ledger.
2. Create `independent-fresh-context-review`, and cross-link it from `background-coding-agent-lanes`.
3. Update `background-coding-agent-lanes` with map-before-goal, supervisor, model-role, and reviewer modes.
4. Create `bookmark-to-skill-distiller` using this report as its first worked example.
5. Build `evidence-driven-agent-model-router` only after defining a compact local benchmark suite.
6. Improve `frontend-quality-guard`, `web-design-skill`, and `x-browser-automation-playbook` with the concrete resources above.
7. Create `revenue-agent-system-designer`, then connect `local-lead-hunting` outputs to its evidence schema.
8. Add `brand-assets-and-logo-retrieval` when the next real brand/site workflow exercises it.

## Proposed scoring rubric for future bookmark audits

Score each candidate 0–5 on:

- **Frequency:** repeated independent bookmark evidence.
- **Raul fit:** relevance to Prometheus, Xpose Market, creative work, or coding workflow.
- **Catalog novelty:** absence of a strong existing skill or resource.
- **Operational specificity:** clear inputs, steps, outputs, and verification.
- **Leverage:** likely reuse and time saved.
- **Evidence quality:** concrete workflow/result vs vague hype.
- **Maintenance cost:** reverse-scored; brittle vendor-specific ideas rank lower.

Suggested weighted score: `2×Raul fit + 2×leverage + novelty + frequency + specificity + evidence − maintenance cost`.

## Bottom line

The bookmarks argue for a tighter **goal operating system**, not a larger pile of shallow skills. Build the supervision/review/routing layer first. Improve strong existing web, X, and coding skills rather than cloning them. Then use a repeatable bookmark distiller to keep Raul's saved ideas flowing into a smaller, sharper, evidence-backed catalog.
