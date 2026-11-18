# Claude Fable 5.2 / Mythos 5.2

Added to the existing Anthropic provider and desktop, mobile and agent fallback catalogs. IDs: `claude-fable-5-2`, `claude-mythos-5-2`. Existing defaults and saved selections are unchanged. Select a previous model to switch back. No migration or dependency installation.

Both support image input, tools, 1,000,000 context tokens, 128,000 output tokens and low/medium/high/xhigh/max effort (provider default high). These versions always use adaptive thinking, including automation calls with a stale think:false setting; no disabled/manual budget is emitted. Prometheus currently does not preserve signed thinking blocks, so it does not replay prefix-bound signatures; mocked continuation is covered, not proof of provider-side execution.

API price estimates per million tokens: input $8; output $40; cache read $0.20; 5-minute cache write $10. One-hour writes are $16 by the existing 2x input calculation. These are API estimates, not Claude Max subscription allowance.

## Availability and limits
Mythos 5.2 requires an organization approved through Anthropic verification programs. Catalog visibility is not entitlement. Fable API availability does not prove setup-token/Max availability. Provider access and quota errors remain visible; no silent substitution. Both models require 30-day retention unless Anthropic grants an exception. This change does not modify retention, credentials, permissions or account enrollment. No paid inference or account changes are needed for tests.

Official references verified 2026-11-09:
- https://platform.claude.com/docs/en/models/fable-5-2/migration-guide
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/about-claude/pricing

Contract test: `npx tsx src/providers/claude-52.regression.ts`.

Scope: both. Native Anthropic Messages adapter (raw HTTP; no SDK/dependency change), shared by desktop/web/mobile/channels/agents; platform-neutral. Model-provider defaults are preserved. Release through the normal PR/build gate; never infer deployment or successful model entitlement from these mocked tests.

Messages Fast mode is supported for both exact5.2 IDs by the shared backend/browser speed policy. It remains opt-in; no defaults change. Existing select relabeling marks Mythos as requiring a verified organization. UI regression `node scripts/test-claude-52-ui.mjs` mounts the actual shared agent picker at desktop/mobile widths (isolated component, not a full-app or live-account test).
