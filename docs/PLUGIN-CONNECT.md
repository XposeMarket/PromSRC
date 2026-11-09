# Plugin connection entrypoints

Implementation branch: feat/plugin-connect-flow. Not deployed until reviewed/merged.

`connection_ops(action:"start", service:"x", kind:"connector")` and `POST /api/connection-attempts/start` share a metadata-only starter. Use canonical kind + ID when IDs overlap (connector:github, mcp_preset:github, integration:github). Starting does not approve authentication. Unknown/unsupported installed setup stays the selected identity and reports SETUP_UNAVAILABLE; it never becomes a different plugin.

Desktop native Connect and mobile generic Connect render a shared action controller instead of sending chat prose. Existing hosted MCP popup branches, imported plugin enable and provider-specific Models setup remain in place. Start/reopen returns the same active attempt; concurrent same-target starts coalesce. Channels/tools get an action card; only the protected owner route may approve.

Owner consent is required by `/api/connection-attempts/:id/connect`, using existing Electron one-shot/body-bound consent or trusted paired phone proof. Browser-only environments without proof or protected storage fail closed. Continue is progress, not consent. Model `approved` flags do not authorize the connection.

Native OAuth covers the nine existing native bridges plus X, Instagram, LinkedIn and TikTok. App credentials use the existing protected card and typed save routes. Attempt-bound native app schemas pin clientId/clientSecret to the selected connector and reject cancelled/expired/mismatched attempts. X uses existing PKCE, not browser cookies; verification performs a bounded `/2/users/me` read. Provider app registration/approval is still an external prerequisite. Loopback providers require the PC/browser handoff; no phone-local redirect is promised.

Cancel invalidates pending native/MCP OAuth and guards late token commits; it does not delete a prior grant. Disconnect clears local access; remote revocation is labelled unavailable where unsupported. Delete-app and stop-use remain separate existing lifecycle actions. Late adapter results cannot resurrect cancelled attempts.

Generic keys with no safe read remain stored/unverified. Custom HTTP authentication failures do not verify. Model listing does not prove streaming/tool calling. Nous uses its existing OpenAI-compatible localhost proxy; Hermes must already be running. Existing provider credentials/model choice are preserved on registration.

## Audit and proof limits
Full source inventory:49 bundled manifests (16 connectors,9 MCP presets,24 providers),1 known installed legacy manifest,6 dynamic families. Canonical workspace artifacts: plans/plugin-connect-flow/PLUGIN-AUDIT.md and JSON. Source support is not live account verification. Configured MCP instances are not auto-installed; missing package/local-resource prerequisites remain explicit. API credentials and user account sign-ins are never test fixtures.

Regression scripts include actual-registry aliases/kind collisions, native strategies, duplicate start, consent/cancel guards, schema correlation, configured MCP and Nous. Existing OAuth, protected-owner HTTP and UI suites retained. Isolated controller screenshots at desktop1440/mobile390 prove rendering/cancel only; packaged native owner UI and physical trusted-phone sign-in still need device validation. Real X was not connected because the prior Stop remains in force.
