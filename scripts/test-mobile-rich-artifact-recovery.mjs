import assert from 'node:assert/strict';
import fs from 'node:fs';

const mobile = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const chatRouter = fs.readFileSync('src/gateway/routes/chat.router.ts', 'utf8');

assert.match(mobile, /filter\(\(item\) => item && typeof item === 'object'\)\.slice\(-8\)/, 'the offline cache must retain every rich-card type');
assert.doesNotMatch(mobile, /richArtifacts\.filter\(\(item\) => item\?\.type === 'visual' \|\| item\?\.type === 'thread_links'\)/, 'the offline cache must not discard show_ui cards');
assert.match(mobile, /msg\.content\.trim\(\) \|\| \(Array\.isArray\(msg\.richArtifacts\) && msg\.richArtifacts\.length\)/, 'artifact-only Voice turns must be written to session history');
assert.match(mobile, /function _mergeMobileRichArtifacts\(/, 'recovery must merge rich cards instead of replacing them');
assert.match(mobile, /messageKind: 'voice_show_ui_card'/, 'Voice show_ui cards must have a distinct stable turn kind');
assert.match(mobile, /isVoiceShowUiCard[\s\S]{0,200}\|\| isVoiceShowUiCard/, 'server reconciliation must preserve artifact-only Voice cards');
assert.match(mobile, /await _persistMobileThreadSnapshot\(sid\);/, 'realtime Voice show_ui cards must finish persistence when received');

assert.match(chatRouter, /persistVoiceAgentVisibleTurn\([\s\S]{0,400}?richArtifacts: any\[\] = \[\]/, 'Voice visible-turn persistence must accept rich cards');
assert.match(chatRouter, /richArtifacts: Array\.isArray\(richArtifacts\) && richArtifacts\.length \? richArtifacts : undefined/, 'Voice visible turns must store their rich cards');
assert.match(chatRouter, /action === 'handoff_new_work' \|\| visibleVoiceArtifacts\.length/, 'ordinary Voice show_ui replies must be persisted too');

console.log('mobile Voice rich-artifact recovery regression checks passed');
