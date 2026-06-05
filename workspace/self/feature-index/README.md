# Prometheus Feature Index

This directory is a feature-level index for Prometheus. It is intentionally different from the source-oriented `workspace/self` notes: each entry should describe what Prometheus offers, how the feature works from a user or agent point of view, where it appears, what tools/routes/settings support it, and what marketing or product-language hooks matter.

Use this index when Prometheus needs to explain itself, write launch copy, create a social post or blog post about a feature, generate onboarding material, compare capabilities, or decide which feature area to inspect before making changes.

## Files

- `findings.md` - deep-dive inventory of feature areas found in the current source tree and self docs.
- `deep-cuts.md` - second-pass inventory for in-app browser, side chats, background agents, composite tools, interactive chat visuals, teach mode, heartbeat, schedules, computer use, Brain/Thought/Dream, and skill gardener/curator features.

## Maintenance Rules

- Add user-facing features here even when they span many source files.
- Include tools, commands, UI surfaces, settings, defaults, channels, and integrations.
- Prefer concrete names from code and docs over generic labels.
- Link back to source/self docs when a feature needs deeper implementation detail.
- Mark uncertain or partially implemented areas as such instead of silently omitting them.
