---
name: "product-carousel-builder"
description: "Use when the user asks to find, compare, recommend, or display real purchasable products as product cards or a carousel. Do not use for non-shopping research or generic visual cards."
---

# Product Carousel Builder

Build a curated carousel from verified product records. Empty, decorative, or broken cards are failures even if a provider reports success.

## Workflow

1. Start with `shopping_search_products` using the user's query, optional merchant, and roughly 6–10 candidates.
2. If discovery is insufficient, use web search/fetch for readable product pages. Use browser extraction only for live shopping pages whose fields cannot be obtained through fetch.
3. Gather more candidates than needed, then remove duplicates and weak records.
4. Curate 3–8 choices around the user's constraints. Prefer useful distinctions such as best overall, budget, premium, or a requested feature—not arbitrary variety.
5. Use the carousel emitted by `shopping_search_products`, or call `show_product_carousel` for manually curated records.
6. State price/availability caveats when relevant.

## Card eligibility

Every displayed item must have:

- a concise non-empty title;
- a valid HTTP(S) product-page URL;
- a usable local `imagePath` or HTTP(S) `imageUrl`;
- at least one substantive product field: price, description, SKU/ASIN, rating, reviews, or review count.

Preserve price, rating, reviews, merchant, badge/tag, and image as structured fields. Never invent missing values. Prefer cached local images when available.

If no candidates meet the eligibility contract, return an explicit failure and explain which data is missing. Do not emit an empty carousel, text-only cards, search-result links pretending to be product pages, or `success: true` with zero usable products.

## Safety and quality

- Do not click Add to Cart, Buy Now, Subscribe, or checkout controls without an explicit user request and required approval.
- Exclude sponsored or low-confidence results when they cannot be independently identified.
- Avoid near-identical variants unless the user asks for variants.
- A good carousel answers “which should I consider, and why?” at a glance.

The product eligibility and fail-closed paths are covered by regression tests. A live provider query returned a validated product record with a real product URL and usable image; continue to fail closed when no usable cards are available.
