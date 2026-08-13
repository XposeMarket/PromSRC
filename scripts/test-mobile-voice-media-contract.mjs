import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const pages = read('web-ui/src/mobile/mobile-pages.js');
const css = read('web-ui/src/styles/mobile.css');
const shell = read('web-ui/src/mobile/mobile-shell.js');
const desktop = read('web-ui/index.html');
const baseCss = read('web-ui/src/styles/base.css');
const slashCommands = read('web-ui/src/chat-slash-commands.js');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const generatedCss = read('generated/public-web-ui/static/styles/mobile.css');
const generatedDesktop = read('generated/public-web-ui/index.html');

// Mobile popover contract: every gesture is isolated in capture phase, and a
// delayed iOS click cannot activate a Brain Card after the picker closes.
assert.match(pages, /installMobileContextPopoverGuard/);
assert.match(pages, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
assert.match(pages, /document\.addEventListener\('touchstart', onPointerDown, \{ capture: true, passive: false \}\)/);
assert.match(pages, /document\.addEventListener\('click', onClick, true\)/);
assert.match(pages, /document\.addEventListener\('pointerup', shieldPointerUp, true\)/);
assert.match(pages, /body\.classList\.add\('pm-mobile-context-popover-open'\)/);
assert.match(css, /\.pm-chat-target-popover-scrim[^\n]*z-index: 10039/);
assert.match(css, /\.pm-new-chat-context-dock[^\n]*z-index: 10040/);
assert.match(css, /\.pm-attach-sheet \{[\s\S]{0,120}z-index: 10060/);
assert.match(css, /body\.pm-mobile-context-popover-open \.pm-chat-body \{ pointer-events: none !important; \}/);
assert.match(pages, /setActiveGatewayId\(pendingGatewayId\)/);
assert.match(pages, /setMobileActiveGatewayTarget\(pendingGatewayId\)/);
assert.match(pages, /targetPopover\?\.dataset\?\.popoverType === 'target'/);
assert.match(pages, /targetPopover\?\.dataset\?\.popoverType === 'project'/);
assert.match(pages, /attachMobileButtonHaptic\(micBtn, \(\) => micBtn\.click\(\)\)/);
assert.match(pages, /const bindContextTrigger = \(button, activate\) =>/);
assert.match(pages, /eventIsInHigherLayer/);
assert.match(pages, /targetPopover\.dataset\?\.popoverType === 'target'/);
assert.match(pages, /function dismissNewChatContextDock\(\)/);
assert.match(pages, /dismissNewChatContextDock\(\);/);
assert.match(css, /--pm-mobile-chrome-top-offset: 16px/);
assert.match(css, /--pm-mobile-content-top-offset: 16px/);
assert.match(css, /--pm-mobile-tabbar-bottom: 7px/);
assert.match(css, /--pm-mobile-composer-gap: 11px/);
assert.match(css, /--pm-mobile-context-chip-top: calc\(/);
assert.match(css, /\.pm-ctx-chip \{[\s\S]{0,120}top: var\(--pm-mobile-context-chip-top\)/);
assert.match(css, /\.pm-ctx-popover \{[\s\S]{0,150}top: calc\(var\(--pm-mobile-context-chip-top\) \+ 42px\)/);
assert.match(css, /\.pm-new-chat-context-dock > \.pm-haptic-host/);
assert.match(css, /\.pm-new-chat-context-dock \.pm-haptic-switch-overlay \{ pointer-events: auto; \}/);

// Composer picker contract: `$` is the explicit skill-token trigger, it gets
// the same async cache completion path as slash commands, and a stale slash
// command cannot suppress the skill popover after a route/input replacement.
assert.match(slashCommands, /CHAT_SKILL_TRIGGER = '\$'/);
assert.match(pages, /const skillState = _pmSkillComposerState\(input\)/);
assert.match(pages, /let _pmSkillCacheReady =/);
assert.match(pages, /if \(skillState\) \{[\s\S]{0,260}_pmEnsureSkillTriggerCacheLoaded\(\)/);
assert.match(pages, /pm-chat-slash-loading/);
assert.match(pages, /_pmSkillCacheReady = true/);
assert.match(pages, /_pmEnsureSkillTriggerCacheLoaded\(\);\r?\n  window\.addEventListener\('prometheus:markdown-ready'/);
assert.match(pages, /const activeMatch = _pmMatchSlashCommandValue\(value\)/);
assert.match(pages, /pmActiveSlashCommand = null;[\s\S]{0,260}pmSkillComposerSelectionIndex = 0/);
assert.match(pages, /input\?\.addEventListener\('input', \(\) => \{[\s\S]{0,120}_pmHandleSlashInput\(page, input\)/);

// Desktop keeps the status state machine alive but no longer renders its
// green/red gateway control. Mobile keeps the model/reasoning selector pill.
assert.doesNotMatch(desktop, /class="status-pill gateway-status-pill"/);
assert.doesNotMatch(desktop, /id="gateway-status-pill"/);
assert.doesNotMatch(baseCss, /\.gateway-status-pill/);
assert.match(desktop, /if \(dot\) dot\.className/);
assert.match(desktop, /const statusEl = document\.getElementById\('ollama-status'\)/);
assert.match(shell, /class="pm-online pm-model-badge"/);
assert.match(css, /\.pm-header \.pm-online::before[\s\S]{0,120}display: none/);
assert.match(css, /\.pm-header \.pm-online\.offline \{ color: var\(--pm-text\); \}/);
assert.match(css, /\.pm-model-badge \.pm-model-badge-label[\s\S]{0,130}justify-content: center/);

// Camera timing contract: a turn has a generation/association gate, the
// response is held until capture+encode+association completes, and late work
// is rejected after response.created.
assert.match(pages, /turnId: 0/);
assert.match(pages, /responseGateActive: false/);
assert.match(pages, /async function _prepareMobileRealtimeLiveCameraForTurn/);
assert.match(pages, /asyncReader\(\{ force: true, reason, turnId \}\)/);
assert.match(pages, /authoritative: true/);
assert.match(pages, /turnCaptureStartedAt/);
assert.match(pages, /lastAssociatedFrameId/);
assert.match(pages, /realtime-agent-live-camera-frame-dropped-before-turn/);
assert.match(pages, /realtime-agent-live-camera-frame-dropped-backpressure/);
assert.match(pages, /realtime-agent-live-camera-encode-ready/);
assert.match(pages, /realtime-agent-live-camera-upload-start/);
assert.match(pages, /realtime-agent-live-camera-upload-finished/);
assert.match(pages, /realtime-agent-live-camera-frame-associated/);
assert.match(pages, /realtime-agent-live-camera-attachment-visible/);
assert.match(pages, /Live camera attached · turn/);
assert.match(pages, /staged-frame-not-current/);
assert.match(pages, /realtime-agent-model-request-start/);
assert.match(pages, /realtime-agent-model-inference-start/);
assert.match(pages, /realtime-agent-model-response-finished/);
assert.match(pages, /isCurrent\(\)\)/);
assert.match(pages, /_flushMobileRealtimeAgentPendingImages\('speech_started', \{ createResponse: false \}\)/);
const release = pages.slice(pages.indexOf('function _mobileRealtimeAgentPttRelease()'));
assert.match(release, /await Promise\.resolve\(_prepareMobileRealtimeLiveCameraForTurn\('ptt_release'\)\)/);
const publicPttRelease = release.slice(release.indexOf('const flushThenCommit = async'));
assert.ok(publicPttRelease.indexOf("_prepareMobileRealtimeLiveCameraForTurn('ptt_release')") < publicPttRelease.indexOf('commitAndRespond();'), 'PTT must associate the camera frame before response creation');
const xaiPttStart = release.indexOf("if (conn?.provider === 'xai')", release.indexOf('if (_isMobileCodexV3RealtimeConnection(conn))'));
const xaiPttRelease = release.slice(xaiPttStart);
assert.ok(xaiPttStart >= 0, 'xAI PTT branch must be present');
assert.ok(xaiPttRelease.indexOf("_prepareMobileRealtimeLiveCameraForTurn('xai_ptt_release')") < xaiPttRelease.indexOf('commitAndRespond();'), 'xAI PTT must associate the camera frame before response creation');
const vadBoundary = pages.slice(pages.indexOf("if (type === 'input_audio_buffer.speech_started')"));
assert.ok(vadBoundary.indexOf("_prepareMobileRealtimeLiveCameraForTurn('speech_stopped')") < vadBoundary.indexOf("_maybeReleaseMobileRealtimeCameraResponseGate('speech_stopped_camera_ready')"), 'server-VAD must prepare the camera before releasing the response gate');

// xAI playback is explicitly selected; its streaming resampler, extra start
// cushion, underrun telemetry, and drop accounting remain provider-gated so
// the already-working OpenAI path keeps its original settings.
assert.match(pages, /provider: 'xai'/);
assert.match(pages, /provider: 'openai_ws'/);
assert.match(pages, /resampleForXai/);
assert.match(pages, /Math\.max\(0\.48, Number\(options\.prebufferSeconds \|\| 0\.55\)/);
assert.match(pages, /isXai \? 0\.16 : 0\.08/);
assert.match(pages, /debugPlayback\('underrun'/);
assert.match(pages, /droppedChunks/);
assert.match(pages, /usableBytes = bytes\.length - \(bytes\.length % 2\)/);

assert.match(generatedPages, /installMobileContextPopoverGuard/);
assert.match(generatedPages, /realtime-agent-live-camera-frame-associated/);
assert.match(generatedPages, /asyncReader\(\{ force: true, reason, turnId \}\)/);
assert.match(generatedPages, /realtime-agent-live-camera-attachment-visible/);
assert.match(generatedPages, /dismissNewChatContextDock/);
assert.match(generatedPages, /pm-chat-slash-loading/);
assert.match(generatedCss, /body\.pm-mobile-context-popover-open \.pm-chat-body/);
assert.match(generatedCss, /--pm-mobile-chrome-top-offset: 16px/);
assert.match(generatedCss, /--pm-mobile-context-chip-top: calc\(/);
assert.doesNotMatch(generatedDesktop, /id="gateway-status-pill"/);

console.log('[test-mobile-voice-media-contract] passed: mobile spacing, selector haptics/close behavior, skill/$ composer picker, context chip position, first-send teardown, popover isolation, gateway UI contracts, camera turn timing, and xAI playback safeguards');
