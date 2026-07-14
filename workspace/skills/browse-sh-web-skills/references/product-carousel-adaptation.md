# Browse.sh Product Carousel Adaptation — 2026-05-23

When Browse.sh/site-specific catalog knowledge helps extract shopping or product-search results, adapt that knowledge into Prometheus-native product carousel workflows.

## Pattern

1. Search/fetch/import the relevant Browse.sh skill/resource for the store or product domain.
2. Extract or reuse selectors, inputs, output schema, endpoint hints, pagination/filter notes, and safety boundaries.
3. Execute locally with Prometheus native tools (`browser_open`, `browser_extract_structured`, `browser_scroll_collect_v2`, screenshots, and `browser_run_js` fallback when needed).
4. Normalize extracted products into carousel fields.
5. Display curated items with `show_product_carousel`.

## Carousel fields to preserve

- title
- productUrl
- imageUrl/imagePath
- price
- rating
- reviews
- merchant
- short description/reason
- tag/badge

## Amazon example

For Amazon product searches, use the existing resource `references/browse-sh-amazon-search-products.md` as selector/schema intelligence. It includes card root, title, URL, image, price, rating, review, badge, and popularity fields. After extracting candidates, curate 3–8 cards and call `show_product_carousel`.

## Safety boundary

Shopping/product carousel workflows are read-only. Do not click Add to Cart, Buy Now, Subscribe, checkout, or account actions unless the user explicitly asks and final-action approval is used.
