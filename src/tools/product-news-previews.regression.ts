// Regression: product-carousel and news-card preview images.
// Pure checks always run. Set PROMETHEUS_LIVE_NET=1 to also fetch real Amazon
// product pages (no API keys needed) and assert image + buy-box price.
import assert from 'node:assert/strict';
import {
  amazonMobileProductUrl,
  upscaleAmazonImageUrl,
  isBotWallHtml,
  extractAmazonProductFields,
  extractPagePreviewMetadataFromHtml,
  readResponseTextWithBudget,
  raceDeadline,
  fetchPagePreviewMetadata,
} from './web.js';
import { fillMissingNewsImages } from './ui-cards.js';

async function main(): Promise<void> {

// Amazon links route to the mobile product page, which Amazon serves without a captcha wall.
assert.equal(amazonMobileProductUrl('https://amazon.com/dp/B08Y1FS3YS'), 'https://www.amazon.com/gp/aw/d/B08Y1FS3YS');
assert.equal(amazonMobileProductUrl('https://us.amazon.com/dp/B0DCGML8VJ/ref=emc_bcc_2_i'), 'https://www.amazon.com/gp/aw/d/B0DCGML8VJ');
assert.equal(amazonMobileProductUrl('https://www.amazon.co.uk/Some-Thing/dp/b00bd0t49y?th=1'), 'https://www.amazon.co.uk/gp/aw/d/B00BD0T49Y');
assert.equal(amazonMobileProductUrl('https://www.amazon.com/s?k=psp+charger'), undefined, 'search pages are not products');
assert.equal(amazonMobileProductUrl('https://notamazon.com/dp/B08Y1FS3YS'), undefined, 'look-alike host');
assert.equal(amazonMobileProductUrl('https://www.bestbuy.com/site/123.p'), undefined);

// Thumbnail renditions are upscaled; sprites and bare originals are left alone.
assert.equal(upscaleAmazonImageUrl('https://m.media-amazon.com/images/I/61+hzdM4TTL._AC_SR150,150_.jpg'), 'https://m.media-amazon.com/images/I/61+hzdM4TTL._AC_SL1000_.jpg');
assert.equal(upscaleAmazonImageUrl('https://m.media-amazon.com/images/I/71oAgIRAhaL._AC_UF894,1000_QL80_.jpg'), 'https://m.media-amazon.com/images/I/71oAgIRAhaL._AC_SL1000_.jpg');
assert.equal(upscaleAmazonImageUrl('https://m.media-amazon.com/images/I/215BnscNIjL.jpg'), 'https://m.media-amazon.com/images/I/215BnscNIjL.jpg');
assert.equal(upscaleAmazonImageUrl('https://m.media-amazon.com/images/I/41kcj6xCbqL._SP100,100|41A2K26yzmL.jpg'), 'https://m.media-amazon.com/images/I/41kcj6xCbqL._SP100,100|41A2K26yzmL.jpg');
assert.equal(upscaleAmazonImageUrl('https://cdn.example.com/a._SL100_.jpg'), 'https://cdn.example.com/a._SL100_.jpg');

// Bot walls are detected (so they are never cached as "no image"); real pages are not.
const amazonCaptcha = '<html><head><title>Amazon.com</title></head><body><form action="/errors/validateCaptcha"><p>Enter the characters you see below</p></form>api-services-support@amazon.com</body></html>';
assert.equal(isBotWallHtml(amazonCaptcha), true);
assert.equal(isBotWallHtml('<html><head><title>Just a moment...</title></head><body></body></html>'), true);
const realPage = `<html><head><title>Story</title><script src="/cdn-cgi/challenge-platform/scripts/x.js"></script></head><body>${'<p>text</p>'.repeat(8000)}</body></html>`;
assert.equal(isBotWallHtml(realPage), false, 'Cloudflare injects challenge-platform into normal pages');

// Amazon fields: main image from data-a-hires, price from the buy box / twister,
// never the sponsored listing that appears first on the page.
const amazonPage = `
  <div class="sponsored"><span class="a-price"><span class="a-offscreen">$20.49</span></span></div>
  <img alt="" src="https://m.media-amazon.com/images/I/sprite._SR38,50_.jpg">
  <img id="main-image" data-a-hires="https://m.media-amazon.com/images/I/61+hzdM4TTL._AC_SR150,150_.jpg" src="x.jpg">
  <input type="hidden" id="twister-plus-price-data-price" value="7.99" />
  <div id="availability" class="a-section"><span class="a-size-medium a-color-success">  In Stock  </span></div>`;
const fields = extractAmazonProductFields(amazonPage);
assert.equal(fields.imageUrl, 'https://m.media-amazon.com/images/I/61+hzdM4TTL._AC_SL1000_.jpg');
assert.equal(fields.price, '$7.99', 'twister price, not the sponsored $20.49');
assert.equal(fields.availability, 'In Stock');
const apexPage = `<span class="a-offscreen">$99.00</span><div id="apex_mobile_feature_div"><span class="a-price"><span class="a-offscreen">$21.99</span></span></div><input id="twister-plus-price-data-price" value="17.99">`;
assert.equal(extractAmazonProductFields(apexPage).price, '$21.99', 'buy box wins over twister');

// Generic extractor also understands data-a-hires (desktop and partner pages).
const generic = extractPagePreviewMetadataFromHtml('<html><head><title>T</title></head><body><img data-a-hires="https://m.media-amazon.com/images/I/abc._AC_SX679_.jpg" width="600"></body></html>', 'https://www.amazon.com/dp/B000000000');
assert.equal(generic.imageUrl, 'https://m.media-amazon.com/images/I/abc._AC_SX679_.jpg');

// A slow body keeps what already arrived instead of throwing everything away.
{
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('<html><head><meta property="og:image" content="https://img.example.com/hero.jpg"></head>'));
      // ...then the server stalls and never finishes.
    },
  });
  const started = Date.now();
  const { text, complete } = await readResponseTextWithBudget(new Response(stream), { maxChars: 1_000_000, deadlineAt: Date.now() + 300 });
  assert.ok(Date.now() - started < 1500, 'returns at the deadline');
  assert.equal(complete, false);
  assert.ok(text.includes('og:image'), 'partial HTML preserved');
  assert.equal(extractPagePreviewMetadataFromHtml(text, 'https://example.com/a').imageUrl, 'https://img.example.com/hero.jpg');
}
{
  const { text, complete } = await readResponseTextWithBudget(new Response('<html>done</html>'), { maxChars: 1_000_000, deadlineAt: Date.now() + 2000 });
  assert.equal(complete, true);
  assert.equal(text, '<html>done</html>');
}

