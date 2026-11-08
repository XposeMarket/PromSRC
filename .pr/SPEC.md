# SPEC: Do not scan encoded screenshot bytes as credential text

Surface: both
Parity: shared module: web-ui/src/features/chat/secret-format-guard.js:20 imported by web-ui/src/api.js:1 and web-ui/src/mobile/mobile-api.js:1; backend admission shared. Chromium/WebKit behavioral tests, no visual change.
Test: node scripts/test-secret-image-guard.mjs && npx tsx scripts/test-protected-plugin-http.ts
Size justification: Bounded credential-boundary fix with client/backend parity tests.

## Problem
IMG_1618.png base64 triggers recognizable-key regex; message 'Not a fan' does not. Recursive backend scan and serialized client scan confuse opaque image bytes with prose.

## Existing code
src/security/secret-format-guard.ts scans all strings. web-ui/src/features/chat/secret-format-guard.js scans the entire JSON request. Desktop and mobile use the latter; gateway core/app.ts uses the former before admission.

## Options
- Disable scanning: rejected, weakens credential protection.
- Skip all base64-named fields: rejected, creates textual bypass.
- Smallest complete fix: skip only syntactically valid, signature-matched raster data in known attachment arrays; scan all surrounding metadata/text as before, use identical traversal on client/server.

## Chosen approach
Schema-aware exemption for base64/dataUrl leaves in attachments/attachmentPreviews arrays with recognized image MIME and matching raster signature. No OCR or generic data-url exemption. JSON request strings parsed before traversal; malformed JSON still scanned as text. Preserve depth fail-closed rule.

## Acceptance
Original screenshot accepted without printing its bytes or committing user image; deterministic synthetic PNG with matching credential-like bytes accepted. Real keys in message, captions, metadata, arbitrary base64 fields, malformed media, unrelated fields and nested edits still blocked. Client/server parity. HTTP no echo and owner consent controls retained.

## Out of scope
Carousel design, credential format expansion, OCR, upload storage, permission changes, merge/deployment.

## Files
- .pr/SPEC.md
- src/security/secret-format-guard.ts
- web-ui/src/features/chat/secret-format-guard.js
- scripts/test-secret-image-guard.mjs
- scripts/test-protected-plugin-http.ts
- scripts/test-mobile-chat-renderer-ownership.mjs

## Scope notes
Generated UI synchronized using repository tooling. Workspace self/06-image-voice.md and self/17-desktop-web-ui.md updated separately.

## Risks
Exemption too broad could bypass text guard; adversarial regressions and one scoped opposite-model review required (Tier 1 sensitive fix). Revert commit restores prior behavior.
