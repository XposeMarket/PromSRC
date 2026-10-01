---
name: "composite-tool-authoring"
description: "Design, test, and maintain repeatable saved Prometheus composite tools. Use for validated multi-tool sequences; not for a one-off tool chain or a standalone typed connector (connector-builder)."
---

# Composite Tool Authoring

Use this when turning a proven multi-tool workflow into a saved composite. Do not create a composite from guesses: first run fragile steps manually and verify selectors, references, outputs, and side-effect boundaries.

## Decide whether a composite fits

Use one for a repeatable sequence of existing tools with stable inputs and a clear output. Prefer a typed connector for a service contract, a browser-teach workflow for a UI recipe, and a desktop macro for stable native repetition. Keep user decisions, high-impact final actions, and ambiguous target selection outside the composite.

## Design the contract

Define a valid tool name, concise description, typed required/optional parameters, stable step IDs, and a single observable result. Use parameter templates rather than hidden constants. Keep secrets out of descriptions and saved arguments.

## Harden the sequence

For each step, specify required versus optional behavior, timeout, bounded retry count, saveAs output, and explicit assert checks where possible. Use when for safe conditional paths and fallback for a verified alternate route. Never auto-retry non-idempotent writes without external-state checks or an idempotency key.

## Verify and maintain

After saving, inspect the composite definition and run a bounded smoke test with safe inputs. Verify result shape, artifacts, postconditions, and error behavior. Edit rather than create duplicates. If a step fails, report the failing step and preserved outputs instead of returning a false success. Keep final-action approval outside the composite unless the exact approval token is intentionally passed to the bound next tool call.
