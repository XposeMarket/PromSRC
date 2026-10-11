# Voice canonical-chat audit

Voice native-tool parity is partial runtime parity, not one reasoning loop. Realtime currently exposes canonical native tools but owns provider audio history and executes a separate realtime tool bridge. The voice_agent personality profile also remains separate from normal interactive chat.

## Confirmed defect fixed in this PR
Voice context cache reused context across different transcripts with unchanged session/target/history for up to 30 seconds. Cache and pending-result reuse now compare exact transcript SHA-256 along with workspace, target and history length. New utterances rebuild memory and skill context. This does not make realtime invoke handleChat.

## Target architecture
Finalized speech -> canonical /api/chat admission and handleChatRequest -> authoritative chat stream -> speech output. Preserve session/client request IDs, attachments, approvals, cancellation and turn origin. Audio adapters own transcription, playback, barge-in and speech buffering, not a second prompt/tool dispatcher. Read-only/realtime audio controls may remain transport-specific.

## Deliberately not claimed done
The full migration requires validating both desktop/mobile clients, existing OpenAI API/Codex and xAI auth paths, incremental speech synthesis, cancellation and latency. Realtime native audio reasoning cannot simply be given full prompts and called the same runtime. Do not remove legacy routes or promise native realtime latency without proof. Current PR leaves voice behavior available and documents this distinct follow-up.

## Verification
npx tsx src/gateway/voice/context-cache-key.regression.ts
