# HTML Motion / HyperFrames frozen-frame export from wrong seek event fields

Observed: 2026-05-15 during a Prometheus HyperFrames promo export investigation.

## Failure signature

- User reports the exported MP4 is a single still/frozen frame even though source snapshots sampled at different timestamps looked animated.
- The clip has a `prometheus-html-motion-seek` listener that reads old/nonexistent fields such as `e.detail.seconds` or `e.detail.time`.
- Prometheus render/export paths dispatch seek events with `detail.timeSeconds` and `detail.timeMs`.
- If the clip falls back to `0`, every exported frame can be rendered at time 0.

## Guardrail

For authored or patched HTML Motion/HyperFrames clips, seek handlers should accept the current Prometheus event contract and robust fallbacks:

```js
window.addEventListener('prometheus-html-motion-seek', e => {
  const d = (e && e.detail) || {};
  let seconds = Number(d.timeSeconds);
  if (!Number.isFinite(seconds)) seconds = Number(d.timeMs) / 1000;
  if (!Number.isFinite(seconds)) seconds = Number(d.seconds ?? d.time);
  if (!Number.isFinite(seconds)) seconds = Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__);
  if (!Number.isFinite(seconds)) seconds = Number(window.__PROMETHEUS_HTML_MOTION_TIME_MS__) / 1000;
  seek(Number.isFinite(seconds) ? seconds : 0);
});
```

## QA implication

Do not treat source snapshots alone as export proof. Before saying an MP4 is good, verify the exported artifact has real frame-to-frame visual differences when motion is expected. Use export trace plus rendered/exported frame sampling or video frame analysis where available.

## Evidence

- `audit/chats/transcripts/76176aae-caf4-479d-98fa-5f0449808467.md:34-108`
- `memory/2026-05-15-intraday-notes.md:5-6`
- `Brain/skill-gardener/2026-05-15/live-candidates.jsonl:9`
