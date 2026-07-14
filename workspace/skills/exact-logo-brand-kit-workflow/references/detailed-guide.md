# Detailed guide

This reference preserves the full operating detail that was moved out of the concise skill entrypoint during the catalog migration. Read only the sections needed for the current task.

# Exact-Logo Brand-Kit Workflow

This skill prevents a critical client-facing failure mode: image generation hallucinating or recreating logos even when reference images are supplied. Use this workflow for client brand kits, logo boards, pitch mockups, Xpose assets, and any project where the exact logo must appear pixel-perfect.

---

## Trigger Conditions

Use this skill when:

- Client brand kits or logo boards are requested
- Mockups, pitch decks, or presentation assets need exact logo placement
- Xpose assets or sales collateral require brand identity fidelity
- User says "use this exact logo," "the real logo," or "our actual brand mark"
- Black/transparent logos or logos with unusual backgrounds are involved
- Generated brand boards need logo verification before delivery
- You've previously hallucinated or recreated a logo instead of using the actual file

---

## Hard Rule: Image Generation ≠ Exact Logo Preservation

**CRITICAL:** Never claim that `generate_image.reference_images` alone will preserve an exact client logo. Image generation is probabilistic, not pixel preservation.

- ✓ Image generation can understand visual references and create aesthetically pliant designs
- ✗ Image generation cannot guarantee that the exact logo pixels appear in the output
- ✗ Image generation may reinterpret, redraw, or hallucinate variations of logos, especially:
  - Black/transparent logos (low contrast, invisible on black backgrounds)
  - Logos with text (text gets recreated, not placed)
  - Complex marks (stylized fonts, intricate details get redrawn)

**Solution:** Use AI for design/layout. Use deterministic asset placement/compositing for exact logos.

---

## Step-by-Step Workflow

### 1. Locate and Download the Real Logo Asset

- Ask the client or find the logo file in workspace directories: `downloads/logos/`, `uploads/`, or provided URLs
- Verify the file is the actual source-of-truth logo, not a recreated version
- Document the exact path: `[LOGO_PATH]` for later reference

**Example:**
```
Source logo: downloads/logos/frederick-roof-repair-logo-footer.png
(Confirmed: circular crossed-hammers badge, black-on-transparent, 414×392px)
```

### 2. Inspect Logo Assets: Alpha, Bounds, Contrast, and Visibility Risks

- Check if the logo is transparent or opaque
- Check if it's black/dark on transparent (high visibility risk: will appear invisible on black backgrounds)
- Check dimensions and aspect ratio
- Identify if the logo is a simple mark, text-based, or complex symbol
- Note any color or transparency concerns

**QA check:** If the logo is black-on-transparent, use step 3 (visible preprocessing) before proceeding.

**Example:**
```
Logo file: uploads/frederick-roof-repair-logo-footer.png
- Type: PNG with alpha channel
- Bounds: 70, 48, 414, 392 (344×344 logical)
- Color: RGB all 0 (black), alpha 0–255 (transparent background)
- Risk: Black-on-transparent → invisible if composited directly onto dark backgrounds
  → Requires visible preprocessing or placement on light surfaces
```

### 3. Create a Visible Flattened Preview (When Needed)

If the logo is black/transparent or low-contrast, create a reference preview by compositing it onto a white, light gray, or transparent-checkerboard background. This allows both Prometheus vision and image models to see the actual logo.

**Why:** A black-on-transparent PNG looks like a "solid black rectangle" when rendered against a black background. This breaks analysis and image generation.

**Method:**
- Use a design canvas or image-composite tool to flatten the logo onto a white or light background
- Save as a preview file (e.g., `[LOGO_PATH]-preview-white.png`)
- Use the preview for reference, vision analysis, and image-generation prompts

**Example:**
```
Original: uploads/frederick-roof-repair-logo-footer.png (black-on-transparent, invisible preview)
Preview: uploads/frederick-roof-repair-logo-preview-white.png (same logo on white background, clearly visible)
→ Use preview for image model and vision analysis
→ Use original for final compositing
```

### 4. Generate Layout/Mockup with Reserved Logo Zones

- Use `generate_image` to create a brand-kit background, mockups, or presentation layout
- **Important:** Request the layout WITH BLANK/RESERVED LOGO ZONES — tell the model to leave space for the logo, don't let it fill it
- Or generate a full mockup and note where the logo will be placed (e.g., "logo area on top-left of card")
- Save the generated layout: `[LAYOUT_PATH]`

**Example prompt:**
```
"Create a polished modern brand-kit presentation with mockups for:
- Business card (leave a blank 80×80px zone top-left for logo)
- Truck decal (leave a 200×200px blank zone center)
- Yard sign (leave a 150×150px zone top-center)
- Social media templates (leave logo zones in corners)
Do NOT generate or draw logos — I will place exact logo assets."
```

