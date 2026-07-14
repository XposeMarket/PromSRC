# Product Carousel Routing — 2026-05-23

When web research produces a curated set of purchasable products, product recommendations, or shopping comparison items, prefer displaying them with `show_product_carousel` after source discovery/extraction.

## When to route to carousel

Use a product carousel when the user asks to:
- find products
- recommend products
- compare shopping options
- show items/cards
- find Amazon/store products
- produce a short curated shopping list

## Research path

- For normal product articles/lists: `web_search` → `web_fetch` source pages → curate.
- For live store/search result pages, JS-heavy product grids, Amazon, or when images/prices/product URLs matter: escalate to browser tools and use `browser_extract_structured` / `browser_scroll_collect_v2`.
- If a Browse.sh/site-specific product extraction resource exists, use it as selector/schema intelligence, but execute with Prometheus-native tools unless the user explicitly asks for Browse CLI.

## Output rule

After extracting and curating 3–8 product candidates, call `show_product_carousel` with title, price, description, rating, reviews, tag, imageUrl/imagePath, productUrl, and merchant.

Final text should be brief: say the carousel is ready and mention only meaningful caveats such as volatile prices or missing review counts.
