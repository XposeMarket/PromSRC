# Mobile voice/media manual check

Use iOS Safari (or the production mobile WebView) with a paired gateway and a
camera-capable device. The contract tests cover the DOM/event and sequencing
guards; these checks cover browser hit-testing, camera timing, and speaker
behavior that are not deterministic in Node.

## Popover isolation

1. Open a new chat, focus the composer, and open **Connected computer** above
   the Brain Cards.
2. Tap several points in the popover title, subtitle, empty padding, and each
   computer option. The underlying Brain Card must never open or navigate.
3. Tap a computer option. The gateway chip must update and the chat must keep
   the selected target; the Brain Card must remain closed.
4. Reopen the picker, then close it with the scrim, Escape, and an outside tap.
   The popover and scrim must be gone and the next Brain Card tap must work.

## Gateway/model header

1. On desktop, confirm there is no green/red gateway status control in the
   header; Settings > General and gateway toasts must still work.
2. On mobile, confirm the model/reasoning pill remains visible and interactive
   (tap for reasoning, hold to switch model), with no green or red light and
   centered text.

## Camera turn timing

1. Open the camera from mobile voice and start an OpenAI Realtime turn. Repeat
   with xAI Realtime, using both PTT and always-listening where available.
2. With the preview still open, say “look at this,” stop, then speak a second
   short request before the normal one-second sampling tick. Both turns must
   show a different `turnId` and a current `frameId`; the second turn must not
   reuse the first turn's staged attachment. The UI should show the associated
   frame as `Live camera attached · turn N` only after association succeeds.
3. In `/api/mobile/voice-debug`, each turn should show capture/encode,
   association/upload-finished, model-request, inference-start, and
   response-finished events in that order. The request event's frame ID and
   timestamp must match that turn's association event.
4. Keep the camera open while the assistant is responding. Frames may continue
   to refresh locally, but no frame may be uploaded/associated to the response
   after `model-inference-start`; a late frame should produce a
   `realtime-agent-live-camera-frame-dropped-late` or
   `...-dropped-not-current` diagnostic and must not appear in the next turn.
5. End a turn while a frame is encoding or being summarized. A queued frame
   replaced by a newer frame should report
   `realtime-agent-live-camera-frame-dropped-backpressure` and only the
   authoritative turn-boundary frame may become visible.

## xAI playback

1. Play several 20–30 second xAI responses on Wi-Fi and cellular, including a
   response that arrives in many small audio deltas.
2. Playback should begin after a short cushion, remain continuous through a
   brief network burst/stall, and contain no repeating crackle at chunk
   boundaries. OpenAI playback should remain unchanged.
3. If the issue recurs, collect the xAI diagnostics
   `xai-realtime-playback-buffering`, `...-started`, `...-underrun`, and
   `...-backpressure-drop`, plus the reported `prebufferMs`, `underruns`, and
   `queuedMs` values.