// raceDeadline: hung work resolves to the fallback; rejected work too.
{
  const started = Date.now();
  assert.equal(await raceDeadline(new Promise<string>(() => {}), 50, 'fallback'), 'fallback');
  assert.ok(Date.now() - started < 1000);
  assert.equal(await raceDeadline(Promise.reject(new Error('x')), 1000, 'fallback'), 'fallback');
  assert.equal(await raceDeadline(Promise.resolve('real'), 1000, 'fallback'), 'real');
}

// News: missing images are filled from the article page; existing images and
// bad lookups are left alone; a hanging publisher cannot stall the card.
{
  const items = [
    { url: 'https://news.example.com/a', title: 'A', snippet: '', imageUrl: '', publisher: '', age: '' },
    { url: 'https://news.example.com/b', title: 'B', snippet: 's', imageUrl: 'https://cdn.example.com/b.jpg', publisher: 'Ex', age: '1h' },
    { url: 'https://slow.example.com/c', title: 'C', snippet: '', imageUrl: '', publisher: '', age: '' },
    { url: 'https://news.example.com/d', title: 'D', snippet: '', imageUrl: '', publisher: '', age: '' },
  ];
  const seen: string[] = [];
  const lookup = async (url: string) => {
    seen.push(url);
    if (url.includes('slow')) return new Promise<never>(() => {});
    if (url.endsWith('/d')) return { imageUrl: 'javascript:alert(1)' };
    return { imageUrl: 'https://img.example.com/a.jpg', publisher: 'Example News', description: 'desc' };
  };
  const started = Date.now();
  const filled = await fillMissingNewsImages(items, { lookup, budgetMs: 300 });
  assert.ok(Date.now() - started < 1500, 'hanging publisher bounded by the budget');
  assert.equal(filled[0].imageUrl, 'https://img.example.com/a.jpg');
  assert.equal(filled[0].publisher, 'Example News');
  assert.equal(filled[0].snippet, 'desc');
  assert.equal(filled[1].imageUrl, 'https://cdn.example.com/b.jpg', 'existing image kept');
  assert.equal(filled[2].imageUrl, '', 'timed-out story keeps placeholder');
  assert.equal(filled[3].imageUrl, '', 'non-http image rejected');
  assert.ok(!seen.includes('https://news.example.com/b'), 'items that already have an image are not fetched');
  assert.equal(items[0].imageUrl, '', 'input array not mutated');
}

if (process.env.PROMETHEUS_LIVE_NET === '1') {
  const asins = ['B08Y1FS3YS', 'B00BD0T49Y', 'B0G8VZF2YS', 'B0042V6UWA'];
  let withImage = 0;
  for (const asin of asins) {
    const started = Date.now();
    const meta = await fetchPagePreviewMetadata(`https://amazon.com/dp/${asin}`, 2500);
    const ms = Date.now() - started;
    console.log(`  live ${asin}: ${ms}ms image=${meta.imageUrl || '-'} price=${meta.price || '-'} title=${String(meta.title || '').slice(0, 60)}`);
    assert.ok(ms < 4000, `${asin} bounded`);
    if (meta.imageUrl && /m\.media-amazon\.com\/images\/I\//.test(meta.imageUrl)) withImage += 1;
  }
  assert.ok(withImage >= asins.length - 1, `live Amazon images: ${withImage}/${asins.length}`);
}

console.log('product-news-previews regression: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
