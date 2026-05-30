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
   - Static/general product research: `web_search` → `web_fetch` when source pages are readable.
   - Live shopping site/search results: use browser tools, especially `browser_open`, `browser_extract_structured`, `browser_scroll_collect_v2`, and screenshots when needed.
   - Amazon/product SERPs: prefer site-specific extraction selectors if a skill/resource exists, especially Browse.sh-derived product-search resources.

2. **Extract more candidates than needed**
   - If Raul asks for 4 products, collect around 8–12 candidates when practical.
   - Capture title, product URL, image URL, price, rating, review count, merchant, badges, and popularity signals such as “bought in past month.”

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
   - `imageUrl` or `imagePath`: prefer direct image URL from the page.
   - `productUrl`: direct product page URL.
   - `merchant`: store name.

5. **Display with `show_product_carousel`**
   - Call it after extraction/curation.
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
