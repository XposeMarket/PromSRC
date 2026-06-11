
### [DEV_EDIT_COMPLETE] 2026-06-11T00:48:50.359Z
_Source: Mobile chat session; session: mobile_mq8s230k_ov6kxg; origin: Mobile app_
Mobile chat composer (#pm-composer-input) in web-ui/src/mobile/mobile-pages.js: changed enterkeyhint "send"->"enter" (line 3576) and removed the plain-Enter requestSubmit branch in the composer keydown handler (~line 6049) so Enter inserts newlines for multi-paragraph messages. Sending now happens only via the Send button. Slash-popover Enter/Tab selection and side-chat composer untouched. Synced web-ui + reload requested.
