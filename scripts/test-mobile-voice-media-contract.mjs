import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const pageRuntime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const pages = [read('web-ui/src/mobile/mobile-pages.js'), pageRuntime].join('\n');
const voiceRuntime = read('web-ui/src/mobile/mobile-voice-runtime.js');
const realtimeRuntime = read('web-ui/src/mobile/mobile-voice-realtime-runtime.js');
const voiceMedia = [pages, voiceRuntime, realtimeRuntime].join('\n');
const css = [read('web-ui/src/styles/mobile.css'), read('web-ui/src/styles/mobile-shell.css')].join('\n');
const shell = read('web-ui/src/mobile/mobile-shell.js');
const desktop = [read('web-ui/index.html'), read('web-ui/src/legacy-desktop-bootstrap.js')].join('\n');
const baseCss = read('web-ui/src/styles/base.css');
const slashCommands = read('web-ui/src/features/chat/core/slash-commands.js');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const generatedPageRuntime = read('generated/public-web-ui/static/mobile/mobile-chat-page-runtime.js');
const generatedVoicePage = read('generated/public-web-ui/static/mobile/mobile-voice-page.js');
const generatedRealtimeRuntime = read('generated/public-web-ui/static/mobile/mobile-voice-realtime-runtime.js');
const generatedVoiceMedia = [generatedPages, generatedPageRuntime, generatedVoicePage, generatedRealtimeRuntime].join('\n');
const generatedCss = [
  read('generated/public-web-ui/static/styles/mobile.css'),
  read('generated/public-web-ui/static/styles/mobile-shell.css'),
].join('\n');
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
assert.match(voiceMedia, /turnId: 0/);
assert.match(voiceMedia, /responseGateActive: false/);
assert.match(voiceMedia, /async function _prepareMobileRealtimeLiveCameraForTurn/);
assert.match(voiceMedia, /async function _awaitMobileRealtimeCameraOperation/);
assert.match(voiceMedia, /function _mobileRealtimeUserTurnCanContinueAcrossPause/);
assert.match(voiceMedia, /realtime-agent-user-turn-held-open/);
assert.match(voiceMedia, /realtime-agent-user-turn-continued-after-pause/);
assert.match(voiceMedia, /currentUserSpeechStoppedAt/);
assert.match(voiceMedia, /_finalizeMobileRealtimeUserTurn\(sessionId, 'response_created'\)/);
assert.match(voiceMedia, /_finalizeMobileRealtimeUserTurn\(sessionId, 'response_finished'\)/);
assert.match(voiceMedia, /const continueCurrentUserTurn = _mobileRealtimeUserTurnCanContinueAcrossPause\(sessionId\)/);
assert.match(voiceMedia, /realtime-agent-live-camera-turn-frame-read-timeout/);
assert.match(voiceMedia, /realtime-agent-live-camera-turn-association-timeout/);
assert.match(voiceMedia, /restoreResponseCreation/);
assert.match(voiceMedia, /_sendMobileRealtimeAgentCreateResponseFlag\(true\)/);
assert.match(voiceMedia, /asyncReader\(\{ force: true, reason, turnId \}\)/);
assert.match(voiceMedia, /authoritative: true/);
assert.match(voiceMedia, /turnCaptureStartedAt/);
assert.match(voiceMedia, /lastAssociatedFrameId/);
assert.match(voiceMedia, /realtime-agent-live-camera-frame-dropped-before-turn/);
assert.match(voiceMedia, /realtime-agent-live-camera-frame-dropped-backpressure/);
assert.match(voiceMedia, /realtime-agent-live-camera-encode-ready/);
assert.match(voiceMedia, /realtime-agent-live-camera-upload-start/);
assert.match(voiceMedia, /realtime-agent-live-camera-upload-finished/);
assert.match(voiceMedia, /realtime-agent-live-camera-frame-associated/);
assert.match(voiceMedia, /realtime-agent-live-camera-attachment-visible/);
assert.match(voiceMedia, /Live camera attached · turn/);
assert.match(voiceMedia, /_mobileRealtimeCurrentStagedAttachmentTurn/);
assert.match(voiceMedia, /duplicate-camera-speech-start-ignored/);
assert.match(voiceMedia, /realtime-agent-model-request-camera-gate-race-fallback/);
assert.doesNotMatch(voiceMedia, /realtime-agent-model-request-cancelled-camera-not-associated/);
assert.match(voiceMedia, /staged-frame-not-current/);
assert.match(voiceMedia, /realtime-agent-model-request-start/);
assert.match(voiceMedia, /realtime-agent-model-inference-start/);
assert.match(voiceMedia, /realtime-agent-model-response-finished/);
assert.match(voiceMedia, /_startMobileRealtimeLiveCameraVision\('chat_camera_opened'\)/);
assert.match(voiceMedia, /_startMobileRealtimeLiveCameraVision\('realtime_backend_ready'\)/);
assert.match(voiceMedia, /_startMobileRealtimeLiveCameraVision\('camera_response_finished'\)/);
assert.match(voiceMedia, /function _mobileRealtimeCameraSessionIsOpen\(\)/);
assert.match(realtimeRuntime, /async function _sendMobileRealtimeAgentCameraSnapshot/);
assert.match(voiceMedia, /xaiVisionResponse/);
assert.match(voiceMedia, /resumeAfterXaiVisionResponse/);
assert.match(voiceMedia, /function _mobileRealtimeXaiLiveCameraCanResume\(\)/);
assert.match(voiceMedia, /realtime-agent-live-camera-resumed-after-xai-vision-response/);
assert.match(voiceMedia, /isCurrent\(\)\)/);
assert.match(voiceMedia, /_flushMobileRealtimeAgentPendingImages\('speech_started', \{ createResponse: false, turnId: cameraState\.turnId \}\)/);
assert.match(voiceMedia, /function _sendMobileRealtimeDataChannelEvent\(dc, event\)/);
assert.match(voiceMedia, /interrupt_response: !!enabled/);
assert.match(voiceMedia, /const restorePendingImages = \(\) =>/);
assert.match(voiceMedia, /await _injectRealtimeImageItemToConversation\(image, (?:options\.label \|\| )?label/);
assert.match(voiceMedia, /realtime-agent-data-channel-send-failed/);

// Camera transport contract: camera state is carried into the next voice
// turn, images are flushed at that boundary in order, and a camera-relative
// request cannot fall through to a desktop/browser screenshot.
assert.match(voiceMedia, /cameraRuntime: \{/);
assert.match(voiceMedia, /function _mobileRealtimeCameraRuntimeText\(options = \{\}\)/);
assert.match(voiceMedia, /function _sendMobileRealtimeCameraTurnContext\(options = \{\}\)/);
assert.match(voiceMedia, /function _scheduleMobileRealtimeAgentPendingImageFlush\(reason = 'camera_image_staged'\)/);
assert.match(voiceMedia, /Live camera image attached\./);
assert.match(voiceMedia, /Multiple live camera images attached/);
assert.match(voiceMedia, /The mobile camera live feed is active\. Inspect the attached live camera image/);
assert.match(voiceMedia, /realtime-agent-camera-screenshot-fallback-blocked/);
assert.match(voiceMedia, /_downscaleDataUrlForRealtime\(url, isVideo \? 960 : 1280/);
assert.match(voiceMedia, /function _queueMobileRealtimeAgentImage\(attachment, options = \{\}\)/);
assert.match(voiceMedia, /skipAutoFlush: true/);
assert.match(voiceMedia, /_mobileRealtimeLiveCameraAssociationTimeoutMs/);
assert.match(voiceMedia, /timeoutMs: 45_000/);
assert.match(voiceMedia, /bodyError: String\(err\?\.body\?\.error/);
assert.doesNotMatch(voiceMedia, /type: 'input_image', detail: 'auto'/);
const liveAssociation = realtimeRuntime.slice(realtimeRuntime.indexOf('async function _associateMobileRealtimeLiveCameraFrame'));
const liveAssociationEnd = liveAssociation.indexOf('\nfunction _stopMobileRealtimeLiveCameraVision');
const liveAssociationBody = liveAssociation.slice(0, liveAssociationEnd);
assert.ok(liveAssociationBody.includes('_stageMobileRealtimeAgentImage('), 'live camera must use the shared staged-image path');
assert.ok(liveAssociationBody.includes('_flushMobileRealtimeAgentPendingImages('), 'live camera must use the shared image flush path');
assert.doesNotMatch(liveAssociationBody, /provider === 'xai'\s*\n\s*\?/);
const chatVoiceCamera = pages.slice(pages.indexOf('async function openVoiceCameraCaptureFromSheet'));
assert.match(chatVoiceCamera, /_sendMobileRealtimeAgentCameraSnapshot\(/, 'chat voice shutter must send the snapshot immediately');
assert.doesNotMatch(
  chatVoiceCamera.slice(0, chatVoiceCamera.indexOf('onVideoCapture:')),
  /_stageMobileRealtimeAgentImage\(/,
  'chat voice still capture must not only stage the image',
);
const release = realtimeRuntime.slice(realtimeRuntime.indexOf('function _mobileRealtimeAgentPttRelease()'));
assert.match(release, /await Promise\.resolve\(_prepareMobileRealtimeLiveCameraForTurn\('ptt_release'\)\)/);
const publicPttRelease = release.slice(release.indexOf('const flushThenCommit = async'));
assert.ok(publicPttRelease.indexOf("_prepareMobileRealtimeLiveCameraForTurn('ptt_release')") < publicPttRelease.indexOf('commitAndRespond();'), 'PTT must associate the camera frame before response creation');
const xaiPttStart = release.indexOf("if (conn?.provider === 'xai')", release.indexOf('if (_isMobileCodexV3RealtimeConnection(conn))'));
const xaiPttRelease = release.slice(xaiPttStart);
assert.ok(xaiPttStart >= 0, 'xAI PTT branch must be present');
assert.ok(xaiPttRelease.indexOf("_prepareMobileRealtimeLiveCameraForTurn('xai_ptt_release')") < xaiPttRelease.indexOf('commitAndRespond();'), 'xAI PTT must associate the camera frame before response creation');
assert.ok(xaiPttRelease.indexOf("_flushMobileRealtimeAgentPendingImages('xai_ptt_release'") < xaiPttRelease.indexOf('commitAndRespond();'), 'xAI PTT must flush staged camera images before response creation');
const vadBoundary = realtimeRuntime.slice(realtimeRuntime.indexOf("if (type === 'input_audio_buffer.speech_started')"));
assert.ok(vadBoundary.indexOf("_prepareMobileRealtimeLiveCameraForTurn('speech_stopped')") < vadBoundary.indexOf("_maybeReleaseMobileRealtimeCameraResponseGate('speech_stopped_camera_ready')"), 'server-VAD must prepare the camera before releasing the response gate');

// xAI playback is explicitly selected; its streaming resampler, extra start
// cushion, underrun telemetry, and drop accounting remain provider-gated so
// the already-working OpenAI path keeps its original settings.
assert.match(voiceMedia, /provider: 'xai'/);
assert.match(voiceMedia, /provider: 'openai_ws'/);
assert.match(voiceMedia, /resampleForXai/);
assert.match(voiceMedia, /Math\.max\(0\.48, Number\(options\.prebufferSeconds \|\| 0\.55\)/);
assert.match(voiceMedia, /isXai \? 0\.16 : 0\.08/);
assert.match(voiceMedia, /debugPlayback\('underrun'/);
assert.match(voiceMedia, /droppedChunks/);
assert.match(voiceMedia, /usableBytes = bytes\.length - \(bytes\.length % 2\)/);

assert.match(generatedVoiceMedia, /installMobileContextPopoverGuard/);
assert.match(generatedVoiceMedia, /realtime-agent-live-camera-frame-associated/);
assert.match(generatedVoiceMedia, /asyncReader\(\{ force: true, reason, turnId \}\)/);
assert.match(generatedVoiceMedia, /realtime-agent-live-camera-attachment-visible/);
assert.match(generatedVoiceMedia, /_startMobileRealtimeLiveCameraVision\('chat_camera_opened'\)/);
assert.match(generatedVoiceMedia, /_startMobileRealtimeLiveCameraVision\('realtime_backend_ready'\)/);
assert.match(generatedVoiceMedia, /_startMobileRealtimeLiveCameraVision\('camera_response_finished'\)/);
assert.match(generatedVoiceMedia, /xaiVisionResponse/);
assert.match(generatedVoiceMedia, /resumeAfterXaiVisionResponse/);
assert.match(generatedVoiceMedia, /function _mobileRealtimeXaiLiveCameraCanResume\(\)/);
assert.match(generatedVoiceMedia, /realtime-agent-live-camera-resumed-after-xai-vision-response/);
assert.match(generatedVoiceMedia, /function _sendMobileRealtimeDataChannelEvent\(dc, event\)/);
assert.match(generatedVoiceMedia, /interrupt_response: !!enabled/);
assert.match(generatedVoiceMedia, /const restorePendingImages = \(\) =>/);
assert.match(generatedVoiceMedia, /cameraRuntime: \{/);
assert.match(generatedVoiceMedia, /function _sendMobileRealtimeCameraTurnContext\(options = \{\}\)/);
assert.match(generatedVoiceMedia, /function _scheduleMobileRealtimeAgentPendingImageFlush\(reason = 'camera_image_staged'\)/);
assert.match(generatedVoiceMedia, /realtime-agent-camera-screenshot-fallback-blocked/);
assert.match(generatedVoiceMedia, /_downscaleDataUrlForRealtime\(url, isVideo \? 960 : 1280/);
assert.match(generatedVoiceMedia, /function _queueMobileRealtimeAgentImage\(attachment, options = \{\}\)/);
assert.match(generatedVoiceMedia, /skipAutoFlush: true/);
assert.match(generatedVoiceMedia, /_mobileRealtimeLiveCameraAssociationTimeoutMs/);
assert.match(generatedVoiceMedia, /timeoutMs: 45_000/);
assert.doesNotMatch(generatedVoiceMedia, /type: 'input_image', detail: 'auto'/);
assert.match(generatedVoiceMedia, /realtime-agent-user-turn-held-open/);
assert.match(generatedVoiceMedia, /realtime-agent-user-turn-continued-after-pause/);
assert.match(generatedVoiceMedia, /dismissNewChatContextDock/);
assert.match(generatedVoiceMedia, /pm-chat-slash-loading/);
assert.match(generatedVoicePage, /_startMobileRealtimeLiveCameraVision\('voice_page_camera_opened'\)/);
assert.match(generatedVoicePage, /_sendMobileRealtimeAgentCameraSnapshot\(/);
assert.match(generatedCss, /body\.pm-mobile-context-popover-open \.pm-chat-body/);
assert.match(generatedCss, /--pm-mobile-chrome-top-offset: 16px/);
assert.match(generatedCss, /--pm-mobile-context-chip-top: calc\(/);
assert.doesNotMatch(generatedDesktop, /id="gateway-status-pill"/);

console.log('[test-mobile-voice-media-contract] passed: mobile spacing, selector haptics/close behavior, skill/$ composer picker, context chip position, first-send teardown, popover isolation, gateway UI contracts, camera turn timing, and xAI playback safeguards');
