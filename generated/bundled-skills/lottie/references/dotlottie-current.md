# Current dotLottie player in Prometheus

Use this reference only for binary `.lottie` assets with
`@lottiefiles/dotlottie-web`. Plain Lottie JSON should use `lottie-web`.

## Validated versions

- Prometheus / HyperFrames: `0.6.20`
- `@lottiefiles/dotlottie-web`: `0.77.1`

The current player exposes `setFrame()`, while HyperFrames 0.6.x recognizes
legacy `setCurrentRawFrameValue()` or `seek(percentage)` player shapes. The
player also loads WASM and the archive asynchronously. Bridge both differences;
do not start autonomous playback.

## Bundle the local runtime

Keep render-time dependencies local. Inline the WASM as a data URL because the
0.6.x validation server may not serve a copied `.wasm` with
`application/wasm`.

```js
// dotlottie-entry.js
import { DotLottie } from "@lottiefiles/dotlottie-web";
import wasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm";

DotLottie.setWasmUrl(wasmUrl);
window.DotLottie = DotLottie;
```

```powershell
esbuild dotlottie-entry.js --bundle --format=iife `
  --global-name=DotLottieBundle --loader:.wasm=dataurl `
  --outfile=assets/dotlottie.js
```

Prometheus already carries the package at the validated version. For a
standalone project that does not, install it project-locally:

```powershell
npm install --save-exact @lottiefiles/dotlottie-web@0.77.1
```

## Register a seek-safe player

```html
<canvas id="product-lottie" width="800" height="800"></canvas>
<script src="./assets/dotlottie.js"></script>
<script>
  const player = new window.DotLottie({
    canvas: document.getElementById("product-lottie"),
    src: "./assets/product-flow.lottie",
    autoplay: false,
    loop: false,
    renderConfig: { devicePixelRatio: 1 },
  });

  let pendingSeekSeconds = 0;
  const seekDotLottie = (seconds) => {
    pendingSeekSeconds = Math.max(0, Number(seconds) || 0);
    if (player.totalFrames > 0 && player.duration > 0) {
      const frame = Math.min(
        player.totalFrames - 1,
        pendingSeekSeconds / player.duration * player.totalFrames,
      );
      player.setFrame(frame);
    }
  };

  // Compatibility with the HyperFrames 0.6.x Lottie adapter after load.
  if (typeof player.setCurrentRawFrameValue !== "function") {
    Object.defineProperty(player, "setCurrentRawFrameValue", {
      configurable: true,
      value: (frame) => player.setFrame(frame),
    });
  }
  if (!("frameRate" in player)) {
    Object.defineProperty(player, "frameRate", {
      configurable: true,
      get: () => player.duration > 0
        ? player.totalFrames / player.duration
        : 30,
    });
  }

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(player);
  player.addEventListener("load", () => {
    player.pause();
    seekDotLottie(pendingSeekSeconds);
  });
</script>
```

## Capture the first asynchronous seek

The render engine can request time before the archive finishes loading. Feed
the requested composition time into `seekDotLottie`; its pending value is
replayed by the `load` handler.

For a mixed composition, drive it from the existing paused GSAP timeline:

```js
const lottieClock = { seconds: 0 };
timeline.to(lottieClock, {
  seconds: compositionDuration,
  duration: compositionDuration,
  ease: "none",
  onUpdate: () => seekDotLottie(lottieClock.seconds),
}, 0);
```

For a Lottie-only composition, the one registered timeline may be a small
synchronous seek driver instead of GSAP:

```js
const timeline = {
  _time: 0,
  _paused: true,
  duration: () => compositionDuration,
  time(value) {
    return value === undefined ? this._time : this.totalTime(value);
  },
  totalTime(value) {
    if (value === undefined) return this._time;
    this._time = Math.max(0, Math.min(compositionDuration, Number(value) || 0));
    seekDotLottie(this._time);
    return this;
  },
  seek(value) { return this.totalTime(value); },
  pause() { this._paused = true; return this; },
  play() { this._paused = false; return this; },
  paused(value) {
    if (value === undefined) return this._paused;
    this._paused = Boolean(value);
    return this;
  },
  getChildren: () => [],
};
window.__timelines[compositionId] = timeline;
```

## Proof gate

1. Run lint and browser validation through Prometheus's HyperFrames wrapper.
2. Render a disposable MP4 through the same wrapper.
3. Verify codec, dimensions, duration, and frame count with bundled FFprobe.
4. Extract at least two non-adjacent frames from the MP4 and confirm their
   pixel hashes differ and the animation remains visible.

The snapshot command can capture only the initial frame when the async player
has not completed its first seek. Treat MP4 frame sampling as the authoritative
gate for this pinned runtime.