### 5. Place and Composite the Exact Logo Asset onto the Board/Mockups

**Do not rely on the generated image to include the logo.** Instead, use deterministic placement:

**Option A: Canvas/Image Compositing (Most Reliable)**
- Load the generated layout (`[LAYOUT_PATH]`)
- Load the original exact-logo asset (`[LOGO_PATH]`)
- Composite the logo onto the mockups at the reserved zones (top-left, center, corner, etc.)
- Use a design tool or programmatic compositing (Canvas API, PIL, ImageMagick) to place it
- Save the final composite: `[COMPOSITE_PATH]`

**Option B: Design Board / Creative Canvas**
- Import the generated layout into a design canvas or board
- Lock/import the exact-logo asset as a layer
- Position and scale it on the mockups
- Export the final result: `[COMPOSITE_PATH]`

**Option C: Post-Process with Image Model (Secondary Polish Only)**
- If the layout needs polish or additional design tweaks, you may send the composite (with locked logo) back through image generation
- **CRITICAL:** Protect the logo zone — use an inpaint/edit mode or masked prompt to avoid regenerating the logo
- Alternatively, generate polish elements separately and composite them without touching the logo zone

**Example (Canvas approach):**
```
1. Load generated layout: generated/images/brand-kits/layout-draft.png
2. Load exact logo: uploads/frederick-roof-repair-logo-footer.png
3. Composite at positions:
   - Business card: (50, 30)
   - Truck decal: (200, 100)
   - Yard sign: (150, 50)
   - Social: top-left (20, 20) and top-right (360, 20)
4. Save final: generated/images/brand-kits/frederick-roof-repair-brand-kit-FINAL.png
```

### 6. Visually Compare Against Source and Check for Hallucination Risks

**Before reporting the result, do this QA step:**

- Open the final composite side-by-side with the original exact-logo asset
- Verify the logo appears at all mockup zones (business card, truck, sign, etc.)
- Confirm the logo matches the original file (same mark, colors, proportions)
- Check for wrong-logo errors (different logo used, recreated variant, hallucinated mark)
- Check for visibility (logo is not invisible, not clipped, not overshadowed by other elements)
- Spot-check that the rest of the brand kit (colors, fonts, layout, mockups) is polished and professional

**Red flags:**
- ✗ Logo is missing or only on some mockups
- ✗ Logo looks different from the source file (recreated, redrawn, or hallucinated variant)
- ✗ Logo is invisible, clipped, or overshadowed
- ✗ Mockups have inconsistent branding or unprofessional appearance
- ✗ You cannot identify the original logo in the output

**If any red flag is present:** Do not report the result as done. Return to step 5 and use direct compositing instead of relying on image generation. If that fails, report the blocker to the user with specific details.

### 7. Record Output Paths and Source Logo Path

Document the final deliverable and its provenance:

```
FINAL BRAND KIT: [COMPOSITE_PATH]

Source assets:
- Exact logo: [LOGO_PATH]
- Logo preview (if created): [PREVIEW_PATH]
- Generated layout: [LAYOUT_PATH]

QA notes:
- Logo fidelity: PASS / FAIL (specific details)
- Visibility: ✓ Logo clearly visible on all mockups
- Comparison: ✓ Logo matches source file exactly
- Overall: [PASS / NEEDS REVISION]

Confidence level: High / Medium / Low
Caveats: (if any)
```

---

## the client organization: Failure-to-Success Case Study

### The Problem

On 2026-05-07, the user requested a brand-kit mockup using the client organization's logo. The process revealed a critical failure mode:

