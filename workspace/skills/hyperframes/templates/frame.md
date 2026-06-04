# frame.md — {{PROJECT_NAME}}

## Intent
{{One sentence: what the viewer should understand, feel, or do after watching.}}

## Format
- Aspect ratio / dimensions: {{1080x1920 portrait / 1920x1080 landscape / other}}
- Duration: {{seconds}}
- FPS: {{24/30/60}}
- Platform/context: {{X/TikTok/website hero/internal/demo/etc.}}

## Source references
- design.md / DESIGN.md: {{present/missing/path}}
- SCRIPT.md: {{present/missing/path}}
- STORYBOARD.md: {{present/missing/path}}
- Visual references/assets: {{paths/URLs}}

## Visual translation
- Palette roles: {{paper/ink/accent/shadow/highlight/etc.}}
- Typography scale: {{headline/subtitle/caption/labels}}
- Texture/material language: {{print grain, metal, CRT, paper, glass, UI, etc.}}
- Depth layers: {{background/midground/foreground}}
- Avoid: {{AI tells, brand conflicts, inaccessible colors, tiny text, etc.}}

## Pacing and readability
- Scene rhythm: {{example: hold-hit-hold-transition-hold}}
- Minimum dwell for important text: {{seconds}}
- Max words on screen: {{number}}
- Text safe area: {{margins}}
- Viewer eye path: {{where attention starts/moves/lands}}

## Motion vocabulary
- Entrances: {{stamp / slide / parallax / type / shutter / etc.}}
- Continuous motion: {{grain drift / subtle push / ticker / particles / none}}
- Transitions: {{cuts / wipes / burns / light leaks / etc.}}
- Exits: {{fade / smear / mechanical slide / etc.}}
- Forbidden motion tells: {{generic glow blobs, purple-blue gradients, over-rounded SaaS cards, meaningless HUDs}}

## Beat list
| Time | Beat | Viewer focus | Motion | Text |
|---:|---|---|---|---|
| 0.0-1.5 | {{Opening}} | {{Hero object/title}} | {{Motion}} | {{Text}} |
| 1.5-3.5 | {{Beat 2}} | {{Focus}} | {{Motion}} | {{Text}} |
| 3.5-6.0 | {{Beat 3}} | {{Focus}} | {{Motion}} | {{Text}} |
| 6.0-8.0 | {{End}} | {{CTA/logo}} | {{Motion}} | {{Text}} |

## Captions / audio
- Audio source: {{none/path}}
- Transcript source: {{none/path}}
- Caption style/component: {{none/component/custom}}
- Caption placement constraints: {{avoid face, lower third, etc.}}

## QA gates
- Lint: `npx hyperframes lint`
- Validate: `npx hyperframes validate` or record unavailable result
- Inspect sweep: `npx hyperframes inspect --samples 8`
- Hero-frame inspect timestamps: `npx hyperframes inspect --at {{timestamps}}`
- Render: `npx hyperframes render --output final.mp4 --fps {{fps}} --quality standard`
- Export verification timestamps: {{timestamps for final MP4 frame sampling}}
