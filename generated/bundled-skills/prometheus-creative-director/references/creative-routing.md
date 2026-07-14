# Creative routing matrix

| Need | Primary skill | Prometheus lane |
|---|---|---|
| Product or SaaS launch | `product-launch-video` | HyperFrames or hybrid |
| Website tour | `website-to-video` | HyperFrames capture + timeline |
| Article/topic explainer | `faceless-explainer` | Generated assets + HyperFrames + timeline |
| Interview/podcast recut | `talking-head-recut` | Native timeline + HyperFrames overlays |
| Captions | `embedded-captions` | Native captions or designed overlays |
| Beat-synced/lyric video | `music-to-video` | Audio analysis + HyperFrames + timeline |
| Kinetic type/chart/logo sting | `motion-graphics` | HyperFrames |
| Presentation/deck | `slideshow` | HyperFrames |
| GitHub change explainer | `pr-to-video` | HyperFrames + captured/code assets |
| Remotion migration | `remotion-to-hyperframes` | HyperFrames |
| Custom video without a specialist | `general-video` | Choose after inspecting assets |

## Tool-family boundaries

- `creative_project`: project, storyboard, history, export, library packs.
- `creative_scene`: canvas elements, layout, styling, masks, animation, templates.
- `creative_image_ops`: asset import, generation, analysis, extraction, image operations.
- `creative_video_ops`: generated shots, footage analysis, stitching, rough cuts, audio, overlays, compositing.
- `creative_hyperframes_ops`: catalog, insert, typed patches, lint, QA, materialize, export.
- `creative_quality_ops` and `video_*`: frame, timeline, caption, keyframe, audio, layout, and export verification.

Load only the family required for the current production stage.
