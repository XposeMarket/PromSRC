# Example: Amazon keyboard carousel — 2026-06-02

User asked: “pls use the product carousel and show me - keyboards on amazon pls”.

## Recommended tool flow

1. Read `product-carousel-builder`.
2. Start with provider/web search for `keyboards on Amazon` or the user's exact query.
3. If provider/search results are incomplete, activate browser automation and open Amazon search, e.g. `https://www.amazon.com/s?k=keyboards`.
4. Use page text and a small browser JS extractor to normalize visible Amazon card data.
5. Curate 3–8 differentiated cards: budget, wireless, mechanical, productivity, ergonomic, compact/travel, etc.
6. Confirm every rendered card has either `imageUrl` or `imagePath`; if a card lacks an image, make one more extraction attempt or replace that candidate with a better sourced item.
7. Call `show_product_carousel` with cleaned title, price, productUrl, merchant, imageUrl/imagePath, short description, rating/review count when available, and a badge.
8. Final response should be short: state the carousel is ready and note that prices/stock can shift.

## JS extraction sketch for Amazon cards

```js
Array.from(document.querySelectorAll("div[data-component-type='s-search-result'][data-asin]")).slice(0, 12).map(card => {
  const title = card.querySelector('h2 span')?.textContent?.trim() || '';
  const href = card.querySelector('h2 a')?.getAttribute('href') || '';
  const img = card.querySelector('img.s-image');
  const imageUrl = img?.currentSrc || img?.src || '';
  const price = card.querySelector("[data-cy='price-recipe'] .a-offscreen, .a-price .a-offscreen")?.textContent?.trim() || '';
  const ratingText = card.querySelector("[aria-label*='out of 5 stars']")?.getAttribute('aria-label') || '';
  const reviewsText = card.querySelector("[aria-label*='ratings']")?.getAttribute('aria-label') || '';
  return {
    title,
    productUrl: href ? new URL(href, location.origin).href : '',
    imageUrl,
    price,
    ratingText,
    reviewsText,
    merchant: 'Amazon'
  };
}).filter(item => item.title && item.productUrl);
```

## Quality notes

- Do not over-trust top sponsored rows if they are near-duplicates.
- For mobile UX, a card with blank image space is not done unless every reasonable extraction path failed and the final response says so.
- Prefer replacing weak/no-image candidates over rendering a polished-looking but visually blank carousel.