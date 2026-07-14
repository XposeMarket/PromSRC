# Connector-first smoke tests — 2026-05-11

Use this note when the user asks to “test,” “try,” or validate a newly connected external service/tool.

## Evidence

On 2026-05-11 the user asked Prometheus to test newly connected Stripe tools. The successful path was connector-first:

1. `connector_list`
2. Run each available safe/read action for the connector (`connector_stripe_get_balance`, `connector_stripe_list_customers`, `connector_stripe_list_charges`, `connector_stripe_list_products`)
3. Report which actions worked and which requested capability is missing.

When the user then said “great try out vercel now please,” Prometheus checked connectors but fell back to Vercel CLI and reported unauthenticated CLI state. the user corrected: “use the connector tools, not run commands.” The corrected answer was: no Vercel connector is present, so Vercel cannot be tested via connector tools right now; do not use shell/CLI when the point of the test is connector capability.

Evidence: `audit/chats/transcripts/5e4fa96c-eacf-4f4e-8834-162e8618a6b7.md:1-90`; `Brain/skill-gardener/2026-05-11/live-candidates.jsonl:4-6`.

## Guardrail

For named external platform validation:

- Start with connector discovery/status, not shell or CLI.
- If a connector exists and is connected, test only safe actions by default unless the user explicitly approves writes.
- If a connector does not exist, say that directly and name the closest available path. Do not silently substitute CLI just because a binary is installed.
- Separate three states clearly:
  - connected + action works
  - connected but requested action is missing
  - no connector / not authenticated
- For payment, publish, deploy, send, delete, or other write actions, use approval-gated flows rather than smoke-testing live mutations.

## Output shape

```text
Connector tested: <service>
Available connector tools: <list>
Smoke-test results:
- <tool/action>: worked / failed / not available
Missing for your requested goal:
- <write/admin/deploy capability>
Bottom line:
- <service> connector is usable for X, but not yet for Y.
```
