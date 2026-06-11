
### [DEV_EDIT_COMPLETE] 2026-06-11T00:48:50.359Z
_Source: Mobile chat session; session: mobile_mq8s230k_ov6kxg; origin: Mobile app_
Mobile chat composer (#pm-composer-input) in web-ui/src/mobile/mobile-pages.js: changed enterkeyhint "send"->"enter" (line 3576) and removed the plain-Enter requestSubmit branch in the composer keydown handler (~line 6049) so Enter inserts newlines for multi-paragraph messages. Sending now happens only via the Send button. Slash-popover Enter/Tab selection and side-chat composer untouched. Synced web-ui + reload requested.

### [DEV_EDIT_COMPLETE] 2026-06-11T00:54:55.577Z
_Source: Mobile chat session; session: mobile_mq8s9dff_m4e5le; origin: Mobile app_
Mobile voice mode panel now matches composer/tab-bar liquid glass. Edits to web-ui/src/styles/mobile.css: (1) removed dark blur band above panel (.pm-chat-voice-shell::before -> content:none); (2) removed dark tint bottom band (.pm-voice-controls::before -> background:transparent); (3) retuned .pm-composer.is-voice-active::before to exact composer material: white edge sheen gradient, blur(3px) saturate(2.0) brightness(1.05), no dark linear tint, kept warm bottom glow + top mask fade-in. Verified webui_sync_check, applied live with web reload.

### [DEV_EDIT_COMPLETE] 2026-06-11T01:03:19.208Z
_Source: Mobile chat session; session: mobile_mq8s9dff_m4e5le; origin: Mobile app_
Mobile voice mode panel reshaped in web-ui/src/styles/mobile.css: (1) .pm-composer.is-voice-active is now a rounded inset floating card (left/right:10px, bottom above tabbar+22px, border-radius:22px, composer glass gradient + border + shadow, max-height min(64vh,560px)) instead of full-bleed square; ::before reduced to a contained warm glow (removed full-bleed mask/specular sheet). (2) .pm-chat-voice-shell min-height 306px→248px, border-radius inherit. (3) Controls tightened: inline padding 8/18→4/10, grid 42px→36px col + gap 8→7 + margin 12/4→6/2, control-btn min-height 42→36 font 13→12 svg 17→16, settings-icon 42→36, mode-toggle min-height 42→36 + buttons 34→28 padding 13→11 font 13→12. Synced + reloaded. dev_edit_complete.
