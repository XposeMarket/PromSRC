# Provider-First Product Carousel Workflow

Use this reference when product carousel requests need fast product previews.

## Rule

Prefer normalized product data before browser scraping.

Good first sources:
- `shopping_search_products` when it is exposed in the active tool list
- dedicated shopping/product search tools if exposed in the active tool list
- connector/API results
- cached shopping index records
- structured search results with title, URL, image, price, rating, review count, merchant, and badge fields
- readable product list pages fetched with `web_fetch`

Do not call a hypothetical `product_search` or `shopping_search` tool unless that exact tool is available in the active tool list. In current Prometheus builds, the intended fast product-carousel tool is `shopping_search_products`.

## Flow

1. Query `shopping_search_products` first for shopping/product carousel requests.
2. Normalize candidates to carousel fields.
3. Curate 3-8 cards.
4. Use browser extraction only to fill missing important fields, recover images, or verify a specific product page.
5. If the fast tool already emitted a carousel, do not call `show_product_carousel` again. If products were gathered manually, call `show_product_carousel`.

## Normalized ProductResult

```json
{
  "title": "Product name",
  "price": "$38.49",
  "imageUrl": "https://example.com/image.jpg",
  "productUrl": "https://example.com/product",
  "merchant": "Amazon",
  "rating": 4.2,
  "reviewCount": 6755,
  "description": "Short reason this product belongs in the carousel.",
  "badge": "Best overall",
  "confidence": 0.91
}
```

`reviews` and `tag` are also accepted aliases for `reviewCount` and `badge`.

## Browser Fallback

Browser/page extraction is appropriate when:
- provider/search cards are missing images, prices, or product URLs
- the user asks to compare details, specs, compatibility, or reviews
- the source is JS-heavy and `web_fetch` cannot read it
- no provider-like source is available

Limit fallback extraction to the few cards or pages that need it.
