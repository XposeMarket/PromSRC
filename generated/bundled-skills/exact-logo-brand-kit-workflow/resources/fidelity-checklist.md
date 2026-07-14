# Exact-Logo Brand-Kit Fidelity Checklist

Use this compact checklist before delivering any exact-logo brand-kit project.

---

## Pre-Compositing QA

### Logo Asset Inspection
- [ ] Logo file located and verified as source-of-truth
- [ ] Logo file path documented (e.g., `uploads/logo.png`)
- [ ] Logo format confirmed (PNG, SVG, etc.)
- [ ] Transparency/alpha channel verified
- [ ] Logo dimensions and aspect ratio noted
- [ ] Black-on-transparent or low-contrast risk identified
- [ ] If low-contrast: visible preview created and verified

### Layout Generation
- [ ] Brand-kit layout generated with reserved logo zones
- [ ] Reserved zones clearly marked or noted (size, position)
- [ ] Layout saved with clear filename (e.g., `layout-draft.png`)
- [ ] Layout quality reviewed (colors, fonts, mockup types)

---

## Compositing QA

### Placement Accuracy
- [ ] Exact logo asset loaded (original file, not preview)
- [ ] Logo composited at all reserved zones (card, truck, sign, social, etc.)
- [ ] Logo scale appropriate for each zone (not stretched, not shrunk incorrectly)
- [ ] Logo positioning centered or aligned as intended
- [ ] Logo opacity and blending correct (fully opaque, no transparency artifacts)
- [ ] Final composite saved with clear filename

### Visual Inspection
- [ ] Logo appears on all mockups (not missing on any)
- [ ] Logo clearly visible against all backgrounds (not clipped, not overshadowed)
- [ ] Logo colors match source file exactly
- [ ] Logo proportions match source file exactly
- [ ] No hallucination or recreation of logo visible
- [ ] Logo is not distorted, rotated incorrectly, or cut off

---

## Final QA Before Delivery

### Source-vs-Output Comparison
- [ ] Source logo file open in one view
- [ ] Final composite open in adjacent view
- [ ] Logo in composite matches source file mark-for-mark
- [ ] Logo in composite matches source file colors exactly
- [ ] No variant or recreated logo detected
- [ ] No "close enough" approximations — exact match confirmed

### Mockup Quality
- [ ] Business card mockup professional and polished
- [ ] Truck decal mockup professional and polished
- [ ] Yard sign mockup professional and polished
- [ ] Social media templates professional and polished
- [ ] Overall brand-kit presentation cohesive and brand-accurate
- [ ] No layout issues, bad font rendering, or design flaws

### Documentation
- [ ] Final composite path recorded
- [ ] Source logo path recorded
- [ ] Logo preview path recorded (if created)
- [ ] Generated layout path recorded
- [ ] QA notes documented (logo fidelity: PASS, visibility: PASS, comparison: PASS)
- [ ] Confidence level assigned (High / Medium / Low)
- [ ] Any caveats noted

---

## Red Flags (STOP if any present)

If any of these are true, do NOT deliver:

- [ ] ❌ Logo missing from one or more mockups
- [ ] ❌ Logo looks different from source file (recreated, redrawn, variant)
- [ ] ❌ Logo is invisible, clipped, or overshadowed
- [ ] ❌ Logo colors do not match source file
- [ ] ❌ Logo proportions distorted or incorrect
- [ ] ❌ Mockups have inconsistent branding or unprofessional appearance
- [ ] ❌ You cannot clearly identify the original logo in the output
- [ ] ❌ Comparison reveals hallucination or wrong logo

**If any red flag is present:** Return to compositing step and use direct deterministic placement. If that fails, report the blocker to the user with specific details. Do not claim success.

---

## Delivery Checklist

- [ ] All QA items above checked and passing
- [ ] No red flags present
- [ ] Final composite ready for client
- [ ] Output paths and source provenance documented
- [ ] Confidence level High or Medium (not Low)
- [ ] Ready to deliver with confidence

---

## Quick Reference: Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Logo invisible on dark background | Use white or light background mockup; or use canvas compositing with contrast enhancement |
| Logo looks pixelated or low-res | Check original logo resolution; may need to upscale or use vector source |
| Logo colors wrong or faded | Verify source logo color space (RGB vs CMYK); use color picker to match exactly |
| Logo recreated/hallucinated | Do NOT trust image generation alone; return to step 5 and use deterministic compositing |
| Logo only appears on some mockups | Verify composite was saved for ALL mockup zones; re-composite missing zones |
| Layout quality poor | Return to layout generation step; use clearer prompt or choose different generation parameters |

---

## Success Signal

You're ready to deliver when:
- ✓ Logo appears exactly as in source file
- ✓ Logo visible on all mockups with appropriate scaling
- ✓ Mockups are polished and professional
- ✓ No hallucination or wrong-logo detected
- ✓ All QA items checked
- ✓ Confidence level is High
- ✓ Documentation complete
