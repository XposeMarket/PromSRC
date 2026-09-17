# Runtime instructions and acceptance

`src/runtime/operating-instructions.ts` owns the shared chat/worker action, planning, skill-recovery, and progress rules. Persona and memory remain separate and are not rewritten. Thought, boot, and voice runtimes retain their dedicated contracts.

Planning has explicit scope: ordinary chat creates a visible plan on request; active Goals, proposals, and background workers retain their existing lifecycle bookkeeping. Tool policy and approval gates remain authoritative over persona and skill prose.

Prompt manifests (version 6) include `operatingInstructions` from the emitted prompt: rule ID, source, selection reason, characters, estimated tokens, hash, and duplicate flag. This metadata does not contain raw prompt text. It is an inspection aid, not a semantic proof that arbitrary user memory or third-party instructions contain no contradictions.

Run `node scripts/test-model-acceptance.mjs`. Despite the legacy filename, this is a deterministic runtime suite, not a model benchmark. It checks route isolation, thread handoff, model defaults/overrides, role-specific instructions, file bytes and hashes, Unicode, failed mutation recovery, executable code, and rejection of an invalid final-action approval. The fixture uses temporary state and no model credentials.

For a live model comparison, run the same task set in isolated chats and record actual foreground and background provider/model routes separately. Judge completion against file contents, test exit status, browser observations, and collected worker results. Record failed attempts and recovery, elapsed time, and provider-reported usage/cost; missing metrics remain unknown. Do not infer model quality, real-browser reliability, memory relevance, or sustained worker performance from these deterministic checks alone.
