# Media previews and Vita observation latency

Implemented and built in PromSRC. The installed Prometheus app and the active Vita bridge were not deployed, restarted, or modified. Device input testing stopped when the user clarified that another Prometheus thread was actively using it.

## What changed

- The active web/media capability executor now retains structured image/video artifacts. Previously it returned only serialized text, so the existing preview builder saw no paths. The old regression inspected an obsolete executor switch rather than this active path.
- Image/video observations now use direct visual context in vision-capable main-chat turns. The tool prepares the visual artifacts and the gateway adds image parts **after** the tool result and **before** model continuation. No separate vision report call is made. `response_mode="report"` retains the old analyst call. Runtimes without direct-image delivery support continue to use reports.
- The image and video previews use the existing desktop/mobile vision stream and durable history adapter. Standalone previews are larger and load eagerly. Video contact sheets remain visible; fallback individual frames use a horizontal, scrollable carousel.
- Previews refer to immutable, content-addressed copies under `downloads/media-analysis-previews`. Replacing `latest-frame.bmp` cannot silently change an older observation. Repeated pixels at different video timestamps retain their sequence labels.
- Video output records the actual selected visual inputs (up to 8 sheets or 12 fallback frames), rather than assuming every extracted frame was inspected.
- BMP screenshots are converted losslessly to PNG for model compatibility and smaller payloads. Media bytes are not embedded into SSE/history events; those contain authenticated media URLs.

Relevant implementation: `src/tools/media-analysis.ts`, `src/tools/media-analysis-visuals.ts`, `src/gateway/media-analysis-preview.ts`, `src/gateway/agents-runtime/capabilities/web-media-executor.ts`, and the main chat router.

## How this differs from the Codex workflow observed here

In this Codex session, I fetched a frame through the local HTTP bridge and loaded it through `view_image`, which returned image content to the working model and a visible preview to the user. There was no separate image-analyst completion in between.

Prometheus's previous `analyze_image` implementation made `provider.chat(...)` using the configured primary model, waited for a structured written analysis, then returned that report to the working agent. Every observation therefore added a model call before the agent could decide what to do next. It could also involve a different model from the selected thread model. Direct observation removes that intermediate report and lets the selected working model inspect the pixels in its continuation.

This is a comparison of observed tool paths, not a claim about all internal Codex implementation details or an inference-speed comparison between models. The screenshots show different models, and the Vita was concurrently in use. No controlled end-to-end model A/B benchmark was performed. Official Codex documentation also describes image inputs: https://learn.chatgpt.com/docs/codex/cli.

## Local measurements

Bridge: `127.0.0.1:8790`, Wi-Fi RGB565 frames, 480×272. Evidence is saved in `artifacts/vita-preview-benchmark.json`.

| Operation | Samples | Measured duration |
| --- | ---: | --- |
| Read buffered `/frame.bmp` | 5 | 2–7 ms, median 3 ms |
| Wait for a newer frame using sequence + long polling | 5 | 600–920 ms, median 736 ms |
| Neutral controller state, frame evidence disabled | 3 | 13–24 ms, median 13 ms |
| Neutral controller state, default evidence wait | 3 | 653–974 ms, median 730 ms |
| One requested 700 ms L-button tap | 1 | 4,041 ms; one missing UDP acknowledgment |

The five fast buffered reads returned the **same** frame, already about 2.2 seconds old. A successful HTTP request alone is not evidence of a new observation. One default-evidence request also returned without a newer frame. The Vita and bridge changed state while another thread was active, so these numbers are small diagnostic samples, not stable performance guarantees or a controlled gameplay benchmark.

The live bridge's `tap()` awaits each packet acknowledgment and then sleeps 45 ms. That means requested duration is implemented as a packet count, not a wall-clock deadline. Slow/lost acknowledgments stretch the actual action and can introduce gaps in a held button.

Saved-image preprocessing measurements are in `artifacts/media-preparation-benchmark.json`: snapshot + BMP-to-PNG conversion + constructing direct model image content took 293 ms on the cold call and 31–49 ms on four warm calls. Payload size changed from 391,734 bytes to 81,830 bytes (about 79% smaller). These measurements exclude model inference, gateway scheduling, and UI/network delivery.

## Next bridge improvements

1. Implement controller holds against a monotonic deadline. Send input refresh packets at the intended cadence independently of acknowledgment latency, then always release in `finally`; retain bounded acknowledgment tracking and explicit release failure reporting.
2. Return action acknowledgment and the exact post-action frame together from a dedicated action/observe tool. Include frame sequence, capture time, age, action duration, and transport timing. This removes shell setup and additional agent round trips.
3. Use a post-action sequence boundary and frame freshness checks instead of arbitrary multi-second sleeps. Report stale/timeout explicitly; a frame captured during an action is not necessarily evidence of its final result.
4. Instrument main-model continuation, tool execution, frame wait, image encoding, and stream delivery separately. Compare identical prompts/models/reasoning settings before attributing remaining delay to the model or scheduler.
5. For video-only visual checks, disable transcription/audio extraction explicitly. Sampling/FFmpeg and optional speech transcription still take time even though the extra visual analyst call is now removed.

These bridge changes were left as follow-up work to avoid conflicting with the active Vita thread and its newer bridge implementation outside this checkout.

## Validation and limits

- Backend TypeScript build passed.
- Preview tests execute the active capability wrapper with stubbed services, the real image/video preparation code with stubbed model/subprocess boundaries, direct-message construction, immutable snapshots, BMP conversion, explicit-report behavior, and failure paths.
- Desktop and paired-mobile URL handling, durable trace recovery, provider adapter regressions, tool activity, and mobile CSS ownership checks passed.
- Browser fixtures rendered decoded image/contact-sheet previews at desktop and phone sizes. These exercise production rendering functions/CSS, but are not a live installed-app/mobile-device test.
- The phone fallback-frame carousel loaded all images, scrolled 338 pixels within a 350-pixel viewport, and produced no page-level horizontal overflow.
- Public web assets were regenerated and synchronization checked.
- Existing historic text-only analysis events cannot recover pixels that were never retained. New artifacts persist as workspace downloads; deleting them removes those historical previews.
- The running installed app still needs a deployment of this build before these changes affect its active threads.
