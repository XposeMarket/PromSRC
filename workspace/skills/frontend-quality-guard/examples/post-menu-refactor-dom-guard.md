# Post–menu refactor DOM guard

After replacing a start screen or tabbed build UI in a single-file HTML game:

1. **Grep script for `getElementById` / `#id` onclick** and list every id referenced.
2. **Grep markup** for those ids; remove or guard assignments when markup moved (e.g. `#startBtn` removed in favor of `#start` overlay buttons).
3. **Browser console** on file URL: zero errors before claiming "renders".
4. Prefer `?.` or `if (el) el.onclick = ...` on legacy hooks left for desktop.

## Failure mode (2026-07-03)

Figure 8 Drift: menu refactor left `document.querySelector('#startBtn').onclick = ...` while `#startBtn` was removed → `TypeError: Cannot set properties of null` → blank track until fixed (`memory/2026-07-03-intraday-notes.md:26-28`).