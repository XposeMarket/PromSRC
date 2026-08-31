# Chat feature ownership map

This is the source-location contract for the Prometheus chat UI. If a change can be named on screen, start with the owner below instead of searching `ChatPage.js`, `mobile-pages.js`, or global CSS.

The target paths marked **planned** are created by the component-ownership program in `workspace/self/WEB_UI_COMPONENT_OWNERSHIP_REFACTOR_PLAN_2026-08-26.md`. Until a migration lands, the listed compatibility owner remains authoritative.

## Lookup table

| UI concept | Target owner | Current compatibility owner | State authority |
|---|---|---|---|
| Chat session lifecycle, history, stream, queue, approvals and questions | `runtime/` | Desktop/mobile runtime adapters plus legacy page mirrors | `ChatRuntime` and gateway truth |
| Timeline row identity, windowing, reconciliation and scroll anchoring | `timeline/` | Existing desktop/mobile timeline modules | Timeline controller/view |
| Question normalization, validation and lifecycle | `questions/question-model.js`, `questions/question-controller.js` | `ChatPage.js`, `mobile-pages.js` | `ChatRuntime.questions` through the question controller |
| Question history cards and composer question host | `questions/desktop-question-view.js`, `questions/mobile-question-view.js`, `questions/question-composer-host.js` **planned** | Desktop/mobile page renderers and mobile renderer runtime | Stateless feature views |
| Tool lifecycle, coalescing and normalized descriptors | `tools/tool-activity-model.js`, `tools/tool-descriptor-registry.js` **planned** | `tool-activity.js` and optional runtime facade | Tool activity model |
| Working/tool stream grouping and disclosure | `tools/desktop-tool-stream-view.js`, `tools/mobile-tool-stream-view.js` **planned** | `ChatPage.js`, `mobile-pages.js`, mobile renderer runtime | Tool stream controller plus surface view |
| Composer draft, attachments, commands and send/stop transitions | `composer/composer-model.js`, `composer/composer-controller.js` **planned** | `ChatPage.js`, `mobile-pages.js` | Composer controller |
| Main, subagent, team and side-chat composer DOM | `composer/desktop-composer-view.js` with surface adapters **planned** | `web-ui/index.html`, `ChatPage.js`, `canonical-desktop-composer.js` | Surface adapter plus composer controller |
| Mobile composer DOM and keyboard/safe-area behavior | `composer/mobile-composer-view.js` **planned** | `mobile-pages.js`, `mobile-composer-stack.css` | Mobile view plus composer controller |
| User/assistant row shell and message actions | `messages/` **planned** | `ChatPage.js` and mobile renderer runtime | Stateless message views with feature presenters |
| Approval behavior and cards | `approvals/` **planned** | Desktop/mobile page renderers | Approval controller and `ChatRuntime.approvals` |
| Generic anchored positioning, outside press, Escape and focus return | `web-ui/src/ui/popover/` **planned** | Feature-local popover implementations | Shared UI primitive only |
| Question, model, slash-command and context popover semantics | Their feature directory | Feature-local page code | Feature controller/view |
| Mobile navigation, drawer and route chrome | `web-ui/src/mobile/mobile-shell.js` and route owners | Existing mobile shell | Mobile shell |

## Dependency direction

The allowed direction is:

```text
pages / route composition roots
  -> chat feature controllers and views
    -> chat runtime, feature core, timeline and shared UI primitives
      -> transport adapters and utilities
```

Rules:

1. `web-ui/src/features/chat/**` must not import `ChatPage.js`, another page module, or `mobile-pages.js`.
2. Pages may preserve compatibility exports while consumers migrate, but new consumers import feature owners directly.
3. Views receive data and callbacks. They do not select gateway endpoints or mutate session history directly.
4. Desktop and mobile share feature rules; they may retain different markup, focus behavior and navigation.
5. `ChatRuntime` becomes the single writable renderer authority for session-scoped questions, approvals and transcript state. Legacy session objects are one-way compatibility projections during migration.
6. Timeline owners control keys, row order, reconciliation and scroll. Feature owners control the content and lifecycle of their cards.
7. Optional tool and creative code retains its lazy-loading facade. Ownership extraction must not turn it into eager startup work.

## CSS ownership

Feature CSS moves only after the corresponding JS/controller boundary exists. The first move preserves cascade position, layer, selector order and specificity. Visual simplification is a separate review.

Target lookup:

- Question card/host styles -> `features/chat/questions/`
- Tool stream/card styles -> `features/chat/tools/`
- Composer styles -> `features/chat/composer/`
- Message row/action styles -> `features/chat/messages/`
- Generic anchored popover infrastructure -> `ui/popover/`
- Mobile shell/layout only -> `styles/mobile.css`

`styles/components.css` and `styles/mobile.css` are legacy buckets under downward byte ratchets. New feature selectors must not expand them.

## Compatibility seams scheduled for removal

- `window.__PROM_UNIFIED_DESKTOP_CHAT`
- Dynamic imports of `ChatPage.js` from Subagents and Teams
- DOM cloning and mutation observation in `canonical-desktop-composer.js`
- Question logic duplicated between desktop and mobile pages
- Desktop/mobile tool trace grouping duplicated in page owners
- The broad mobile renderer context boundary

Remove a seam only after every caller has migrated and its behavior has regression coverage.

## Review rule

Each PR owns one architectural concern, preserves behavior and visuals unless explicitly stated, lowers the affected legacy ratchet, and leaves the next compatibility seam usable. No component-ownership PR may be merged automatically.
