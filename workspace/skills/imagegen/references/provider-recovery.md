# Image provider recovery and reference-path guardrails

## Unsupported partial-image streaming

Observed in live use on 2026-07-17: `media_generate` image requests routed to `provider="openai"` or `provider="xai"` may fail immediately with:

- `openai does not support partial image streaming.`
- `xai does not support partial image streaming.`

This can occur even when the caller did not explicitly request streaming, because the surrounding runtime may enable partial previews for background generation.

Recovery flow:

1. Do not loop between `presentation_mode="foreground"` and `presentation_mode="background"`; changing presentation mode alone does not disable the runtime's partial-stream request.
2. Retry the same request with `provider="openai_codex"`, which supports the non-streaming one-shot route in this environment.
3. Preserve the original prompt, dimensions, quality, reference order, and output directory so the retry changes only the provider route.
4. Inspect the completed asset with `analyze_image` before treating the recovery as successful.
5. Report the provider-routing issue as a tool reliability defect even when the fallback succeeds.

## References must be workspace-contained

The OpenAI Codex image route rejects reference images outside the workspace, including live Prometheus source paths such as `C:\...\PromSRC\web-ui\...`, with an `outside workspace` error.

Preferred flow:

1. Use the user's uploaded/reference image already under `workspace/uploads`, or another workspace-contained copy.
2. If an exact source-controlled brand asset is required, copy it into a workspace project asset/reference folder using an approved source-aware route before generation. Ordinary workspace file tools cannot read or copy from live `web-ui/` source paths.
3. Do not silently omit the only identity-defining reference unless another supplied workspace image visibly contains the same mark.
4. State each remaining reference's role in the prompt and strengthen invariants when reconstructing from a screenshot.

## Validation contract for isolated logo assets

After fallback generation, inspect for:

- only the requested mark and geometry;
- no residual source text, tagline, UI chrome, particles, background artwork, badge edge, or watermark;
- complete uncropped geometry and safe padding;
- centering and legibility at intended display size;
- actual alpha when transparency was required (do not infer alpha from PNG extension).

If a black-background asset was requested specifically to blend into a black UI, visual inspection is sufficient for composition but not for exact `#000000`; use metadata/pixel validation when exact color values matter.