// Regression: include_media on an X status must not open the browser thread, must
// call oEmbed at most once, must recover media from target-post metadata, and must
// report truthful thread/media statuses. Offline: fetch, browser and download
// tools are stubbed.
import assert from 'node:assert/strict';
import { executeWebFetch, xFetchDeps } from './web.js';

const STATUS = 'https://x.com/someone/status/2052552889046860081';
const ID = '2052552889046860081';

type Counts = { oembed: number; fx: number };
type Calls = { thread: number; downloadUrl: number; downloadMedia: number; analyze: number };

let fxBody: any = null; // FxTwitter response body, or null for a 404
const oembedText = 'Post body text for the exact status.';

function installFetchStub(counts: Counts): () => void {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    const href = String(input?.toString?.() || input);
    if (href.includes('publish.x.com/oembed')) {
      counts.oembed += 1;
      const html = `<blockquote><p>${oembedText}</p>&mdash; Some One (@someone) <a href="${STATUS}">May 1, 2026</a></blockquote>`;
      return new Response(JSON.stringify({ html, author_name: 'Some One', author_url: 'https://x.com/someone', url: STATUS }), { status: 200 });
    }
    if (href.includes('api.fxtwitter.com')) {
      counts.fx += 1;
      if (!fxBody) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(fxBody), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return () => { (globalThis as any).fetch = original; };
}

function installDeps(calls: Calls, opts: { threadRaw?: string; failFirstImage?: boolean } = {}): () => void {
  const original = { ...xFetchDeps };
  xFetchDeps.fetchXThread = async () => {
    calls.thread += 1;
    return opts.threadRaw ?? '{"success":false,"error":"Log in to X to see replies"}';
  };
  let imageIndex = 0;
  xFetchDeps.executeDownloadUrl = async () => {
    calls.downloadUrl += 1;
    imageIndex += 1;
    if (opts.failFirstImage && imageIndex === 1) return { success: false, error: 'network reset' };
    const name = `img${imageIndex}.jpg`;
    return { success: true, data: { rel_path: `downloads/x_fetch_media/images/${name}`, path: `/abs/${name}`, bytes: 63138 } };
  };
  xFetchDeps.executeDownloadMedia = async () => {
    calls.downloadMedia += 1;
    return { success: true, data: { files: [{ rel_path: 'downloads/x_fetch_media/video.mp4', bytes: 10892896 }] } };
  };
  xFetchDeps.executeAnalyzeImage = async () => { calls.analyze += 1; return { success: true, data: { analysis: 'a photo' } }; };
  xFetchDeps.executeAnalyzeVideo = async () => { calls.analyze += 1; return { success: true, data: { analysis: 'a clip', transcript: 'spoken' } }; };
  return () => Object.assign(xFetchDeps, original);
}

async function run(args: { include_media?: boolean; include_thread?: boolean }, deps: { threadRaw?: string; failFirstImage?: boolean } = {}) {
  const counts: Counts = { oembed: 0, fx: 0 };
  const calls: Calls = { thread: 0, downloadUrl: 0, downloadMedia: 0, analyze: 0 };
  const restoreFetch = installFetchStub(counts);
  const restoreDeps = installDeps(calls, deps);
  try {
    const result = await executeWebFetch({ url: STATUS, ...args });
    return { result, counts, calls, data: (result.data || {}) as any };
  } finally {
    restoreFetch();
    restoreDeps();
  }
}

const photoBody = { tweet: { id: ID, url: STATUS, text: 'x', media: { photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }, { url: 'https://pbs.twimg.com/media/b.jpg' }] } } };
const quoteOnlyBody = { tweet: { id: ID, url: STATUS, text: 'x', media: {}, quote: { id: '2052548349589417985', media: { photos: [{ url: 'https://pbs.twimg.com/media/quoted.jpg' }] } } } };
const mismatchBody = { tweet: { id: '999', media: { photos: [{ url: 'https://pbs.twimg.com/media/wrong.jpg' }] } } };

async function main(): Promise<void> {
  // 1. Media-only: no browser, oEmbed once, two photos via download_url, no yt-dlp.
  fxBody = photoBody;
  {
    const { result, counts, calls, data } = await run({ include_media: true });
    assert.equal(calls.thread, 0, 'media-only must not open the browser thread');
    assert.equal(counts.oembed, 1, 'oEmbed must be requested exactly once');
    assert.equal(calls.downloadUrl, 2, 'two photos -> two download_url jobs');
    assert.equal(calls.downloadMedia, 0, 'no yt-dlp fallback when photo metadata is present');
    assert.equal(data.thread_status, 'not_requested');
    assert.equal(data.media_status, 'recovered');
    assert.equal(data.x_media.detected, true, 'detected must reflect downloaded media');
    assert.equal(result.success, true);
  }

  // 2. Media-only video: one download_media job for the status URL.
  fxBody = { tweet: { id: ID, media: { videos: [{ url: 'https://video.twimg.com/x.mp4' }] } } };
  {
    const { calls, data } = await run({ include_media: true });
    assert.equal(calls.thread, 0);
    assert.equal(calls.downloadMedia, 1, 'one download_media job for the video status');
    assert.equal(calls.downloadUrl, 0);
    assert.equal(data.x_media.downloaded_files.length, 1);
  }

  // 3. No metadata (FxTwitter 404): yt-dlp status-URL fallback attempted exactly once.
  fxBody = null;
  {
    const { calls, data } = await run({ include_media: true });
    assert.equal(calls.downloadMedia, 1, 'fallback download_media attempted exactly once');
    assert.equal(data.x_media.fallback_page_download_attempted, true);
  }

  // 4. Quote-only media must NOT be attributed to the target post.
  fxBody = quoteOnlyBody;
  {
    const { calls } = await run({ include_media: true });
    assert.equal(calls.downloadUrl, 0, 'quoted post media must not be downloaded as target media');
  }

  // 5. Identity mismatch in metadata is rejected.
  fxBody = mismatchBody;
  {
    const { calls } = await run({ include_media: true });
    assert.equal(calls.downloadUrl, 0, 'metadata for a different status id must be ignored');
  }

  // 6. Partial: one of two photos fails -> media_status partial, success kept.
  fxBody = photoBody;
  {
    const { result, data } = await run({ include_media: true }, { failFirstImage: true });
    assert.equal(data.media_status, 'partial');
    assert.equal(result.success, true, 'partial media salvage keeps success');
    assert.equal(data.x_media.downloaded_files.length, 1);
  }

  // 7. Explicit thread: browser runs once; login-gated output labelled; oEmbed fallback once.
  fxBody = null;
  {
    const { counts, calls, data } = await run({ include_thread: true });
    assert.equal(calls.thread, 1, 'explicit thread keeps the browser path');
    assert.equal(counts.oembed, 1, 'oEmbed fallback requested once');
    assert.equal(data.thread_status, 'target_only');
    assert.equal(data.thread_reason, 'login_gated');
    assert.match(String(data.message), /replies were not obtained/);
  }

  // 8. Explicit thread, browser empty without login marker -> blocked_or_timeout.
  {
    const { data } = await run({ include_thread: true }, { threadRaw: '' });
    assert.equal(data.thread_reason, 'blocked_or_timeout');
  }

  // 9. Default text fetch: one oEmbed, no browser, no media.
  {
    const { counts, calls, data } = await run({});
    assert.equal(counts.oembed, 1);
    assert.equal(calls.thread, 0);
    assert.equal(data.thread_status, 'not_requested');
    assert.equal(data.x_media, undefined);
  }

  console.log('x-fetch-media-routing regression: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
