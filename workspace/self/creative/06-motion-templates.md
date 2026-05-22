## 6E) HTML Motion Templates

Current HTML Motion template IDs in `html-motion-templates.ts`:

- `startup-product-promo`
- `bold-tiktok-caption`
- `saas-feature-launch`
- `app-demo-card`
- `testimonial-social-proof`
- `event-or-offer-ad`
- `minimal-editorial-quote`
- `before-after-reveal`
- `step-by-step-tutorial`
- `stat-bomb-reel`
- `podcast-episode-promo`
- `recipe-card-vertical`
- `coming-soon-teaser`
- `news-headline-flash`
- `feature-comparison-vs`
- `glitch-cyber-promo`
- `square-feed-announcement`
- `youtube-intro-promo`
- `ugc-review-card`
- `ai-workflow-demo`
- `local-business-spotlight`
- `course-lesson-promo`
- `ai-design-studio-launch`
- `ascii-logo-reveal`
- `ascii-cyber-poster`
- `python-ascii-render-showcase`

Important template families:

- vertical social/product ads: `startup-product-promo`, `bold-tiktok-caption`, `saas-feature-launch`, `ai-workflow-demo`
- editorial/social proof: `testimonial-social-proof`, `minimal-editorial-quote`, `ugc-review-card`
- offer/news/comparison: `event-or-offer-ad`, `news-headline-flash`, `feature-comparison-vs`
- educational/content: `step-by-step-tutorial`, `course-lesson-promo`, `podcast-episode-promo`, `recipe-card-vertical`
- brand/launch/teaser: `coming-soon-teaser`, `glitch-cyber-promo`, `youtube-intro-promo`, `square-feed-announcement`
- product demo film: `ai-design-studio-launch`
- ASCII/source-backed motion: `ascii-logo-reveal`, `ascii-cyber-poster`, `python-ascii-render-showcase`

`ai-design-studio-launch` is the current flagship product-demo film template.
It includes:

- workspace UI
- preview canvas
- tweak/knob panel
- cursor choreography
- artifact gallery
- export-to-agent modal
- parameter knobs for `accent`, `glow`, `density`, and `speed`

ASCII template facts:

- `ascii-logo-reveal` and `ascii-cyber-poster` expect a source asset id, defaulting to `source`.
- `python-ascii-render-showcase` expects a rendered asset id, defaulting to `ascii_render`.
- ASCII template controls include glyph set, palette, reveal mode, density, glitch, bloom, and accent where relevant.
