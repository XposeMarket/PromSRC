# Roblox Studio quality alignment (portable, DRAFT, not active)

Status: staged for review. This page does not change any live quality file, schedule, or role. Before any activation, re-read the live QUALITY-BAR and reconcile it with this page. A mismatch is a pre-activation stop, not a silent edit.

Current contract in portable terms. This replaces older eight-category references and the old reference-score floor, which are retired and must not be used.

## Scoring contract

- Score Q1–Q10 for the exact version under test. All applicable categories are scored; no row is skipped silently.
- Every applicable category must be at least 7. The average must be at least 8.
- Any category below 7, or an average below 8, is a FIX verdict.
- A check that was not executed is NOT TESTED, which is never a PASS. Missing analytics is UNKNOWN.
- A score belongs to one version. A new build invalidates earlier PASS results for that title until re-scored.
- A category that a genre's design does not include (for example a combat-only category in a non-combat game) is recorded as N/A with a one-line reason. The floor still applies to every applicable category.

## Categories

| # | Category | What a 10 looks like | Required evidence |
|---|---|---|---|
| Q1 | UI style | Display font, dark strokes, gradients, rarity colors, overlapping icons, round close button, as the chosen tier requires | Saved in-play capture of the UI |
| Q2 | UI motion | Every button and panel tweens; floating gain numbers; sounds on interaction | Saved play-mode capture or recording |
| Q3 | HUD | Layout matches the tier's HUD rules; abbreviated numbers; mobile-safe placement | Saved in-play capture on a mobile-sized view |
| Q4 | Character feel | Custom animation, trails or particles, camera feedback where the design includes them | Saved play-mode capture |
| Q5 | Big moments | Major reveals, zone entry, or rebirth-style moments where the design includes them | Saved play-mode capture of the moment |
| Q6 | World art | Stylized or grounded art per the chosen tier; zone palettes; density; readable silhouettes | Saved in-play capture; edit-mode shots support layout review only |
| Q7 | Lighting and post | Atmosphere, bloom or fog as the tier calls for, color correction, sky | Saved in-play capture, before and after the lighting pass |
| Q8 | Reference match | Side by side with the chosen tier's reference, does it read as the same polish level? | Paired saved capture and reference frame |
| Q9 | Trailer test | Can a 15-second cut be made from cinematic camera and title cards without restaging? | Cut list plus the footage used |
| Q10 | Lighting pass | The lighting checklist is complete and documented with before and after shots. Flat, evenly lit default scenes score 4 or less | Before and after saved captures in the build note |

## Reference tiers and mockup-first

- Designer chooses exactly one tier in the design and reference notes before any build: Tier A (juicy sim, bright pastel or dark neon with chunky outlined UI), Tier B (cinematic cozy, lighter UI, translucent dialogue, minimal HUD), or Tier C (grounded action, PBR materials, darker palette, thin modern HUD).
- A mockup or reference frame comes before the build. Forge builds to the mockup and the tier rules.
- The tier sets the UI skin only. Abbreviated numbers, floating gains, big moments, and no silent actions apply to every tier.

## Evidence rules

- Saved play-mode captures of the exact build are the evidence for runtime visuals. Edit-mode screenshots can support layout and source review. They cannot prove runtime HUD fidelity or lighting.
- Artifact screenshots and videos are a future requirement for each accepted increment. This pack does not invent or attach any screenshot.
- Functional checks to execute and record: first minute, full round, timers, mobile-safe interaction, persistence and rejoin where the owner has authorized that test, and multiplayer verification or an explicitly owner-approved scope exception.
- Each evidence record carries: version identifier, date, tester role, checks executed and not executed, and the sample size for any metric.

## Features and genre fit

Do not force simulation features into every genre. A shared kit or a rebirth, pet, or inventory system is required only when the slice needs it. Quality scores apply to what the game's design actually contains.

## Mismatch record (current, dated)

- Recorded 2026-10-24: the Build Sprint result described Forge work toward an older reference of at least 6 out of 10. That target is superseded by this page: every applicable category at least 7, average at least 8.
- This is a current contract mismatch, not evidence that a running task is stalled. Reconcile it when the live schedule is reviewed; do not infer a defect from it.
