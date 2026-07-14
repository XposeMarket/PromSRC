# Product Carousel Image Requirement

When building a `show_product_carousel`, avoid blank cards. Each carousel item should include a real `imageUrl` or `imagePath` whenever practical.

## Default rule

For every product card, make a best-effort attempt to grab the first usable product image that appears for that item.

Acceptable sources, in order:
1. Direct image URL extracted from the product/search result card, such as `img.src`, `img.currentSrc`, OpenGraph image, or structured product image metadata.
2. First product image from the product detail page.
3. First credible image returned by a targeted web/product search for the exact product title and merchant.
4. A downloaded workspace image via `imagePath` if hotlinking is blocked or the source URL is unstable.

## Grocery / grouped-list exception

If a carousel item represents a grouped grocery category or “kit” rather than one exact SKU, still try to use the first representative image from the top relevant search result, e.g. the first Walmart image for “Great Value black beans” or “Great Value frozen mixed vegetables.”

## Quality guardrails

- Do not leave `imageUrl` blank just because ratings/reviews are unavailable.
- Prefer real product photos over logos, placeholder SVGs, tracking pixels, or generic category icons.
- If the first image is obviously broken, tiny, transparent, or unrelated, try the next visible product image.
- If no image can be found after reasonable effort, include a brief caveat in the final response.
- For 3–8 card carousels, image gathering is part of the expected workflow, not an optional polish step.

## Mobile UX reason

Blank image areas make carousel cards look unfinished, especially on the mobile app. Image extraction should be treated as a quality requirement for product carousel work.