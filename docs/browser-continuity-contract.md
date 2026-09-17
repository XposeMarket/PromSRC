# Browser continuity regression

Run `npx tsx src/gateway/browser-continuity.regression.ts`.

The fixture calls the production tool dispatcher with browser_session, browser_observe, and browser_act. Only Electron RPC is replaced with a deterministic transport. It uses temporary runtime/workspace directories and never opens a real browser or calls a model.

Acceptance criteria:
- Repeated open/observe/click/observe calls retain the same chat identity; a second chat remains unchanged.
- When the gateway mapping is missing but Electron confirms the same attached session, snapshot restores that mapping and reports recovery. It does not open a tab or switch targets.
- A click after mapping recovery requires a fresh observation before acting.
- Missing native sessions, mismatched identities, transport errors, malformed replies, and missing results are failures.
- A successful click/fill followed by a failed observation remains a failed tool result that explicitly records the completed action. The action is never replayed automatically.

The regression reproduces missing-map recovery and failure-reporting defects. It does not establish why the original live session lost its mapping or validate real Electron rendering. The regular Chrome transport is unchanged.
