# Product Carousel Builder

Use this skill when Raul asks to find products, recommend products, compare shopping options, or show items in a carousel.

## Goal

Turn real product data into a polished `show_product_carousel` result, not just a text list.

## When to use

Use for requests like:
- “find me 4 popular shampoos for men on Amazon and show them in a carousel”
- “show me good laptops under $800”
- “compare the best electric toothbrushes”
- “make product cards for these items”

Do not use for casual discussion or non-product research.

## Default workflow

1. **Choose the data path**
   - First choice: call `shopping_search_products` with the user's product query, optional `merchant`, and `max_results` around 6-10. It uses the existing web search/fetch stack, fetches short page metadata, and downloads discovered product images to `downloads/product-carousel` by default. It requires no shopping API key.
   - If `shopping_search_products` returns enough useful cards, do not also crawl the browser just to rebuild the same carousel.
   - Static/general product research fallback: `web_search({ fetch_top_k: 3-5 })` when top results are likely useful, or `web_fetch_batch` on selected product/review URLs when source pages are readable.
   - Live shopping site/search results fallback: use browser tools, especially `browser_open`, `browser_extract_structured`, `browser_scroll_collect_v2`, and screenshots when fields are missing or visual verification is needed.
   - Amazon/product SERPs: only use site-specific extraction selectors when the fast product search misses important fields or the user needs page-specific verification.

2. **Extract more candidates than needed**
   - If Raul asks for 4 products, collect around 8–12 candidates when practical.
   - Capture title, product URL, downloaded image path or image URL, price, rating, review count, merchant, badges, and popularity signals such as “bought in past month.”

3. **Curate, don’t dump**
   - Pick 3–8 strong items.
   - Avoid near-duplicates unless the user specifically wants variants.
   - Prefer real popularity signals: high review count, high rating, bestseller/choice badges, recent purchase volume, strong source credibility.
   - Balance the set: budget pick, best overall, premium/natural/scalp-care/etc. when relevant.

4. **Normalize carousel fields**
   Each card should include:
   - `title`: concise human-friendly product name, cleaned from long SEO titles.
   - `price`: visible price string, or empty if unknown.
   - `description`: one short reason this item made the cut.
   - `rating`: number from 0–5 when available.
   - `reviews`: integer review count when available; use 0 if unknown.
   - `tag`: short badge like `Best budget`, `Overall Pick`, `Premium`, `Scalp care`, `Natural pick`.
   - `imagePath` or `imageUrl`: prefer `imagePath` when `shopping_search_products` supplies it because local cached images render more reliably than hotlinked store images.
   - `productUrl`: direct product page URL.
   - `merchant`: store name.

5. **Display the carousel**
   - `shopping_search_products` can emit carousel-ready cards directly; when it succeeds, a separate `show_product_carousel` call is usually unnecessary.
   - Preserve `price`, `rating`, `reviews`, `badge`/`tag`, and `imagePath` as first-class item fields; do not flatten them into description text.
   - If you gathered/curated products manually from web/browser sources, call `show_product_carousel` after extraction/curation.
   - Use a clear title like “Popular Men’s Shampoos on Amazon.”
   - Show 3–8 cards, not every extracted result.

6. **Final response**
   - Briefly say the carousel is ready.
   - Mention any caveats only if important, e.g. prices may change, reviews unavailable, sponsored results included/excluded.

## Amazon-specific guidance

When using Amazon search results:
- Search URL: `https://www.amazon.com/s?k=<query>`
- Product card root: `div[data-component-type='s-search-result'][data-asin]`
- Useful fields:
  - title: `h2 span`
  - product URL: `h2 a` or direct `/dp/{ASIN}` URL
  - image: `img.s-image`
  - price: `[data-cy='price-recipe'] .a-offscreen, .a-price .a-offscreen`
  - rating: `[aria-label*='out of 5 stars']`
  - reviews: `[aria-label*='ratings']`
  - badge/popularity text: nearby card text including `Overall Pick`, `Best Seller`, `Amazon's Choice`, `bought in past month`
- If `browser_extract_structured` misses URLs or review counts, use a small `browser_run_js` fallback to normalize links and parse card text.
- Never click Add to Cart, Buy Now, Subscribe, or checkout controls unless Raul explicitly asks and final-action approval is used.

## Quality bar

A good product carousel feels curated. It should answer “which ones should I consider and why?” at a glance.
