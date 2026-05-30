# Web-ui source tool path-selection guardrail — 2026-05-26

Observed during a small mobile drawer fix: the workflow initially called a generic source stats tool with a workspace-style web-ui path (`web-ui/src/mobile/mobile-shell.js`) and received `File not found: src/web-ui/src/mobile/mobile-shell.js`; recovery succeeded after switching to the web-ui-specific source tool/path family and then applying the small patch.

Guardrail:

- Match the path to the tool namespace before assuming the file is missing. Generic Prometheus source tools may resolve paths under `src/`, while web-ui source tools expect web-ui-relative paths such as `src/mobile/mobile-shell.js`.
- For files under `web-ui/src/**`, prefer `webui_source_stats`, `read_webui_source`, and `find_replace_webui_source`/web-ui write tools with `src/...` paths. Do not interpret a `source_stats` miss on `web-ui/src/...` as evidence that the file does not exist.
- When a source path miss occurs, immediately list or search with the matching source family, then re-read the exact file before requesting approval or patching.
- Keep the normal mobile/web-ui verification gate after recovery: sync web UI, apply live with `changed_surfaces:["mobile"]` or `[
"web-ui"]` as appropriate, and report the reload/verification evidence.

Evidence from 2026-05-26: mobile session `mobile_mpmvw4u0_qd8oxc` fixed the drawer New chat button in `web-ui/src/mobile/mobile-shell.js` after an initial `source_stats` path mismatch; skill episode `Brain/skill-episodes/2026-05-26/episodes.jsonl:1` records the `source_stats` miss and successful subsequent `webui_source_stats`/`read_webui_source`/`find_replace_webui_source`/`prom_apply_dev_changes` flow.