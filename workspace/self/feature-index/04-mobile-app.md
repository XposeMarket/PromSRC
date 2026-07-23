# Mobile App / PWA Reference

Last source verification: 2026-07-22. Mobile entry points: `web-ui/src/mobile/`.

## Product model

Prometheus Mobile is a paired-device PWA client for the same gateway runtime. A phone obtains a device token through the pairing flow, the mobile API attaches that token to `/api/*` requests, and mobile receives live/recovery stream information from the gateway. It has a dedicated shell and hash/path router; it is not simply the desktop UI scaled down.

Mobile mode activates on `#mobile/...`, `/mobile/...`, pairing/PWA query routes, a sticky mobile flag, or a saved paired-device token. `?desktop=1` / `?mode=desktop` explicitly choose desktop behavior.

## Mobile routes and pages

| Route family | Screen and current capabilities |
|---|---|
| `mobile/pair` | Pairing claim/approval flow and device-token establishment |
| `mobile/chat[/<session>]` | Persistent chat sessions, grouped/session search drawer, attachments and uploads, streamed tool/progress/activity rendering, goal pill, approvals, cancellation/stop actions, reconciliation and recovery after interruption, source/channel context, background-spawn dock and file-change grouping |
| `mobile/voice` | Voice-first surface with dictation/PTT and realtime routing controls; voice target selection; interruption handling; visual/camera inputs where supported |
| `mobile/tasks[/<id>]` | Background task filters/list/detail, progress/status/log/evidence and lifecycle navigation |
| `mobile/hub` | Hub landing; `creative` currently aliases to this route |
| `mobile/schedule` | Scheduled job list/detail/control and schedule navigation |
| `mobile/teams[/<id>]` | Team list/detail; team chat streams and team work context |
| `mobile/subagents[/<id>]` | Subagent inventory/detail with Overview, Chat, Memory, Runs, and Heartbeat tabs; separate locked subagent-chat route for live chat |
| `mobile/proposals[/<id>]` | Proposal list/detail/review and approval workflow |
| `mobile/more[/audit\|memory]` | More landing, profile/summary, Audit, and Memory views |
| `mobile/settings` | Opens the shared desktop Settings modal in a mobile full-screen presentation; it uses the paired token rather than a duplicate settings implementation |

## Mobile Creative implementation status

The bundle contains a focused `renderCreativePage` implementation: it creates/continues a creative chat session, accepts uploads/prompts, selects image/video mode, provider/aspect/template/preset choices, calls layer extraction, and shows generated image/video gallery output. However, the current router does **not** dispatch it: `creative` is an alias for `hub`, and only the Hub renderer is routed. Treat this as an implemented-but-unexposed mobile creative surface, not as a current mobile navigation feature. The dense editor/timeline/HTML-motion authoring surface remains desktop-led.

## Voice, camera, and visual context

Mobile supports several related but distinct capabilities:

- typed chat and dictation/STT;
- a voice-agent/realtime path with target/workgroup, interruption, quiet/wake, and narration controls;
- OpenAI/xAI realtime bootstrap paths when the applicable provider credentials/configuration are available;
- camera snapshots/video-frame captures and camera-roll video attachments that can be staged into the next typed or spoken turn;
- TTS/voice delivery where browser/provider support permits.

The voice worker’s exact capability surface is indexed in [14-voice-tool-capability-index.md](14-voice-tool-capability-index.md). It intentionally offers a constrained set of browser, desktop, web, memory, timer, note, screenshot, and generation actions rather than treating all normal-worker tools as voice-safe.

Realtime visual context is sent as a conversation image payload and is aggressively downscaled for mobile/WebRTC limits. It is a conditional device/provider feature, not a universal promise of arbitrary live-video understanding.

## Pairing, remote access, and notifications

Pairing supports QR/claim, pending-device review, approval/denial, device management, certificate retrieval, and remote-access/Tailscale status/funnel operations through gateway administration. The PWA/service-worker path supports web-push subscription/status/test and clears app badges during active use. Delivery/recovery is designed to keep mobile sessions usable after a stream interruption; exact reachability remains dependent on the gateway host/network and remote-access configuration.

## Intentional parity boundaries

- Mobile reuses the gateway and core chat/agent/task/proposal data, but its layout and controls are purpose-built rather than pixel-identical to desktop.
- Settings shares the desktop modal. A focused mobile Creative renderer exists but is currently not router-exposed; dense creative editing is desktop-led.
- Browser/desktop automation tool availability is decided by the gateway/native host, not by the phone shell.
- Browser audio, permissions, iOS PWA behavior, camera/mic entitlement, push support, and realtime provider credentials determine whether voice/realtime features actually activate.

## Source anchors

`web-ui/src/mobile/mobile-router.js`, `mobile-shell.js`, `mobile-pages.js`, `mobile-api.js`, `mobile-settings.js`, `mobile-data.js`; gateway paths in `src/gateway/routes/chat.router.ts`, `pairing.router.ts`, and `voice.router.ts`; detailed operational notes in `../16-mobile-app.md` and `../24-mobile-liquid-glass.md`.

For route-by-route controls and tabs, use the [mobile page reference](mobile-pages/README.md). For the realtime Voice Agent/Worker relationship, use [16-voice-agent-and-worker.md](16-voice-agent-and-worker.md).
