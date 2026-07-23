# Settings, Connections, and Projects

## Settings

Owner: `web-ui/src/pages/SettingsPage.js`. Settings is a shared modal used by desktop and re-presented full-screen on mobile. It is the operator configuration surface for:

- providers, credentials/OAuth/manual flows and model testing/listing;
- current model, agent-model defaults and reusable model templates;
- search, paths, session defaults, feature flags and bulk configuration;
- security, command permissions, credential status/audit and approval-related policy;
- hooks and hook testing; heartbeat and per-agent heartbeat configuration;
- channels/tests, MCP server setup/presets, extensions, installed app aliases and system status;
- account/pairing device review, certificates, remote access/Tailscale funnel state;
- migration/onboarding support, shortcuts, jobs/agents/teams references and lifecycle restart controls.

Settings changes configuration; they do not retrospectively alter an already-completed task run. Sensitive integrations/providers only function after their credentials and required local dependencies are valid.

## Connections

Owner: `web-ui/src/pages/ConnectionsPage.js`. Connections is the integration catalog/setup surface: connected app/MCP state, installation/removal of extensions, and connector-specific authorization/status workflows. “Available connector” means Prometheus knows how to configure it; “connected” is the state that makes its dynamic tools usable.

## Projects

Owner: `web-ui/src/pages/ProjectsPage.js`, displayed as a sidebar/workspace surface rather than one of the nine routed page modes. Projects hold project records, linked sessions, files, file content and canvas/project previews. The surface can upload, read, edit, download, and associate files/sessions with a project. A project is a persistent organization/container for relevant work; it is not a separate execution worker.

## Document language

Describe Settings as the operator configuration plane, Connections as integration lifecycle management, and Projects as durable project/file/session organization. Avoid saying that enabling a setting automatically grants third-party authorization or changes the content of historical runs.
