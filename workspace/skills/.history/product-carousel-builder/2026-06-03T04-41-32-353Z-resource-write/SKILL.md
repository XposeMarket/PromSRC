# Product Carousel Builder

Use this skill when Raul asks to find products, recommend products, compare shopping options, or show items in a carousel.

## Goal

Turn normalized product data into a polished `show_product_carousel` result, not just a text list.

## When to use

Use for requests like:
- “find me 4 popular shampoos for men on Amazon and show them in a carousel”
- “show me good laptops under $800”
- “compare the best electric toothbrushes”
- “make product cards for these items”

Do not use for casual discussion or non-product research.

## Default workflow

1. **Choose the data path**
   - Fast path: use any available shopping/product search provider, connector, API, cached shopping index, or structured search result that already returns title, URL, image, price, rating, reviews, merchant, and badges.
   - General product research: `web_search` -> `web_fetch` when source pages are readable, then normalize the product objects.
   - Browser fallback: use browser tools only when provider/search results are missing important card fields, the user needs live page verification, or deeper product details are requested.
   - Amazon/product SERPs: prefer provider/search-index results first. Use site-specific selectors, especially Browse.sh-derived product-search resources, as fallback schema intelligence.

2. **Extract more candidates than needed**
   - If Raul asks for 4 products, collect around 8–12 candidates when practical.
   - Prefer already-normalized records over raw page scraping.
   - Capture title, product URL, image URL, price, rating, review count, merchant, badges, and popularity signals such as “bought in past month.”
   - Cache or reuse recent product search results when available; product cards do not need full product-page extraction.

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
   - `reviews` or `reviewCount`: integer review count when available; use 0 if unknown.
   - `tag` or `badge`: short badge like `Best budget`, `Overall Pick`, `Premium`, `Scalp care`, `Natural pick`.
   - `imageUrl` or `imagePath`: prefer direct image URL from the page.
   - `productUrl`: direct product page URL.
   - `merchant`: store name.
   - `confidence`: optional 0-1 score from a provider/search index.

5. **Display with `show_product_carousel`**
   - Call it after provider/search retrieval and curation.
   - Use a clear title like “Popular Men’s Shampoos on Amazon.”
   - Show 3–8 cards, not every extracted result.
   - Include `source` when useful, e.g. `shopping_search`, `web_search`, or `browser_extract`.

## Fast product-search architecture

For carousel previews, do not treat browser automation as the primary engine. The ideal path is:

`query -> product search provider/cache -> normalized ProductResult[] -> show_product_carousel`

A normalized product result should look like:

```json
{
  "title": "Philips Sonicare 4100 Electric Toothbrush",
  "price": "$38.49",
  "imageUrl": "https://example.com/image.jpg",
  "productUrl": "https://example.com/product",
  "merchant": "Amazon",
  "rating": 4.2,
  "reviewCount": 6755,
  "description": "Strong everyday brush with pressure sensor.",
  "badge": "Best overall",
  "confidence": 0.91
}
```

Use browser/page extraction only for:
- filling one or two missing fields after provider retrieval
- verifying a specific product page
- deeper comparison details, compatibility, specs, reviews, or price checks
- sites where no usable provider/search result exists

6. **Final response**
   - Briefly say the carousel is ready.
   - Mention any caveats only if important, e.g. prices may change, reviews unavailable, sponsored results included/excluded.

## Amazon-specific guidance

When using Amazon search results:
- Prefer a shopping/search provider, cached product index, or structured search result before opening Amazon in a browser.
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
- If provider/search cards are incomplete, browser-fetch only the few products that need missing fields. If `browser_extract_structured` misses URLs or review counts, use a small `browser_run_js` fallback to normalize links and parse card text.
- Never click Add to Cart, Buy Now, Subscribe, or checkout controls unless Raul explicitly asks and final-action approval is used.

## Quality bar

A good product carousel feels curated. It should answer “which ones should I consider and why?” at a glance.
