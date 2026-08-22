# Imported-session source marks

These files are packaged with the Prometheus desktop web UI. They are never
loaded from a remote URL at runtime.

- `chatgpt.svg` uses the OpenAI knot mark for the ChatGPT source label. The
  path is from Simple Icons 16.28.0:
  https://cdn.jsdelivr.net/npm/simple-icons@16.28.0/icons/openai.svg
- `openai.svg` uses the same approved OpenAI knot mark for Codex/OpenAI
  provenance, with a distinct accessible title and data-driven UI label.
- `claude.svg` and `cursor.svg` are the corresponding Simple Icons 16.28.0
  source marks:
  https://cdn.jsdelivr.net/npm/simple-icons@16.28.0/icons/claude.svg
  https://cdn.jsdelivr.net/npm/simple-icons@16.28.0/icons/cursor.svg
- `nous-research.png` is the Nous Research logo used by Hermes Agent, copied
  from the inspected Hermes Agent snapshot at
  `website/static/img/nous-logo.png`.
- `openclaw.svg` is the OpenClaw source wordmark copied from the inspected
  OpenClaw snapshot at `docs/assets/openclaw-logo-text-dark.svg`.

The adapter provenance chooses the source mark. Unknown or unsupported source
identities intentionally render an accessible no-art fallback rather than
guessing or displaying a fabricated brand icon.
