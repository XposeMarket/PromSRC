# Focused validation

Run from the repository root:

```bash
node scripts/test-mobile-chat-runtime-request-identity.mjs
node scripts/test-mobile-chat-live-turn-identity-contract.mjs
node scripts/test-mobile-chat-recovery.mjs
npm run test:shared-chat-runtime
npm run check:web-ui
```

Physical iPhone/PWA verification sequence:

1. Open **New Chat**.
2. Send `Hi` once.
3. Confirm the user bubble is visible immediately.
4. Confirm exactly one assistant `Working for …` row is present.
5. Let the answer finish and confirm exactly one assistant answer remains.
6. Leave and reopen the chat and confirm the same one-user/one-assistant transcript is preserved.
