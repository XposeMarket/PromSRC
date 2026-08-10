# Workspace-first mode: direct Prometheus development tools hidden

Date: 2026-08-09

## Decision

Prometheus is moving from directly editing its own live repository through the private dev lane to operating like a workspace coding assistant. The configured Prometheus repository/workspace is now the intended edit surface.

## Default model-facing behavior

The following remain implemented for rollback and maintenance but are hidden from the normal tool schemas, category menu, category activation enum, category-match hints, and workspace routing prose:

- Prometheus source read/write tools and their legacy aliases (`dev_source_read`, `dev_source_edit`, `read_source`, `write_source`, `*_webui_source`, `*_prom`, and related validation/search/patch tools)
- fast dev-edit approval tools (`request_dev_source_edit`, `update_dev_source_edit`, `await_dev_source_edit_approval`)
- Prometheus repo synchronization tools (`prom_repo_ops`, `prom_repo_push`, `prom_repo_pull`, `prom_repo_sync`)
- `self_update`

Generic workspace tools remain available and are the intended path: `workspace_read`, `workspace_code_nav`, `workspace_edit`, `workspace_run`, and `workspace_git`.

Runtime operations remain available, including `diagnostic_packet`, `system_diagnostics`, and `gateway_restart`; these are operational controls, not direct source-edit tools.

This is a visibility change, not deletion. The source definitions, executors, approval records, proposal machinery, and compatibility handlers remain in the repository.

## Restore switch

Set `PROMETHEUS_DEV_TOOLS_VISIBLE=1` (also accepts `true`, `yes`, or `on`) before starting the gateway, then restart it. The source categories and direct dev-tool schemas/routing return. Unset the variable or set it to `0` to return to workspace-first mode.

