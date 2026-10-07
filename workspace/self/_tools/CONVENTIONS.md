# self/ Conventions — how to write and maintain these docs

`self/` is Prom's guidebook to Prometheus: an agent-first reference to read **before** touching a subsystem and to **update** after changing one. Its readers are AI agents with limited context, so optimize for fast orientation and exact pointers, not prose.

## Hard rules

1. **Verify against source.** Every claim about behavior, paths, tool names, config keys or routes must be checked against the live source at `C:\Users\rafel\PromSRC` (read-only for doc work). Do not copy claims from `archive/self-2026-08/` without re-verifying them; that archive is up to 2 months stale.
2. **Point, don't paste.** Give `src/path/file.ts` plus the symbol name (e.g. `buildToolsForTurn()` in `src/gateway/tool-builder.ts`). Avoid line numbers because they drift; symbol names don't. Quote code only when the exact text matters (an env var, a prompt string, a config key).
3. **Generated beats hand-written for lists.** Don't hand-maintain tool, route, connector, skill or test lists. Link to `generated/*.md` and describe only the *shape*, the *rules* and the *gotchas*.
4. **Size budget.** Target 150–400 lines per doc. If a doc needs more, split it and update `index.md`.
5. **Unknowns are explicit.** Write `UNVERIFIED:` or `TODO(verify):` rather than guessing.

## Required doc template

```markdown
# NN — Title

> **Last verified:** YYYY-MM-DD against PromSRC `<short-sha>` · **Owner area:** src/… , web-ui/…
> **Read this when:** <1–2 lines: the tasks that should start here>

## TL;DR
5–10 bullets: what it is, where it lives, the 2–3 things most likely to bite you.

## Map
| Concern | Where (file → symbol) | Notes |

## How it works
Short sections explaining the flow end to end. Use mermaid diagrams only when they genuinely clarify the flow.

## Config & knobs
Config keys (`.prometheus/config.json` paths), env vars, defaults.

## Gotchas / sharp edges
Real failure modes seen in this code or in notes. Each one says how to detect it and what to do.

## How to change it safely
Which tests/regressions to run (grep `generated/tests.md`), build steps, and live verification.

## Related
Links to sibling docs and generated inventories.
```

## Update protocol (for any agent that changes Prometheus)

- When you change a subsystem in a PR, update its `self/NN-*.md` (TL;DR, Map, Gotchas) and bump **Last verified** to the new sha.
- After merging and pulling into PromSRC, run `node self/_tools/generate-inventories.mjs` so the generated inventories match.
- Add new subsystems to `index.md`. `PromSRC/scripts/test-self-doc-drift.mjs` fails on broken index links.
- **Hard-wired files:** `src/gateway/prompt-context.ts` injects `self/index.md` (first ~3000 chars) into prompts and `self/06-image-voice.md` (first ~7000 chars) into the Voice Agent. Don't rename them, and keep the most important content at the top of each.
- **Two copies:** `PromSRC/workspace/self` is the git-tracked shipped copy and drifts from this one. See [25 Sharp edges §1](../25-sharp-edges.md).
- Point-in-time investigations and benchmarks go in `self/investigations/YYYY-MM-DD-slug.md`, never in the numbered core docs.
