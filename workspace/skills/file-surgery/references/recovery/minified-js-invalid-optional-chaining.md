# Recovery: invalid `?.literal` in minified inline JS

Captured: 2026-07-03 (Pocket Zombies `games/mobile-sideways-fps/index.html`)

## Future Trigger
Inline HTML/JS fails to run; shoot/HUD/tracers dead; browser console shows parse error near `?.55`, `?.02`, or similar.

## Cause
`?.` is optional chaining and must be followed by an identifier or bracket access — not a numeric literal. A mistyped ternary like `x?.55` should be `x?0.55:1` (or proper `?:`).

## Learned Behavior
1. Grep the file for `\?\.[0-9]` before claiming combat/UI fixes work.
2. Run `validate_file` on `.html` with inline script; do not use `node --check` on `.html` (ERR_UNKNOWN_FILE_EXTENSION).
3. After `replace_lines` on minified single-line functions, re-read the edited span — replace_lines can wipe adjacent function bodies; recover with `insert_after` from a stable anchor.

## Evidence
- `memory/2026-07-03-intraday-notes.md:54-56`
- `audit/chats/transcripts/mobile_mr2ors69_u35dij.jsonl:152-153`
