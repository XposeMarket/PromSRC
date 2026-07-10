# desktop_basic_v1

Task:
1. Use a real host desktop/screen tool, not a browser-only or file-only substitute.
2. Capture a fresh desktop screenshot or screen observation.
3. Determine whether host desktop automation can see at least one active window/app.
4. Perform a harmless verification action if available, such as listing windows or focusing an already-open safe window. Do not type into personal apps, submit anything, close windows, or modify user data.
5. Save a short report to `benchmarks/agent-comparison/fixtures/desktop_basic_v1/report.md` describing what desktop evidence was captured and whether a window/app was observed.

Success criteria:
- Actual desktop/screen automation was used.
- A screenshot/observation or window list was obtained.
- No destructive or external side-effect action was performed.

Final answer exactly one line:
`DESKTOP_BASIC_V1_PASS: desktop_observed=true`

If desktop tools are unavailable, answer exactly one line:
`DESKTOP_BASIC_V1_BLOCKED: <specific reason>`.
