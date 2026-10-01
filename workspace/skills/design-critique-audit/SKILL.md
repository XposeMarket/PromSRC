---
name: design-critique-audit
description: Critique or audit an existing web interface (live URL, localhost, screenshot, or HTML file) and return a scored, evidence-backed review covering hierarchy, typography, color, layout, copy, interaction states, accessibility, responsiveness, and "generated template" tells, ending in a prioritized fix list. Use when the user asks to review, critique, roast, audit, or judge the design of a page or app. Do not use for building or redesigning a UI (web-design-skill, frontend-quality-guard), for functional bug hunts (webapp-dogfood-qa), or for brand strategy (brand-strategist).
---

# Design Critique and Audit

Give a design director's review, not a vibe check. Every judgment points at something visible in a screenshot, and every problem comes with a concrete fix. Review only; do not edit code unless the user then asks for fixes, at which point hand off to `frontend-quality-guard`.

## 1. Frame the surface

1. Identify the target: URL, localhost, HTML file, or supplied screenshots. For HTML files, open them in the browser rather than judging the source.
2. Decide the surface mode from the page being reviewed (not the company):
   - **Persuade**: landing, pricing, campaign. Success = the visitor understands and acts.
   - **Operate**: app UI, dashboard, admin, settings. Success = the task gets done fast and without errors.
   - **Read**: docs, articles, help. Success = comprehension and comfortable reading.
   - **Experience**: portfolio, gallery, showcase. Success = the work leads, the interface recedes.
3. Note the brief or brand if known (`memory` search for the project, existing tokens, style guide). A stated brand direction outranks your taste.

## 2. Capture evidence in one batched pass

1. `browser_session` open the target; `browser_observe` screenshot of the first viewport and a full-page capture saved under `design-reviews/<slug>-<YYYYMMDD>/`.
2. Repeat at a narrow width (about 390px) if the browser surface allows resizing; otherwise state the gap.
3. Hover and focus a few primary controls, open one menu or dialog, and trigger one empty or error state if reachable. Screenshot each.
4. `browser_extract` console for errors and broken asset requests.
5. Optional measurements via `browser_extract` run_js when the screenshot cannot answer: computed font families and sizes, text and background colors for contrast on key text, tap target sizes. Keep this to a single probe.

Bounded passes: capture once, review, and stop. Do not loop on re-screenshots.

## 3. Score the heuristics

Score each 1 to 5 with one sentence of evidence that cites a screenshot.

| Area | What to look for |
|---|---|
| First impression and job | Does the first viewport show the actual product, subject, or task? Is the primary action obvious within five seconds? |
| Hierarchy | One clear focal point per view; secondary content visibly quieter; scanning order matches importance |
| Typography | Deliberate typeface choice, coherent scale, body line length under about 80 characters, comfortable leading, no viewport-scaled text |
| Color | Restrained palette with a reason; accent used sparingly; semantic colors consistent; contrast at least 4.5:1 for body text |
| Layout and rhythm | Consistent spacing scale, aligned edges, no cramped or orphaned regions, no card-inside-card stacking |
| Copy | Specific, concrete language; labels that say what happens; useful error messages; no filler slogans |
| Interaction states | Hover, focus, active, disabled, loading, empty, error all designed and visible |
| Accessibility | Visible focus, labelled inputs, icon buttons with names, targets roughly 44px on touch, motion that respects reduced motion |
| Responsiveness | Mobile layout is designed, not shrunk; no horizontal scroll, clipping, or overlapping elements |
| Craft and identity | Feels made for this subject rather than templated; details are consistent |

## 4. Check for generated-template tells

Flag each one seen, with the screenshot:

- Purple, blue, and cyan gradients, glow blobs, or glassmorphism used as default "tech" styling without a brand reason (Raul's standing rule: avoid this look; prefer editorial, industrial, real UI, and physical-material references).
- Every section wrapped in a rounded bordered card; cards nested in cards.
- Hero built from a giant number, small label, and a gradient accent by default.
- One word in the headline set in a different color, italic, or gradient.
- All-caps eyebrow labels above every block; decorative 01 / 02 / 03 numbering on content that is not a sequence.
- Fade-and-slide-up on every section and hover lift on every card.
- Placeholder testimonials, fake logos, vague metric tiles, slogans like "Unlock your potential".
- Default system or overused display fonts with no pairing logic; emoji used as icons.

A tell is only a defect when it fights the brief. If the brand explicitly asked for it, note it and move on.

## 5. Deliver the review

Save `design-reviews/<slug>-<date>/review.md` and reply with:

1. Verdict in two sentences: mode, overall score (average of the areas), the biggest single problem.
2. Score table (area, score, evidence).
3. Top fixes, at most 8, ordered by impact on the surface's mode. Each fix: what is wrong, why it matters for this user, the concrete change (for example "drop body text from #9AA0A6 to #4A4F55 on #FFFFFF to reach 7:1", "replace the three feature cards with a single annotated product screenshot").
4. What is working and must be preserved.
5. 2 to 4 embedded screenshots, for example `![Mobile nav overlaps the logo](design-reviews/acme-20260930/mobile-top.png)`.
6. Gaps: viewports, states, or pages not reviewed.

Use `show_ui_card` with type `comparison` for the score table when it helps scanning.

## Guardrails

- Evidence first: no score without a screenshot or measurement behind it.
- Honor the brief. Redirecting a clear brand direction toward your taste is a failure of the review.
- Separate taste from defects: label each fix as "defect" (contrast, overflow, broken state) or "direction" (stylistic suggestion).
- Do not rewrite factual copy or invent claims in suggested copy.
- Close the browser session Prometheus opened.

## Exit criteria

- All ten areas scored with cited evidence, or marked "not assessable" with the reason.
- Fix list is prioritized, concrete, and tagged defect or direction.
- Review file saved, screenshots embedded, browser closed.

Lineage: inspired by pbakaus impeccable (surface modes, critique and audit commands, bounded verification passes) and anthropics frontend-design (subject-grounded identity, generated-design tells); rewritten as a Prometheus review procedure.
