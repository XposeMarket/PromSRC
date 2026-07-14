# Browse.sh Import: amazon.com/search-products

- Source: https://browse.sh/skills/amazon.com/search-products-5170mf
- Observed: 2026-05-22
- Type: Browser / Hybrid product SERP extraction
- Task: Search Amazon for products by keyword, full search URL, ASIN list, or category-browse intent; extract structured product cards.
- Resource triggers proposed/used: `amazon`, `amazon product search`, `search Amazon`, `Amazon toothbrush`, `Amazon products`, `Amazon scraping`, `Amazon product extraction`, `Amazon best sellers`, `find products on Amazon`, `price/rating extraction`, `product card extraction`, `shopping search`.
- Inputs: keyword or Amazon search URL, optional filters (department, brand, rating, price, Prime, delivery speed, deals, condition, seller, sort, pagination), ASIN list, category-browse intent.
- Output fields: ASIN, title, brand, image URLs, current price/currency, list price/discount, star rating, review count, Prime eligibility, sponsored/Amazon's Choice/bestseller/Climate Pledge/coupon badges, ships-from/sold-by, canonical `/dp/{ASIN}` URL, total result count.
- Useful selectors/endpoints: search URL `https://www.amazon.com/s?k={keyword}`; card root `div[data-component-type="s-search-result"][data-asin]`; title `h2 > a > span`; URL `h2 > a` normalized to `https://www.amazon.com/dp/{ASIN}`; image `img.s-image`; price `[data-cy="price-recipe"] .a-offscreen` or `.a-price .a-offscreen`; rating/reviews via `aria-label` containing `out of 5 stars` and `ratings`; badge text includes `Best Seller`, `Overall Pick`, or `Amazon's Choice`.
- Auth/captcha notes: Browse.sh notes Amazon `/s` is aggressively gated by Akamai; verified Browserbase + proxy sessions reduce bot-wall risk. In Prometheus local browser, normal visible Amazon pages may work when the user/browser session can load them. Detect captcha/Robot Check and stop rather than solving.
- Prometheus adaptation: Treat Browse.sh instructions as selector/schema intelligence, not as the default runtime. Prefer native `browser_open` to the Amazon search URL, then `browser_vision_screenshot` or `browser_snapshot` to verify the page is not Robot Check/captcha/modal/wrong page. Prefer `browser_extract_structured` for repeated product-card JSON extraction using the schema below. Use `browser_run_js` only when custom parsing/normalization is needed or the structured extractor misses fields. Use `browser_get_page_text` only for rough human-readable text, and use raw `document.body.innerHTML` only for debugging selector/parser issues.
- Safety boundary: read-only search/extraction. Never click Add to Cart, Buy Now, Subscribe & Save, or Sign In without explicit request and final-action approval.

## Preferred Prometheus extraction schema

```json
{
  "container_selector": "div[data-component-type='s-search-result'][data-asin]",
  "limit": 20,
  "fields": {
    "title": { "selector": "h2 span", "type": "text" },
    "url": { "selector": "h2 a", "type": "href" },
    "image": { "selector": "img.s-image", "type": "src" },
    "price": { "selector": "[data-cy='price-recipe'] .a-offscreen, .a-price .a-offscreen", "type": "text" },
    "rating": { "selector": "[aria-label*='out of 5 stars']", "type": "attr", "attribute": "aria-label" },
    "reviews": { "selector": "[aria-label*='ratings']", "type": "attr", "attribute": "aria-label" }
  },
  "dedupe_key": "url",
  "save_as": "amazon product search card"
}
```
