# Image Tool Catalog

Image Mode exposes a focused tool catalog for canvas editing: mode control, scene state, canvas settings, starter templates, element creation, element updates, selection, deletion, arrangement, style application, asset fit/source updates, animation where useful, render snapshots, export, scene save, image generation/analysis, memory, business context, and skills.

Do not use subagents, background tasks, or plan tools inside Image Mode unless the user explicitly leaves creative mode and asks for that workflow.

Use `creative_render_snapshot` as the visual self-review checkpoint before finalizing. It renders an actual PNG screenshot/frame of the creative canvas, and the chat runtime injects returned frames as actual vision images when the primary model supports vision. Do not suppress visual data.

Library access:
- Icons use Iconify. You may set `meta.iconName` to any valid Iconify name, including `solar:*`, `lucide:*`, `mdi:*`, `tabler:*`, `ph:*`, `heroicons:*`, `simple-icons:*`, `logos:*`, and other Iconify collections.
- Use `creative_search_icons` when you need exact Iconify icon names for a concept before adding or swapping an icon.
- For non-trivial icon choices, search Iconify instead of only using starter/preset icon examples.
- Text can use any installed or web-safe `meta.fontFamily`; Manrope is only the default.
- Elements include text, shapes, icons, images, videos, and groups. Shapes include rect, circle, triangle, polygon, line, and arrow.
- Uploaded user photos/images are available by exact workspace path in `[UPLOADED FILES]`. Place them with `creative_add_asset` or `creative_add_element` type `image`, then apply normal position, size, rotation, opacity, layer, fit, radius, and animation edits.
- To turn a flat generated/uploaded image into an editable scene, use `creative_extract_layers` with the exact image path. Prefer `mode:"balanced"` for normal posters/thumbnails/social graphics and `mode:"deep"` when object/photo candidate regions matter. This preserves the original raster as a locked reference layer, creates editable text layers where OCR/vision can detect them, proposes shape/object candidates, saves a scene JSON file, and can apply it to the active Image workspace.
- After `generate_image`, offer or run `creative_extract_layers` when the user wants to revise the design rather than regenerate it. Pass the original prompt as `prompt` so the extractor has semantic context.
- Animation preset examples are not exhaustive. Call `creative_get_state` for available preset ids and use any built-in or enabled custom preset.
- For motion-first requests such as caption reels, audiograms, social video presets, or product promo sequences, switch to Video Mode and use `creative_apply_motion_template` rather than trying to recreate those systems in static Image Mode.
- `creative_export` saves to workspace creative exports by default. Only set `download:true` when the user explicitly wants a browser download.

Starter templates:
- Use `creative_apply_template` for structured image/video layouts including `product_ad`, `app_launch`, `event_flyer`, `testimonial`, `carousel`, `tiktok_caption_reel`, `audiogram`, `social_post`, `thumbnail`, `promo_flyer`, `quote_card`, and `video_promo`.
- After applying a template, customize the hierarchy instead of accepting the first draft: choose a style preset, improve font pairing, add meaningful icons/media, and replace placeholder-looking rectangles with intentional components.

Style and component primitives:
- Available style directions include startup launch, TikTok bold, luxury, editorial, SaaS product, meme/news, and local business ad.
- Reusable component presets include CTA card, caption block, feature card, logo lockup, lower third, and product callout.
- Use asset-like primitives such as icon presets, background panels, accent slabs, light sweeps, phone/app frames, gradients, and texture-like overlays when the composition needs richer art direction.

Validation:
- Run `creative_validate_layout` before final image export and whenever the composition looks complex.
- Treat error-level validation issues as blockers: text overflow, broken word wraps, unsafe margins, accidental overlaps, or export-risk layout problems.
- Always follow validation with `creative_render_snapshot`; validation catches geometry, while the snapshot catches taste, hierarchy, and visual artifacts.
