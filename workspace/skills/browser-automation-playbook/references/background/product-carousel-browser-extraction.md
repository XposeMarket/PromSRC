# Product Carousel Browser Extraction — 2026-05-23

Use this note when browser automation is used to gather product/listing cards for a user-facing carousel.

## When

If the user asks to find products on a shopping site, compare purchasable items, or show products/items in a carousel, use browser extraction when web_fetch is insufficient or when live page data/images/prices are needed.

## Browser workflow

1. Open the product/search page with `browser_open(url, observe:"snapshot")` or screenshot when visual state matters.
2. Verify the page is the expected product listing and not a bot wall/captcha/modal. Close/dismiss harmless modals only when possible; stop on captcha/Robot Check.
3. Extract repeated product cards with `browser_extract_structured` or `browser_scroll_collect_v2`.
4. Collect more candidates than requested so the final carousel can be curated.
5. Use `browser_run_js` only as fallback to normalize URLs, parse review counts, or inspect card text when the structured extractor misses fields.
6. Curate 3–8 distinct products and call `show_product_carousel`.

## Suggested product fields

- title
- productUrl
- imageUrl/imagePath
- price
- rating
- reviews
- merchant
- badge/popularity signal
- short recommendation reason

## Important

`browser_extract_structured` returns data, not a visual UI. If the user asked to show items/cards/carousel, finish by calling `show_product_carousel` after curation.

Never click shopping final actions such as Add to Cart, Buy Now, Subscribe, checkout, or payment buttons unless explicitly requested and approved through final-action approval.
