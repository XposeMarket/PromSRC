# Example: Repair Existing App UI

User request:

> Make this app feel more like Codex would build it. The current UI is messy.

Execution:

1. Inspect current routes, components, CSS, screenshots if available, and package scripts.
2. Identify the app category and primary workflow.
3. Preserve working behavior. Refactor only around visible problems:
   - replace nested cards with clear regions
   - tighten type scale in panels
   - align spacing/radii to existing tokens
   - convert fake buttons/divs into actual controls
   - add missing states and labels
   - improve responsive constraints
4. Use the existing component library and icon set.
5. Run the static audit helper against changed files.
6. Start the app and verify primary workflow at desktop and mobile.

Final response:

- summarize the UI behavior improved
- list key files
- say which checks and browser viewports were verified
- note any remaining unknowns, such as unavailable test data
