// Regression: X oEmbed / syndication clip long-form ("note") posts at ~280 chars with a
// trailing ellipsis, often followed by a t.co / pic.twitter.com link. web_fetch must detect
// that, recover the full text via FxTwitter, and otherwise flag the preview as incomplete.
// Offline: global fetch is stubbed; no live network.
import assert from 'node:assert/strict';
import { executeWebFetch, isLikelyTruncatedXText } from './web.js';

const STATUS = 'https://x.com/wespreadjam/status/2117333079106932897';
const ID = '2117333079106932897';
const BODY = 'Before you launch anything, have Opus 5.5 send 5 subagents in as your first users. Paste this into Claude Code: "Act as my launch QA lead. Spin up 5 subagents, each a different first-time user: 1. The impatient one: skims, clicks the first button, quits at the first error 2. The skeptic ->';
const FULL_TEXT = `${BODY} reads every word of the pricing page.\n\n${'More detail about the long post. '.repeat(55)}`.trim();

// --- Fixtures (shapes captured from the real endpoints on 2026-11-05) ---
const oembedTruncated = {
  url: STATUS,
  author_name: 'jam',
  author_url: 'https://twitter.com/wespreadjam',
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${BODY}\u2026 <a href="https://t.co/M5JuJfeNef">pic.twitter.com/M5JuJfeNef</a></p>&mdash; jam (@wespreadjam) <a href="${STATUS}">November 4, 2026</a></blockquote>`,
};
const syndicationNoteTweet = {
  id_str: ID,
  text: `${BODY}\u2026 https://t.co/M5JuJfeNef`,
  display_text_range: [0, 282],
  note_tweet: { id: 'Tm90ZVR3ZWV0UmVzdWx0czoyMTE3MzMzMDc4OTA1NTg1NjY0' },
};
const fxFull = {
  code: 200,
  tweet: {
    id: ID,
    url: STATUS,
    text: FULL_TEXT,
    raw_text: { text: FULL_TEXT, display_text_range: [0, FULL_TEXT.length] },
    is_note_tweet: true,
    author: { name: 'jam', screen_name: 'wespreadjam' },
    likes: 120, retweets: 9, replies: 4,
    created_at: 'Wed Nov 04 18:00:00 +0000 2026', created_timestamp: 1793815200,
  },
};

// --- Detector ---
assert.equal(isLikelyTruncatedXText(`${BODY}\u2026`), true, 'clip at end must be flagged');
assert.equal(isLikelyTruncatedXText(`${BODY}...`), true, 'ascii ellipsis clip must be flagged');
assert.equal(isLikelyTruncatedXText(`${BODY}\u2026 pic.twitter.com/M5JuJfeNef`), true, 'oEmbed clip followed by pic link must be flagged (the 2026-11-05 miss)');
assert.equal(isLikelyTruncatedXText(syndicationNoteTweet.text), true, 'syndication note_tweet text (ellipsis + t.co) must be flagged');
assert.equal(isLikelyTruncatedXText('Short post ending in thought\u2026 pic.twitter.com/abc'), false, 'short posts with ellipsis are intentional');
assert.equal(isLikelyTruncatedXText(`${'x'.repeat(270)}. pic.twitter.com/abc`), false, 'full-length post with media link and no ellipsis is complete');
assert.equal(isLikelyTruncatedXText(`${'x'.repeat(250)}\u2026 and then the thought continues normally.`), false, 'mid-text ellipsis is not a clip');
assert.equal(isLikelyTruncatedXText(''), false);

// --- End-to-end through executeWebFetch with stubbed endpoints ---
let fxMode: 'full' | 'down' = 'full';
let oembedBody: any = oembedTruncated;
const seen: string[] = [];
const original = globalThis.fetch;
(globalThis as any).fetch = async (input: any) => {
  const href = String(input?.toString?.() || input);
  seen.push(href);
  if (href.includes('publish.x.com/oembed')) return new Response(JSON.stringify(oembedBody), { status: 200 });
  if (href.includes('api.fxtwitter.com')) {
    return fxMode === 'full' ? new Response(JSON.stringify(fxFull), { status: 200 }) : new Response('{}', { status: 503 });
  }
  return new Response('{}', { status: 404 });
};

async function main(): Promise<void> {
try {
  // 1. Long post recovered via FxTwitter: full text, complete, sourced.
  {
    fxMode = 'full'; oembedBody = oembedTruncated; seen.length = 0;
    const result = await executeWebFetch({ url: STATUS });
    const data: any = result.data || {};
    const tweet = data.tweets?.[0];
    assert.equal(tweet?.text, FULL_TEXT, 'full long-post text must replace the preview');
    assert.equal(tweet.text_complete, true);
    assert.equal(tweet.text_source, 'fxtwitter');
    assert.equal(tweet.long_post, true);
    assert.equal(data.truncated, undefined, 'recovered post is not truncated');
    const out = JSON.parse(String(result.stdout || '{}'));
    assert.equal(out.truncated, false);
    assert.ok(seen.some(h => h.includes('api.fxtwitter.com/wespreadjam/status/' + ID)), 'FxTwitter must be queried');
  }

  // 2. All fallbacks fail: never report truncated:false; flag the preview loudly.
  {
    fxMode = 'down'; oembedBody = oembedTruncated;
    const result = await executeWebFetch({ url: STATUS });
    const data: any = result.data || {};
    const out = JSON.parse(String(result.stdout || '{}'));
    for (const view of [data, out]) {
      assert.equal(view.truncated, true, 'preview must be reported truncated');
      assert.equal(view.text_complete, false);
      assert.equal(view.long_post, true);
      assert.equal(view.tweets?.[0]?.text_complete, false, 'per-tweet flag must be present');
      assert.equal(view.tweets?.[0]?.text_source, 'oembed_preview');
    }
    assert.match(String(out.message), /INCOMPLETE/);
    assert.match(String(out.message), /browser/i, 'message must tell the model how to get the rest');
    assert.ok(Object.keys(out).indexOf('text_complete') < 5, 'text_complete sits in the stdout status head');
  }

  // 3. Ordinary short post: no long-post flags, no FxTwitter call.
  {
    fxMode = 'full'; seen.length = 0;
    oembedBody = { ...oembedTruncated, html: `<blockquote><p>Just a normal post <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; jam (@wespreadjam) <a href="${STATUS}">November 4, 2026</a></blockquote>` };
    const result = await executeWebFetch({ url: STATUS });
    const data: any = result.data || {};
    assert.equal(data.tweets?.[0]?.text_complete, undefined);
    assert.equal(data.text_complete, undefined);
    assert.equal(JSON.parse(String(result.stdout || '{}')).truncated, false);
    assert.equal(seen.some(h => h.includes('api.fxtwitter.com')), false, 'no fallback for complete posts');
  }
} finally {
  (globalThis as any).fetch = original;
}
}
main().then(() => console.log('x-oembed-truncation regression: PASS')).catch((error) => { console.error(error); process.exit(1); });
