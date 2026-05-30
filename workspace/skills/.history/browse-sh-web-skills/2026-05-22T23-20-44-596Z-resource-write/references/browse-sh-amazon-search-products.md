# Browse.sh Import: amazon.com/search-products

- Source: https://browse.sh/skills/amazon.com/search-products-5170mf
- Observed: 2026-05-22
- Type: Browser / Hybrid product SERP extraction
- Task: Search Amazon for products by keyword, full search URL, ASIN list, or category-browse intent; extract structured product cards.
- Inputs: keyword or Amazon search URL, optional filters (department, brand, rating, price, Prime, delivery speed, deals, condition, seller, sort, pagination), ASIN list, category-browse intent.
- Output fields: ASIN, title, brand, image URLs, current price/currency, list price/discount, star rating, review count, Prime eligibility, sponsored/Amazon's Choice/bestseller/Climate Pledge/coupon badges, ships-from/sold-by, canonical `/dp/{ASIN}` URL, total result count.
- Useful selectors/endpoints: search URL `https://www.amazon.com/s?k={keyword}`; card root `div[data-component-type="s-search-result"][data-asin]`; title `h2 > a > span`; URL `h2 > a` normalized to `https://www.amazon.com/dp/{ASIN}`; image `img.s-image`; price `[data-cy="price-recipe"] .a-offscreen` or `.a-price .a-offscreen`; rating/reviews via `aria-label` containing `out of 5 stars` and `ratings`; badge text includes `Best Seller`, `Overall Pick`, or `Amazon's Choice`.
- Auth/captcha notes: Browse.sh notes Amazon `/s` is aggressively gated by Akamai; verified Browserbase + proxy sessions reduce bot-wall risk. In Prometheus local browser, normal visible Amazon pages may work when the user/browser session can load them. Detect captcha/Robot Check and stop rather than solving.
- Prometheus adaptation: Prefer native `browser_open` to the Amazon search URL, then visual review plus `browser_run_js`/structured DOM extraction using the selectors above. Use `browser_vision_screenshot` when the DOM snapshot is sparse or visual ranking matters. Keep it read-only unless Raul explicitly asks to cart/buy.
- Safety boundary: read-only search/extraction. Never click Add to Cart, Buy Now, Subscribe & Save, or Sign In without explicit request and final-action approval.