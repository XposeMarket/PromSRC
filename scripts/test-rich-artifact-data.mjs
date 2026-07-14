import assert from 'node:assert/strict';
import {
  normalizeProductArtifactItems,
  normalizeSourceArtifactItems,
} from '../dist/gateway/rich-artifacts.js';
import { extractPagePreviewMetadataFromHtml } from '../dist/tools/web.js';

const [source] = normalizeSourceArtifactItems([{
  headline: 'A source headline',
  href: 'https://news.example.com/story?id=7',
  site_name: 'Example News',
  image_url: 'https://cdn.example.com/story.webp',
  summary: 'A grounded source summary.',
  published_date: '2026-07-10T12:00:00Z',
}]);
assert.equal(source.title, 'A source headline');
assert.equal(source.url, 'https://news.example.com/story?id=7');
assert.equal(source.publisher, 'Example News');
assert.equal(source.imageUrl, 'https://cdn.example.com/story.webp');
assert.equal(source.snippet, 'A grounded source summary.');
assert.equal(source.publishedAt, '2026-07-10T12:00:00Z');

const [product] = normalizeProductArtifactItems([{
  name: 'Example Product',
  link: 'https://shop.example.com/products/sku-1',
  current_price: '$49.99',
  msrp: '$69.99',
  rating_value: '4.7 out of 5',
  review_count: '12.4K ratings',
  stock_status: 'InStock',
  sold_by: 'Example Seller',
  product_id: 'SKU-1',
  confidence: 0.91,
  thumbnail_url: 'https://cdn.example.com/product.jpg',
  store: 'Example Shop',
}]);
assert.equal(product.title, 'Example Product');
assert.equal(product.productUrl, 'https://shop.example.com/products/sku-1');
assert.equal(product.price, '$49.99');
assert.equal(product.listPrice, '$69.99');
assert.equal(product.rating, 4.7);
assert.equal(product.reviews, 12_400);
assert.equal(product.imageUrl, 'https://cdn.example.com/product.jpg');
assert.equal(product.merchant, 'Example Shop');
assert.equal(product.availability, 'InStock');
assert.equal(product.seller, 'Example Seller');
assert.equal(product.sku, 'SKU-1');
assert.equal(product.confidence, 0.91);

const html = `<!doctype html>
<html><head>
  <meta content="Fixture title" property="og:title">
  <meta content="Fixture description" name="description">
  <meta content="Fixture Publisher" property="og:site_name">
  <meta content="2026-07-10T09:30:00Z" property="article:published_time">
  <meta content="/images/hero.jpg" property="og:image">
  <link href="/canonical-story" rel="canonical">
  <link href="/icons/touch.png" rel="apple-touch-icon">
  <script type="application/ld+json">{
    "@context":"https://schema.org",
    "@type":"NewsArticle",
    "headline":"JSON-LD title",
    "image":["https://cdn.example.com/structured-hero.jpg"]
  }</script>
</head><body>
  <img class="lazy featured" data-src="/images/lazy-large.jpg" width="1200" height="800">
</body></html>`;

const preview = extractPagePreviewMetadataFromHtml(html, 'https://news.example.com/story');
assert.equal(preview.title, 'Fixture title');
assert.equal(preview.description, 'Fixture description');
assert.equal(preview.publisher, 'Fixture Publisher');
assert.equal(preview.publishedAt, '2026-07-10T09:30:00Z');
assert.equal(preview.canonicalUrl, 'https://news.example.com/canonical-story');
assert.equal(preview.imageUrl, 'https://cdn.example.com/structured-hero.jpg');
assert.equal(preview.iconUrl, 'https://news.example.com/icons/touch.png');

console.log('Rich artifact normalization and preview extraction fixtures passed.');
