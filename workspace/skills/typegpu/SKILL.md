---
name: "typegpu"
description: "TypeGPU and raw WebGPU adapter patterns for deterministic HyperFrames compositions. Use only when a HyperFrames canvas layer uses TypeGPU, navigator.gpu, WGSL, compute/render pipelines, or GPU-driven effects."
---

# TypeGPU / WebGPU for HyperFrames

Use this specialist skill after HyperFrames routing. The adapter publishes composition time; your code still owns device setup, pipelines, buffers, textures, submission, and fallbacks.

## Deterministic contract

1. Register any GSAP/HTML timelines synchronously before the first `await`.
2. Initialize WebGPU asynchronously and fail visibly when `navigator.gpu` or an adapter is unavailable.
3. Render from `window.__hfTypegpuTime` or the `hf-seek` event’s exact time—not `performance.now()` or a free-running loop.
4. Use seeded randomness and fixed canvas dimensions.
5. Submit exactly the state for the requested frame, then await `device.queue.onSubmittedWorkDone()` before capture.
6. Choose `opaque` for a full-frame GPU layer or `premultiplied` for transparent overlays.
7. Treat video texture upload in headless Chrome as capability-dependent; pre-extract image frames when reliable external-video copying is unavailable.
8. Provide a non-WebGPU fallback or a clear fail-closed result for unsupported render environments.

```js
window.addEventListener("hf-seek", async (event) => {
  render(event.detail.time);
  await device.queue.onSubmittedWorkDone();
});
```

Read [the detailed guide](references/detailed-guide.md) for full-screen triangles, uniforms, video textures, downsampled blur, alpha modes, SDF shapes, and timeline registration.

Validate with representative seeks, repeat-frame hash checks, snapshots, and a probed final export.
