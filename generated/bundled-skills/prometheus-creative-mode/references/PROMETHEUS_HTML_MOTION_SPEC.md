# Prometheus HTML Motion Spec

This is the canonical engineering contract for Prometheus HTML Motion clips.

Prometheus owns the editor, asset library, timeline UI, HTML Motion renderer, patch/revision system, QA flow, template/block library, style system, ASCII pipeline, and export pipeline. HyperFrames is useful reference material and an optional compatibility target, not the core runtime.

## Valid Clip

A valid Prometheus HTML Motion clip is:

- a complete self-contained HTML document
- fixed-size video composition
- rendered by Prometheus through deterministic timestamp seeking
- free of external network dependencies
- safe to preview, lint, inspect, snapshot, patch, and export inside the Creative workspace

Inline CSS and inline JS are allowed. Media must be registered assets or data URLs. Absolute local paths and remote URLs are not valid final media references.

## Root Stage

Every clip must have one root stage element. The stage should be the first meaningful visual wrapper inside `body`.

```html
<main
  id="stage"
  data-composition-id="promo-main"
  data-width="1080"
  data-height="1920"
  data-duration="8000ms"
  data-frame-rate="30"
  data-start="0ms"
  data-role="stage"
  data-track-index="0"
>
  ...
</main>
```

Required root metadata:

- `data-composition-id`
- `data-width`
- `data-height`
- `data-duration`
- `data-frame-rate`

Recommended root metadata:

- `data-start="0ms"`
- `data-role="stage"`
- `data-track-index="0"`

`data-fps` may be accepted as a compatibility alias when importing older HyperFrames-style HTML, but new Prometheus-authored clips should use `data-frame-rate`.

## Timed Elements

Meaningful timed elements should declare:

- `data-start`
- `data-duration`
- `data-role`
- `data-track-index`

Use roles that describe intent, for example:

- `scene`
- `background`
- `hero-media`
- `caption`
- `lower-third`
- `cta`
- `logo`
- `chart`
- `overlay`
- `transition`
- `ascii-layer`
- `audio`

`data-track-index` is timeline metadata, not visual stacking. Use CSS `z-index` for visual layering.

## Timing Units

New Prometheus HTML must use explicit time units:

- Prefer milliseconds: `1200ms`
- Allow seconds: `1.2s`

Legacy bare numbers are currently interpreted as milliseconds inside Prometheus for backward compatibility. Lint must warn on bare values. A future strict mode may reject ambiguous bare numbers.

Timing attributes covered by this rule:

- `data-start`
- `data-duration`
- `data-end`
- `data-trim-start`
- `data-offset`
- `data-from`

## Runtime Clock

Prometheus has one official runtime clock:

```js
window.__PROMETHEUS_HTML_MOTION_TIME_MS__
window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__
window.addEventListener("prometheus-html-motion-seek", (event) => {
  const timeMs = event.detail.timeMs;
  const timeSeconds = event.detail.timeSeconds;
});
```

Adapters must derive exported frame state from this clock. `performance.now()`, `Date.now()`, autoplay loops, and wall-clock timers are allowed only as preview fallbacks, never as the source of truth for export.

## Animation Determinism

Every animation adapter should answer: how do I pause and seek this effect at frame N?

Acceptable patterns:

- CSS animations paused/overridden by Prometheus during export
- WAAPI animations driven by `animation.currentTime`
- GSAP timelines created paused and driven by `timeline.time(...)`
- Lottie animations driven by `goToAndStop(...)`
- Three.js/canvas effects redrawn from `timeMs`
- experimental HTML-in-Canvas DOM textures, feature-detected and redrawn from `timeMs`
- media elements seeked from `data-start`, `data-duration`, and `data-trim-start`

Avoid:

- unbounded `setInterval`
- async timeline construction after export begins
- infinite repeats as the only motion source
- relying on media playback instead of deterministic seeking

## Experimental HTML-in-Canvas

Prometheus may include WICG HTML-in-Canvas experiments as progressive enhancement only.

Use cases:

- draw real DOM cards/captions into canvas
- apply canvas/WebGL-style effects to DOM-designed UI
- use HTML cards as textures for 3D/product surfaces
- test future browser-native DOM-to-canvas video export flows

Rules:

- feature-detect before use: `typeof ctx.drawElementImage === "function"`
- keep a normal DOM fallback visible when unsupported
- mark blocks/adapters as experimental
- derive redraws from `prometheus-html-motion-seek`
- do not require browser flags for normal Prometheus exports
- do not treat this as a replacement for the stable HTML Motion screenshot/frame renderer yet

Recommended metadata:

```html
<canvas data-role="html-in-canvas" data-start="0ms" data-duration="4000ms" layoutsubtree>
  <article data-html-canvas-source>...</article>
</canvas>
```

## Assets

Media must use Prometheus placeholders:

```html
<img src="{{asset.logo}}" alt="">
<video src="{{asset.demo}}" muted playsinline data-start="1000ms" data-duration="4000ms" data-trim-start="9000ms"></video>
```

Rules:

- no absolute Windows paths
- no remote `http(s)` assets in final clips
- no external scripts/stylesheets
- no Google Fonts unless imported as an asset
- analyze important media before placing it
- explicitly handle important source audio

## Lint And Inspect

Lint/inspect should report:

- missing stage metadata
- invalid time values
- unsuffixed time values
- invalid timing ranges
- duplicate/overlapping same-track timing
- elements past composition duration
- missing roles or track indices on timed elements
- external scripts/assets
- absolute local paths
- media not using `{{asset.id}}`
- Pretext text overflow
- off-canvas visible text
- clipped visible text
- too many static frames/no motion delta
- important audio not preserved or muxed

## QA Gate

Before export:

1. Run lint.
2. Run text-fit checks.
3. Snapshot at early, midpoint, and near-end.
4. Inspect visible text bounds and clipping.
5. Check frame delta when motion is expected.
6. Confirm renderer/audio/QA identity in the result.

Every export/result should report:

```json
{
  "renderer": "html-motion",
  "audio": "visual-only",
  "qa": {
    "lint": "passed",
    "textFit": "passed",
    "snapshots": "passed"
  }
}
```

Allowed renderer identities:

- `native-canvas`
- `html-motion`
- `remotion-preview`
- `ascii-python`

Allowed audio identities:

- `included`
- `visual-only`
- `muxed`

## Standalone Compatibility Export

Prometheus may export a standalone compatibility folder:

```text
index.html
assets/
manifest.json
README.md
```

The goal is not to depend on HyperFrames. The goal is an HTML Motion clip that Prometheus can run and that another agent/tool can understand as HyperFrames-style deterministic HTML.
