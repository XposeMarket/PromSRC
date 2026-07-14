# Example: Grok via X OAuth for release-thread drafting (2026-06-04)

Use this when the user asks to use Grok for product/social copy and Grok appears unauthenticated, blocked by an anonymous-user wall, or specifically asks to log in through X.

## Observed request
the user asked Prometheus to open Grok and upload the new Prometheus feature-index files for a release-thread draft. The first pass uploaded files while anonymous but could not retrieve a useful response because Grok showed a “Continue your conversation / Sign up” wall. the user corrected the flow: “please log in via x or go to x and then grok via x.”

## Stable recovery path
1. Read `browser-automation-playbook` for the generic browser flow and this X playbook for X/Grok routing.
2. Ground current browser state with a fresh screenshot/snapshot; do not assume Grok auth.
3. If Grok offers X sign-in/OAuth, use the visible X OAuth flow instead of hallucinating an anonymous Grok answer.
4. Verify the account shown in the OAuth flow before authorizing.
5. After OAuth, reopen `https://grok.com` and confirm the signed-in composer is usable.
6. Upload the exact workspace files the user requested.
7. Wait for Grok’s real response and extract the useful output; if Grok still blocks, say the exact blocker and fall back to direct local file reading only as a clearly labeled fallback.

## Guardrails
- Do not claim Grok produced a response if the answer actually came from local file reading.
- If the user names a directory/file set, use that exact set and correct any mistaken wording. In the observed run, the intended files were `self/feature-index/README.md`, `self/feature-index/findings.md`, and `self/feature-index/deep-cuts.md`.
- Treat OAuth authorization as a final-action/credential-adjacent step: use visible UI evidence and the approval/authorization flow rather than hidden JS shortcuts.
- For release-thread work, preserve uncertainty notes: which files were uploaded, what Grok could/could not read, and which conclusions came from Grok versus Prometheus’ own file inspection.

## Evidence from the successful recovery
- Session `mobile_mpzpfq11_kfkpyg` first hit an anonymous Grok wall after upload, then the user corrected the auth route.
- Recovery used X OAuth for `@raulinvests`, uploaded the three feature-index files, and retrieved Grok’s release-thread pillars: local AI workspace, browser canvas/teach mode, teams/subagents, computer use, Creative/HyperFrames, memory/evidence, approvals, skills/Brain loop, cross-channel access, visuals, integrations, schedules, and heartbeat.
