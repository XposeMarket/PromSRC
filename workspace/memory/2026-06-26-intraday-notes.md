### [COMPACTION_SUMMARY] 2026-06-26T10:29:08.447Z
Error: openai_codex API error 429: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"prolite","resets_at":1782953731,"eligible_promo":null,"resets_in_seconds":483983}}


### [DEV_EDIT_COMPLETE] 2026-06-26T17:22:22.454Z
_Source: Mobile chat session; session: mobile_mqv6jtuy_wejj8v; origin: Mobile app_
Completed Prometheus dev edit dev_edit_mqv70757_3f89b68f for mobile theme token cleanup. Changed web-ui/src/styles/mobile.css to introduce semantic --pm-accent, --pm-accent-soft, --pm-accent-dark tokens and keep legacy --pm-orange* aliases, including explicit alias reassertion in dark/blue/purple skins so cascade resolves correctly. Updated self docs: self/WEB_UI_THEMES.md, self/16-mobile-app.md, self/24-mobile-liquid-glass.md. Ran prom_apply_dev_changes verify/apply; npm run sync:web-ui succeeded and desktop reload was requested. Live mobile page had no console errors; JS check confirmed dark/light/blue/purple --pm-accent and --pm-orange aliases match.

### [DISCOVERY] 2026-06-26T17:42:45.944Z
_Source: Mobile chat session; session: mobile_mqv7su1t_wl23vo; origin: Mobile app_
Researched iPhone Action Button -> Prometheus Mobile voice mode. Prometheus PWA already has manifest shortcut Voice at `/?source=pwa#mobile/voice`; mobile router supports `#mobile/voice`, aliases `#mobile/v`, and query route params `?mobile=`, `?pm_route=`, `?route=`. Live browser verification: opening `http://127.0.0.1:18789/?source=pwa#mobile/voice` lands on the Voice tab/page. Opening `?source=pwa&pm_route=mobile/voice` was backfilled to `#mobile/chat` because the router adds chat when sticky mobile activation sees no hash/pair marker before route parsing, so the safest Shortcut URL is the direct hash URL, not pm_route. Apple supports assigning Action Button to Run Shortcut; iOS Shortcuts can use Open URL. Caveat: Shortcuts may open Safari rather than standalone PWA on some iOS versions, but direct URL still lands on voice mode; `webapp://` appears unreliable.
