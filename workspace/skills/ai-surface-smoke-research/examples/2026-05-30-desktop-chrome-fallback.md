# 2026-05-30 Example — Desktop Chrome Fallback for AI Smoke Research

## Trigger

Raul asked to run the AI smoke test while ignoring a canceled/ghost goal. The intended workflow was still the lightweight browser + desktop research smoke test: focus Codex/Claude, open live AI chatter surfaces, send screenshots/proof, and summarize what was visible.

## What happened

Native browser automation was flaky in this run: `browser_open` timed out on the Prometheus browser profile and user Chrome CDP attachment was blocked because a normal Chrome instance was already open. The run still succeeded by recovering with desktop-driven Chrome navigation, then loading Reddit search and X live search for `Claude OpenClaw Hermes AI`.

## Useful recovery pattern

1. If `browser_open` or CDP attach fails because Chrome is already open, do not loop the same browser launch path.
2. Switch to desktop automation for Chrome:
   - find/focus the existing Chrome window,
   - use address-bar navigation to the target Reddit/X URL,
   - wait for the page to visibly load,
   - use screenshots and scroll/visible text as the proof source.
3. Continue the smoke-test intent: focus Codex and Claude, capture/send proof screenshots, and summarize the visible Reddit/X signals.
4. In the final report, state clearly that native browser automation was the weak link, but desktop control and browser-through-desktop recovery worked.

## Evidence from the run

Final user-facing result reported:

- Codex and Claude were focused successfully with screenshots sent to mobile/origin.
- Native `browser_open` timed out twice and user-Chrome CDP could not attach because normal Chrome was already open.
- Desktop-driven Chrome navigation recovered the workflow.
- Reddit showed Hermes/OpenClaw comparison and migration posts.
- X showed Claude/OpenClaw/Hermes dashboard chatter, multi-agent memory pain points, Vercel AI Gateway promo examples, Qwen/Alibaba agent-framework posts, and enterprise AI/TOS anxiety.

## Guardrail

This fallback is for read-only smoke/research workflows. Do not use desktop Chrome fallback to post, like, reply, bookmark, follow, or perform other external social actions unless the user explicitly asked for that action and the relevant X/browser skill permits it.
