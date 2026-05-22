# Tool Category Activation vs Smoke Test — 2026-05-10

## Evidence
- Workflow episode `sg_cbfb752ca43e5c68` and skill episode 1 captured a request to “Test out all of these please” for team/memory/MCP/composite/web/media tools.
- The assistant only activated tool categories and replied with activation confirmations.
- In transcript `audit/chats/transcripts/38922285-b0b7-4e90-947a-978d62ef6972.md:101-129`, Raul then said “Test em to confirm” and the assistant returned “Hey! How can I help?” twice.

## Rule
When Raul says “test”, “confirm”, “smoke test”, “make sure these work”, or “test em to confirm,” category activation is not enough.

## Correct workflow
1. Activate any missing tool categories required to expose the requested tools.
2. Build a small safe test matrix grouped by tool family.
3. For each tool, run the least-destructive availability/contract check possible.
   - Use list/status/detail/preview/dry-run calls when available.
   - Do not use destructive args or external side effects.
   - For system-use-only tools, do not call them; report the contract and the safe substitute used.
4. Record caveats precisely, especially contract quirks and blocked scopes.
5. Report “confirmed working,” “available but not manually callable,” “blocked,” or “not found” per tool/family.

## Anti-pattern
Do not answer with only “Tool category X activated” when the user asked to test or confirm tools. That only proves schema exposure, not operational health.