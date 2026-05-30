# Example: Amazon Men’s Shampoo Carousel

User asks: “Please find me 4 different popular shampoos for men on Amazon and show them in a carousel.”

Recommended flow:

1. Use browser automation because Amazon search is interactive/JS-heavy and product cards need images/prices.
2. Open `https://www.amazon.com/s?k=popular+mens+shampoo`.
3. Extract product cards with:

```json
{
  "container_selector": "div[data-component-type='s-search-result'][data-asin]",
  "limit": 12,
  "fields": {
    "title": { "selector": "h2 span" },
    "url": { "selector": "h2 a", "type": "href" },
    "image": { "selector": "img.s-image", "type": "src" },
    "price": { "selector": "[data-cy='price-recipe'] .a-offscreen, .a-price .a-offscreen" },
    "rating": { "selector": "[aria-label*='out of 5 stars']", "type": "attr", "attribute": "aria-label" },
    "reviews": { "selector": "[aria-label*='ratings']", "type": "attr", "attribute": "aria-label" }
  }
}
```

4. If extractor misses useful data, use JS fallback to parse card text and normalize URLs.
5. Curate 4 non-identical items, e.g. budget, overall/twin-pack, natural set, scalp-care.
6. Call `show_product_carousel` with cleaned names, short descriptions, image URLs, product URLs, ratings, review counts, and tags.

Important: carousel items should be curated, not just the top four raw rows if they include duplicates or weak sponsored/noisy results.