1. **Initial attempts (14:31–15:06):** Generated brand kits looked polished but did NOT contain the actual Frederick logo. Instead, the image model hallucinated a different logo (a horizontal roofline mark that doesn't match the real brand identity).

2. **Root cause:** The exact logo file was supplied via `generate_image.reference_images`, but the model treated it as a visual suggestion, not a hard asset. The uploaded file `uploads/frederick-roof-repair-logo-footer.png` is a black circular badge with crossed hammers on a transparent background.

3. **Black-on-transparent trap:** When Prom analyzed the logo preview, the analyzer reported "solid black rectangle — no visible logo" because the preview was rendered against a black background. This bad analysis led to incorrect claims that the logo was present when it wasn't.

4. **False recovery (15:08):** Prom claimed the logo had been placed correctly, but re-inspection proved that was false. The generated image still showed the hallucinated roofline logo, not the actual crossed-hammers badge.

5. **Client frustration:** the user repeatedly corrected Prom, saying "that's not the fucking logo bruh" and "can you not see the fucking image?" The issue was that Prom was generating polished mockups but with the wrong logo.

### The Solution

**Correct workflow (15:08–16:18):**

1. Recognized that image generation alone cannot preserve exact logo pixels
2. Used the correct source file `uploads/pasted-screenshot-20260507-150726-2.png` (a screenshot showing the actual logo clearly visible)
3. Generated the brand-kit layout with reserved logo zones
4. **Composited the exact logo asset onto the mockups deterministically** — not relying on image generation to place it
5. Verified the output by comparing the logo in the final composite against the source screenshot
6. Delivered a final brand kit: `generated/images/brand-kits/openai_codex_2026-05-07T16-11-55-789Z_*.png`

**Result:** Client said "exactly how I wanted this… beautiful… 10/10."

### The Lesson

**Image generation is not a substitute for asset placement.**

- ✗ Sending a logo to `generate_image.reference_images` and hoping it appears exactly: failure (hallucination)
- ✓ Generating the design layout, then deterministically placing the exact logo asset: success (reliable, client-approved)

**For future brand-kit work:**
- Always use the actual logo file as a locked asset
- Avoid letting the image model recreate logos
- Preprocess black-on-transparent logos to make them visible for analysis
- Composite the exact logo into the final output
- Compare the result against the source before delivery

**Evidence:**
- Chat transcript: `audit/chats/transcripts/ff09183e-554a-43d1-82ab-1b678a4e000e.md:25–207`
- Memory notes: `memory/2026-05-07-intraday-notes.md:78–85`
- Final artifact: `generated/images/brand-kits/` (contains failed attempts and successful composite)

---

## Output Template

When delivering an exact-logo brand kit, provide this structure:

```markdown
## Brand-Kit Deliverable

**Client:** [Client Name]
**Asset:** [Description, e.g., "Modern brand-kit mockups with logo placement"]

**Final Output:**
[COMPOSITE_PATH]

**Source Assets:**
- Exact logo: [LOGO_PATH] (verified source-of-truth)
- Logo preview (if needed): [PREVIEW_PATH]
- Generated layout: [LAYOUT_PATH]

**Contents:**
- Business card with logo
- [Other mockups: truck decal, yard sign, social templates, etc.]

**QA Summary:**
- Logo fidelity: ✓ PASS — exact logo from source file placed on all mockups
- Visibility: ✓ Clear and legible on all backgrounds
- Comparison: ✓ Matches source file exactly, no hallucination or recreation
- Overall presentation: ✓ Professional, polished, client-ready

**Confidence:** High
**Confidence notes:** Logo was composited deterministically from exact asset; verified by comparison against source.

**Caveats:** None
```

---

## Anti-Patterns to Avoid

❌ **Claim exact logo use from `generate_image.reference_images` alone**
- Image generation is probabilistic; it may recreate or hallucinate variants
- Always add a deterministic compositing/placement step for exact logos

❌ **Send black-on-transparent logos directly to image models or analysis without preprocessing**
- They will appear as "solid black" and become invisible or unanalyzable
- Create a white-background preview first

❌ **Trust analyzer output on low-contrast logos without visual inspection**
- The analyzer preview may render the logo against a dark background
- Always take a fresh vision screenshot with the correct background to verify

❌ **Describe logos that aren't actually visible in the output**
- Do not hallucinate logo presence; verify by side-by-side comparison
- If the logo is missing, report the blocker instead of claiming success

❌ **Reroll image generation repeatedly hoping it includes the logo**
- Rerolling is probabilistic and inefficient
- Use deterministic compositing instead

❌ **Say "exact logo" or "verified" without doing visual comparison**
- Comparison is the QA step; it's not optional
- Even polished mockups can have wrong logos if generation hallucinated

---

## Key Takeaways

1. **Exact logos require exact placement.** Image generation + reference images is not a substitute for deterministic asset compositing.

2. **Preprocess low-contrast logos.** Black-on-transparent and other low-contrast assets need visible backgrounds before analysis or image generation.

3. **Always compare output against source.** Side-by-side visual verification is the only reliable QA for logo fidelity.

4. **Composite, don't trust generation.** The reliable pipeline is:
   - Generate design layout (with reserved logo zones)
   - Place exact logo asset (deterministically via canvas/compositing)
   - Optional: polish via image generation (protecting the logo zone)
   - Verify logo fidelity before delivery

5. **Document source provenance.** Record which exact file was the source asset so future corrections are traceable and client trust is preserved.

---

## References

- the client organization case study: `audit/chats/transcripts/ff09183e-554a-43d1-82ab-1b678a4e000e.md:25–207`
- Success path and logo preservation: `memory/2026-05-07-intraday-notes.md:78–85`
- Brand-kit assets: `generated/images/brand-kits/` (failed attempts and exact-logo composite)
- Logo source lanes: `downloads/logos/`, `uploads/`
