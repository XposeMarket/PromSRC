# Mobile Voice

Route: `#mobile/voice`. The Voice screen is the live control surface for the Voice Agent: target selection, microphone/realtime state, dictation/PTT-style interaction, speech delivery, wake/quiet settings, interruption handling, and staged camera/image/video context.

It does not own an independent full-work project. Complex requests hand off to the normal Worker in the selected chat; `voice_worker_status` and workgroup state let the voice lane report on that separate work without mutating it. Browser/desktop voice actions remain constrained and require their host session/native capability.

Read [../16-voice-agent-and-worker.md](../16-voice-agent-and-worker.md) for the detailed transport, provider, handoff, visual-input and failure model.
