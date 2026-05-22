## 6G) Remotion Motion Templates

Remotion integration source:

- `src/remotion/Root.tsx`
- `src/remotion/index.tsx`
- `src/remotion/runtime/templateRegistry.ts`
- `src/remotion/runtime/resolveTemplateInput.ts`
- `src/remotion/runtime/socialPresets.ts`
- `src/remotion/templates/CaptionReel/CaptionReel.tsx`
- `src/remotion/templates/CaptionReelV2/CaptionReelV2.tsx`
- `src/remotion/templates/ProductPromo/ProductPromo.tsx`
- `src/remotion/templates/AudioVisualizer/AudioVisualizer.tsx`
- `src/gateway/creative/motion-runtime.ts`

Remotion template tools include:

- `creative_list_motion_templates`
- `creative_preview_motion_template`
- `creative_apply_motion_template`
- `creative_generate_motion_variants`

Current Remotion templates:

- `caption-reel-v2`
  - composition: `CaptionReelV2`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`
  - presets: `bold-tiktok-v2`, `startup-launch-v2`, `editorial-v2`, `professional-v2`
- `caption-reel`
  - composition: `CaptionReel`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`
  - presets: `clean-creator`, `bold-tiktok`, `minimal-linkedin`
- `audio-visualizer`
  - composition: `AudioVisualizer`
  - default duration: `30000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`, `youtube`
  - presets: `podcast-audiogram`, `music-pulse`
- `product-promo`
  - composition: `ProductPromo`
  - default duration: `15000ms`
  - formats: `reel`, `short`, `story`, `square`, `feed45`, `youtube`
  - presets: `saas-launch`, `feature-drop`

Current Remotion/social formats:

- `reel`: 1080x1920
- `short`: 1080x1920
- `story`: 1080x1920
- `square`: 1080x1080
- `feed45`: 1080x1350
- `youtube`: 1920x1080

Known Remotion/template caveats:

- Do not stack multiple caption-reel template instances unless the user explicitly wants multiple template layers.
- If a stronger revision is needed after export, prefer a fresh rebuild over repeatedly reapplying templates onto an edited/corrupted scene.
- Prior bugs included ghost/stale caption layers, static middle/end frames, and bland/basic generated frames; use frame QA aggressively.
- For polished social/product promos, HTML Motion is currently often more reliable and higher-fidelity than primitive canvas layers or underdeveloped Remotion templates.
