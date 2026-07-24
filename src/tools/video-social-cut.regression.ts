import assert from 'assert';
import { buildAssCaptions, buildVideoSocialCutCacheKey, buildVideoSocialCutFilter, chunkCaptionText, normalizeVideoSocialCutRequests, resolveVideoSocialCutSelection, selectTranscriptWindow, selectTranscriptWindows } from './video-social-cut.js';

export function runVideoSocialCutRegression(): void {
  const keyA = buildVideoSocialCutCacheKey('https://youtu.be/example');
  const keyB = buildVideoSocialCutCacheKey('https://youtu.be/example');
  const keyC = buildVideoSocialCutCacheKey('https://x.com/example/status/123');
  assert.equal(keyA, keyB, 'cache identity must be deterministic');
  assert.notEqual(keyA, keyC, 'different sources must not share cache identity');
  assert.match(keyA, /^[a-f0-9]{16}$/);

  assert.equal(resolveVideoSocialCutSelection('educational'), 'educational', 'required start_seconds: 0 must not override an intelligent selection mode');
  assert.equal(resolveVideoSocialCutSelection('best_hook'), 'best_hook');
  assert.equal(resolveVideoSocialCutSelection('timestamp'), 'timestamp');
  assert.equal(resolveVideoSocialCutSelection(undefined), 'best_hook');

  const captions = chunkCaptionText(
    'This is a deterministic caption test. It should create readable short cards for a vertical social clip.',
    20,
  );
  assert.ok(captions.length >= 3, 'caption chunking should create multiple readable cards');
  assert.equal(captions[0].start, 0);
  assert.equal(captions[captions.length - 1].end, 20);
  for (let index = 0; index < captions.length; index += 1) {
    assert.ok(captions[index].text.length <= 60, 'caption cards should remain bounded');
    assert.ok(captions[index].end > captions[index].start, 'caption ranges should be positive');
    if (index > 0) assert.equal(captions[index].start, captions[index - 1].end, 'caption ranges should be contiguous');
  }

  const ass = buildAssCaptions('Hello world. This is Prometheus clipping video.', 5);
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
  assert.match(ass, /Style: Caption,Arial,52/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00/);

  const transcript = [
    'Welcome back and thanks for watching.',
    'Here is the shocking truth most people miss about this system.',
    'The key takeaway is that the process works because each step verifies the previous result.',
    'I felt terrified when the first attempt failed, but the recovery was incredible!',
    'An unpopular opinion is that the common advice is wrong and overrated.',
  ].join(' ');
  assert.match(selectTranscriptWindow(transcript, 'best_hook', 100, 20).excerpt, /shocking truth/i);
  assert.match(selectTranscriptWindow(transcript, 'educational', 100, 20).excerpt, /process works because/i);
  assert.match(selectTranscriptWindow(transcript, 'emotional', 100, 20).excerpt, /terrified/i);
  assert.match(selectTranscriptWindow(transcript, 'controversial', 100, 20).excerpt, /unpopular opinion/i);
  assert.match(selectTranscriptWindow(transcript, 'key_point', 100, 20).excerpt, /key takeaway/i);


  const windows = selectTranscriptWindows(transcript, 'best_hook', 100, 20, 2);
  assert.equal(windows.length, 2, 'batch ranking should return distinct non-overlapping windows when available');
  assert.ok(windows[0].endSeconds <= windows[1].startSeconds || windows[1].endSeconds <= windows[0].startSeconds, 'ranked windows must not overlap');

  const mixed = normalizeVideoSocialCutRequests({
    source: 'clip.mp4',
    clip_requests: [
      { selection: 'best_hook', duration_seconds: 20 },
      { selection: 'educational', duration_seconds: 30 },
      { selection: 'controversial', duration_seconds: 15 },
    ],
  });
  assert.equal(mixed.length, 3);
  assert.deepEqual(mixed.map((request) => request.selection), ['best_hook', 'educational', 'controversial']);
  assert.deepEqual(mixed.map((request) => request.durationSeconds), [20, 30, 15]);

  const parts = normalizeVideoSocialCutRequests({ source: 'clip.mp4', multipart: { parts: 3, start_seconds: 40, part_duration_seconds: 20, filename_prefix: 'series' } });
  assert.deepEqual(parts.map((part) => part.startSeconds), [40, 60, 80]);
  assert.deepEqual(parts.map((part) => part.partNumber), [1, 2, 3]);
  assert.deepEqual(parts.map((part) => part.filename), ['series-part-1.mp4', 'series-part-2.mp4', 'series-part-3.mp4']);
  assert.throws(() => normalizeVideoSocialCutRequests({ source: 'clip.mp4', clip_requests: Array.from({ length: 6 }, () => ({})) }), /between 1 and 5/);
  assert.throws(() => normalizeVideoSocialCutRequests({ source: 'clip.mp4', clip_requests: [{}], multipart: { parts: 2 } }), /not both/);

  const filter = buildVideoSocialCutFilter();
  assert.match(filter, /\[fgsrc\]scale=720:-2\[fg\]/, 'foreground must span the full 720px output width');
  assert.match(filter, /overlay=0:\(H-h\)\/2/, 'full-width foreground must align to both horizontal canvas edges');
}

if (process.argv[1] && /video-social-cut\.regression\.(?:ts|js)$/i.test(process.argv[1])) {
  runVideoSocialCutRegression();
  console.log('video-social-cut regression passed');
}
