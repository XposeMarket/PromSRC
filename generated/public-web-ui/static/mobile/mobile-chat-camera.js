/**
 * Mobile chat camera: capture sheet, photo/video capture, torch/flip, the
 * realtime-voice orb, voice-camera frame cache and the pairing QR scanner.
 *
 * Moved verbatim out of mobile-chat-page-runtime.js (route renderer split,
 * 2026-10-13). The renderer passes its closure values in once; the only
 * mutable renderer state read here goes through getComposerControlRestoreFocus.
 */
export function createMobileChatCamera(ctx) {
  const {
    MOBILE_CHAT_SESSION_ID,
    __pmChat,
    __pmRealtimeAgent,
    _awaitMobileRealtimeCameraOperation,
    _ensureDurableMobileVoiceSession,
    _isIosSafariBrowser,
    _normalizeMobileFile,
    _sendMobileRealtimeAgentCreateResponseFlag,
    _setMobileRealtimeCameraRuntime,
    _stageMobileRealtimeAgentImage,
    _startMobileRealtimeLiveCameraVision,
    _stopMobileRealtimeLiveCameraVision,
    _voiceAttachmentSessionAvailable,
    _voiceAttachmentSessionId,
    _voiceDebug,
    cameraCapture,
    cameraClose,
    cameraFlash,
    cameraFlip,
    cameraMore,
    cameraMoreMenu,
    cameraOrbCanvas,
    cameraPairScan,
    cameraPinchZoom,
    cameraRecordTimer,
    cameraShutter,
    cameraStatus,
    cameraVideo,
    closeAttachSheet,
    focusComposerAfterNativeUi,
    getPairingPayload,
    getPendingAttachments,
    holdComposerOpenForControl,
    input,
    navigate,
    pmHaptic,
    pmToast,
    renderPendingAttachments,
    setPendingGatewayPair,
    getComposerControlRestoreFocus,
  } = ctx;

  let cameraStream = null;
  let cameraRestoreComposerFocus = false;
  let cameraFacingMode = 'environment';
  let cameraTorchEnabled = false;
  let cameraOpening = false;
  let cameraCaptureOptions = { target: 'chat', onCapture: null, onVideoCapture: null };
  let cameraRecorder = null;
  let cameraRecordingChunks = [];
  let cameraRecordingStartedAt = 0;
  let cameraRecordingTimer = null;
  let cameraRecordingMaxTimer = null;
  let cameraHoldTimer = null;
  let cameraPointerActive = false;
  let cameraSuppressClick = false;
  let cameraOrbRaf = 0;
  let cameraOrbGl = null;
  let cameraPairScanTimer = null;
  let cameraPairScanDetector = null;
  let cameraPairScanCanvas = null;
  let cameraPairScanContext = null;
  let cameraPairScanLastAt = 0;
  let cameraPairScanBusy = false;
  let voiceCameraFrameCacheTimer = null;
  let voiceCameraFrameCache = null;
  let voiceCameraFrameCacheRefreshPending = false;
  let voiceCameraFrameCacheRefreshPromise = null;
  let voiceCameraLiveFrameReader = null;
  let voiceCameraFrameSequence = 0;
  let voiceCameraAutoCaptureInFlight = null;
  let voiceCameraAutoCaptureLastAt = 0;
  const CAMERA_RECORD_HOLD_MS = 420;
  const CAMERA_RECORD_MAX_MS = 12000;

  function setCameraStatus(text = '') {
    if (cameraStatus) cameraStatus.textContent = text;
  }

  function setCameraMoreMenuOpen(open = false) {
    const isOpen = open === true;
    cameraMoreMenu?.toggleAttribute('hidden', !isOpen);
    cameraMore?.classList.toggle('is-open', isOpen);
    cameraMore?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function setCameraTorchUi(enabled = false) {
    cameraTorchEnabled = enabled === true;
    cameraFlash?.setAttribute('aria-pressed', cameraTorchEnabled ? 'true' : 'false');
    cameraFlash?.classList.toggle('is-active', cameraTorchEnabled);
  }

  async function toggleCameraTorch() {
    const track = cameraStream?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.();
    if (!track?.applyConstraints || !capabilities?.torch) {
      pmToast('Flash is not available on this camera.', 'info');
      return;
    }
    const next = !cameraTorchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setCameraTorchUi(next);
    } catch (err) {
      setCameraTorchUi(false);
      pmToast(err?.message || 'Could not change the flash.', 'error');
    }
  }

  function _isCameraVoiceRealtimeTarget() {
    return String(cameraCaptureOptions?.target || '') === 'voice';
  }

  function stopCameraRealtimeOrb() {
    if (cameraOrbRaf) cancelAnimationFrame(cameraOrbRaf);
    cameraOrbRaf = 0;
    cameraCapture?.classList.remove('voice-realtime');
    cameraShutter?.classList.remove('voice-realtime');
    if (cameraOrbGl?.gl) {
      try { cameraOrbGl.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    }
    cameraOrbGl = null;
  }

  function _resizeCameraRealtimeOrbCanvas() {
    if (!cameraOrbCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = cameraOrbCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round((rect.width || cameraOrbCanvas.clientWidth || 76) * dpr));
    const height = Math.max(1, Math.round((rect.height || cameraOrbCanvas.clientHeight || 76) * dpr));
    if (cameraOrbCanvas.width !== width || cameraOrbCanvas.height !== height) {
      cameraOrbCanvas.width = width;
      cameraOrbCanvas.height = height;
      cameraOrbGl?.gl?.viewport?.(0, 0, width, height);
    }
  }

  function _initCameraRealtimeOrbGl() {
    if (cameraOrbGl || !cameraOrbCanvas) return cameraOrbGl;
    const gl = cameraOrbCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) return null;

    const vert = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
    const frag = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[8];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float sphere = length(uv);
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);
  vec3 col = vec3(0.0);

  for (int i = 0; i < 12; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float rim = smoothstep(0.50, 0.34, sphere);
  float edge = smoothstep(0.28, 0.52, sphere);
  col += vec3(1.0) * edge * 0.14;
  col *= rim;

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(max(lum, rim * 0.08), 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * uOpacity, alpha);
}
`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[camera orb] shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[camera orb] program link failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    const uniforms = {};
    [
      'uTime', 'uResolution', 'uColors', 'uColorCount', 'uStrandCount', 'uSpeed',
      'uAmplitude', 'uWaviness', 'uThickness', 'uGlow', 'uTaper', 'uSpread',
      'uHueShift', 'uIntensity', 'uOpacity', 'uScale', 'uSaturation',
    ].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, name); });
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    cameraOrbGl = { gl, program, buffer, position, uniforms };
    return cameraOrbGl;
  }

  function _cameraRealtimeOrbPalette() {
    const hex = ['#F97316', '#7C3AED', '#06B6D4', '#F472B6', '#EAB308'];
    const values = [];
    for (let i = 0; i < 8; i += 1) {
      const raw = hex[i] || hex[hex.length - 1];
      const value = raw.replace('#', '');
      values.push(
        parseInt(value.slice(0, 2), 16) / 255,
        parseInt(value.slice(2, 4), 16) / 255,
        parseInt(value.slice(4, 6), 16) / 255,
      );
    }
    return new Float32Array(values);
  }

  function _drawCameraRealtimeOrb(nowMs = performance.now()) {
    if (!_isCameraVoiceRealtimeTarget() || !cameraCapture || cameraCapture.hidden) {
      stopCameraRealtimeOrb();
      return;
    }
    cameraCapture.classList.add('voice-realtime');
    _resizeCameraRealtimeOrbCanvas();
    const state = _initCameraRealtimeOrbGl();
    if (state) {
      const { gl, program, buffer, position, uniforms } = state;
      const width = cameraOrbCanvas.width || 1;
      const height = cameraOrbCanvas.height || 1;
      const recording = !!cameraRecorder && cameraRecorder.state !== 'inactive';
      const t = nowMs * 0.001;
      const pulse = recording ? 0.78 : 0.36 + Math.sin(t * 1.45) * 0.08;
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform2f(uniforms.uResolution, width, height);
      gl.uniform3fv(uniforms.uColors, _cameraRealtimeOrbPalette());
      gl.uniform1i(uniforms.uColorCount, 5);
      gl.uniform1i(uniforms.uStrandCount, 5);
      gl.uniform1f(uniforms.uSpeed, recording ? 0.58 : 0.42);
      gl.uniform1f(uniforms.uAmplitude, 1.18 + pulse * 0.22);
      gl.uniform1f(uniforms.uWaviness, 1.3 + pulse * 0.04);
      gl.uniform1f(uniforms.uThickness, 0.9 + pulse * 0.05);
      gl.uniform1f(uniforms.uGlow, 1.86 + pulse * 0.42);
      gl.uniform1f(uniforms.uTaper, 4.3);
      gl.uniform1f(uniforms.uSpread, 1);
      gl.uniform1f(uniforms.uHueShift, 0);
      gl.uniform1f(uniforms.uIntensity, 0.46 + pulse * 0.26);
      gl.uniform1f(uniforms.uOpacity, 1);
      gl.uniform1f(uniforms.uScale, 1.78);
      gl.uniform1f(uniforms.uSaturation, 1.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    cameraOrbRaf = requestAnimationFrame(_drawCameraRealtimeOrb);
  }

  function startCameraRealtimeOrb() {
    if (!_isCameraVoiceRealtimeTarget() || cameraOrbRaf) return;
    cameraOrbRaf = requestAnimationFrame(_drawCameraRealtimeOrb);
  }

  function cameraVideoMimeType() {
    const candidates = _isIosSafariBrowser()
      ? ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  function cameraVideoExtension(mimeType = '') {
    return String(mimeType || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
  }

  function setCameraRecordingUi(recording) {
    cameraCapture?.classList.toggle('recording', !!recording);
    if (cameraRecordTimer) cameraRecordTimer.hidden = !recording;
    if (!recording && cameraRecordTimer) cameraRecordTimer.textContent = '0.0s';
    if (_isCameraVoiceRealtimeTarget()) startCameraRealtimeOrb();
  }

  function updateCameraRecordingTimer() {
    if (!cameraRecordTimer || !cameraRecordingStartedAt) return;
    const elapsed = Math.max(0, Date.now() - cameraRecordingStartedAt);
    cameraRecordTimer.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  }

  function clearCameraRecordingTimers() {
    if (cameraRecordingTimer) clearInterval(cameraRecordingTimer);
    if (cameraRecordingMaxTimer) clearTimeout(cameraRecordingMaxTimer);
    cameraRecordingTimer = null;
    cameraRecordingMaxTimer = null;
  }

  async function extractCameraVideoFrames(blob, options = {}) {
    const maxFrames = Math.max(1, Math.min(12, Number(options.maxFrames || 12) || 12));
    const quality = Math.max(0.45, Math.min(0.88, Number(options.quality || 0.72) || 0.72));
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    const waitFor = (eventName) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out reading video ${eventName}.`)), 4500);
      video.addEventListener(eventName, () => { clearTimeout(timeout); resolve(true); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not read recorded video.')); }, { once: true });
    });
    try {
      await waitFor('loadedmetadata');
      const duration = Math.min(12, Math.max(0.1, Number(video.duration || 0) || 0.1));
      const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration)));
      const canvas = document.createElement('canvas');
      // Downscale frames (longest side <= 640) so up to 12 of them fit in one
      // realtime data-channel message without exceeding the SCTP size limit.
      const rawW = Math.max(1, Number(video.videoWidth || cameraVideo?.videoWidth || 640) || 640);
      const rawH = Math.max(1, Number(video.videoHeight || cameraVideo?.videoHeight || 480) || 480);
      const frameScale = Math.min(1, 640 / Math.max(rawW, rawH));
      const width = Math.max(1, Math.round(rawW * frameScale));
      const height = Math.max(1, Math.round(rawH * frameScale));
      canvas.width = width;
      canvas.height = height;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('Could not sample video frames.');
      const frames = [];
      for (let i = 0; i < count; i += 1) {
        const rawT = count === 1 ? Math.min(0.08, duration / 2) : (duration * i) / Math.max(1, count - 1);
        const t = Math.min(Math.max(0.05, rawT), Math.max(0.05, duration - 0.05));
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timed out sampling video frame.')), 3500);
          video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(true); }, { once: true });
          video.currentTime = Math.max(0, t);
        });
        ctx2d.drawImage(video, 0, 0, width, height);
        frames.push({
          dataUrl: canvas.toDataURL('image/jpeg', quality),
          at: t,
          width,
          height,
          mimeType: 'image/jpeg',
          name: `video-frame-${i + 1}.jpg`,
        });
      }
      return { frames, durationMs: Math.round(duration * 1000), width, height };
    } finally {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }

  async function handleCameraVideoBlob(blob, mimeType = '') {
    const type = mimeType || blob?.type || 'video/webm';
    const file = new File([blob], `prometheus-camera-video-${Date.now()}.${cameraVideoExtension(type)}`, { type });
    const target = String(cameraCaptureOptions?.target || 'chat');
    if (target === 'voice' && typeof cameraCaptureOptions?.onVideoCapture === 'function') {
      const onVideoCapture = cameraCaptureOptions.onVideoCapture;
      // ~1 frame/sec across the clip (12s cap → up to 12 frames) so the voice
      // agent gets a temporal sequence it can "watch".
      const sampled = await extractCameraVideoFrames(blob, { maxFrames: 12, quality: 0.72 });
      try {
        await onVideoCapture({ file, blob, mimeType: type, ...sampled });
      } finally {
        // Let the voice callback enqueue/inject the sampled frames before the
        // camera teardown clears the live-camera reader and response state.
        stopCameraCapture();
      }
      pmToast('Video frames sent to voice.', 'success');
      return;
    }
    const normalized = await _normalizeMobileFile(file);
    getPendingAttachments().push(normalized);
    renderPendingAttachments();
    stopCameraCapture();
    pmToast('Video attached.', 'success');
  }

  function stopCameraRecording() {
    if (!cameraRecorder) return;
    try {
      if (cameraRecorder.state !== 'inactive') cameraRecorder.stop();
    } catch {}
  }

  function startCameraRecording() {
    if (!cameraStream || cameraRecorder || typeof MediaRecorder === 'undefined') {
      if (typeof MediaRecorder === 'undefined') pmToast('Video recording is not available in this browser.', 'error');
      return;
    }
    const mimeType = cameraVideoMimeType();
    try {
      cameraRecordingChunks = [];
      cameraRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : undefined);
      cameraRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) cameraRecordingChunks.push(event.data);
      });
      cameraRecorder.addEventListener('stop', () => {
        const chunks = cameraRecordingChunks.slice();
        const finalType = mimeType || cameraRecorder?.mimeType || chunks[0]?.type || 'video/webm';
        cameraRecorder = null;
        cameraRecordingChunks = [];
        clearCameraRecordingTimers();
        setCameraRecordingUi(false);
        cameraSuppressClick = true;
        if (!chunks.length) {
          setCameraStatus('');
          pmToast('No video was recorded.', 'info');
          return;
        }
        setCameraStatus('Processing video...');
        handleCameraVideoBlob(new Blob(chunks, { type: finalType }), finalType)
          .catch((err) => {
            setCameraStatus('');
            pmToast(err?.message || 'Could not process video.', 'error');
          });
      });
      cameraRecorder.start(250);
      cameraRecordingStartedAt = Date.now();
      setCameraRecordingUi(true);
      updateCameraRecordingTimer();
      cameraRecordingTimer = setInterval(updateCameraRecordingTimer, 100);
      cameraRecordingMaxTimer = setTimeout(stopCameraRecording, CAMERA_RECORD_MAX_MS);
      setCameraStatus('Recording...');
    } catch (err) {
      cameraRecorder = null;
      clearCameraRecordingTimers();
      setCameraRecordingUi(false);
      pmToast(err?.message || 'Could not start video recording.', 'error');
    }
  }

  function stopCameraCapture({ restoreComposerFocus = true } = {}) {
    const shouldRestoreComposer = restoreComposerFocus && cameraRestoreComposerFocus;
    if (restoreComposerFocus) cameraRestoreComposerFocus = false;
    if (cameraPairScanTimer) cancelAnimationFrame(cameraPairScanTimer);
    cameraPairScanTimer = null;
    cameraPairScanDetector = null;
    cameraPairScanCanvas = null;
    cameraPairScanContext = null;
    cameraPairScanLastAt = 0;
    cameraPairScanBusy = false;
    if (cameraHoldTimer) clearTimeout(cameraHoldTimer);
    cameraHoldTimer = null;
    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
      try { cameraRecorder.stop(); } catch {}
    }
    cameraRecorder = null;
    cameraRecordingChunks = [];
    cameraRecordingStartedAt = 0;
    clearCameraRecordingTimers();
    setCameraRecordingUi(false);
    setCameraMoreMenuOpen(false);
    setCameraTorchUi(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      cameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
    cameraPinchZoom?.reset();
    if (cameraCapture) {
      cameraCapture.classList.remove('open');
      setTimeout(() => {
        if (!cameraCapture.classList.contains('open')) {
          cameraCapture.hidden = true;
          document.body.classList.remove('pm-camera-open');
        }
      }, 180);
    } else document.body.classList.remove('pm-camera-open');
    cameraOpening = false;
    cameraCaptureOptions = { target: 'chat', onCapture: null, onVideoCapture: null };
    cameraShutter?.removeAttribute('disabled');
    stopCameraRealtimeOrb();
    stopVoiceCameraFrameCache();
    if (shouldRestoreComposer) {
      setTimeout(() => {
        focusComposerAfterNativeUi({ releaseHold: 'camera' });
      }, 200);
    }
  }

  async function openCameraCapture(options = {}) {
    const target = String(options.target || 'chat').trim() || 'chat';
    const restoreComposerFocus = target === 'chat'
      && (document.activeElement === input || getComposerControlRestoreFocus() || cameraRestoreComposerFocus);
    closeAttachSheet();
    if (!navigator.mediaDevices?.getUserMedia) {
      pmToast('Camera preview is not available in this browser.', 'error');
      return;
    }
    if (!cameraCapture || !cameraVideo) return;
    stopCameraCapture({ restoreComposerFocus: false });
    cameraRestoreComposerFocus = restoreComposerFocus;
    if (restoreComposerFocus) holdComposerOpenForControl('camera', { restoreFocus: true });
    cameraCaptureOptions = {
      target,
      onCapture: typeof options.onCapture === 'function' ? options.onCapture : null,
      onVideoCapture: typeof options.onVideoCapture === 'function' ? options.onVideoCapture : null,
    };
    cameraOpening = true;
    document.body.classList.add('pm-camera-open');
    setCameraMoreMenuOpen(false);
    setCameraTorchUi(false);
    cameraCapture.hidden = false;
    const voiceTarget = target === 'voice';
    cameraCapture.classList.toggle('voice-realtime', voiceTarget);
    cameraShutter?.classList.toggle('voice-realtime', voiceTarget);
    cameraShutter?.setAttribute('aria-label', voiceTarget ? 'Capture image or hold to record video' : 'Take picture');
    startCameraRealtimeOrb();
    setCameraStatus('Opening camera...');
    requestAnimationFrame(() => cameraCapture.classList.add('open'));
    try {
      const constraints = {
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStream = stream;
      const track = stream.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.() || {};
      cameraFlash?.toggleAttribute('disabled', !capabilities.torch);
      cameraPinchZoom?.setTrack(track);
      if (track?.applyConstraints && track.getCapabilities) {
        try {
          const capabilities = track.getCapabilities();
          const qualityConstraints = {};
          const maxWidth = Number(capabilities.width?.max || 0);
          const maxHeight = Number(capabilities.height?.max || 0);
          if (maxWidth >= 1920) qualityConstraints.width = { ideal: Math.min(maxWidth, 2560) };
          if (maxHeight >= 1440) qualityConstraints.height = { ideal: Math.min(maxHeight, 1920) };
          if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
            qualityConstraints.focusMode = 'continuous';
          }
          if (Object.keys(qualityConstraints).length) await track.applyConstraints(qualityConstraints);
        } catch (err) {
          console.debug('[mobile camera] high-quality constraints unavailable:', err?.message || err);
        }
      }
      cameraVideo.srcObject = stream;
      cameraVideo.muted = true;
      cameraVideo.setAttribute('playsinline', '');
      await cameraVideo.play();
      setCameraStatus('');
      if (target === 'voice') startVoiceCameraFrameCache();
    } catch (err) {
      stopCameraCapture();
      pmToast(err?.message || 'Could not open camera.', 'error');
    } finally {
      cameraOpening = false;
    }
  }

  async function flipCameraCapture() {
    if (cameraOpening) return;
    const options = cameraCaptureOptions || { target: 'chat', onCapture: null };
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    await openCameraCapture(options);
  }

  function decodePairingQrFrameWithJsQr() {
    if (typeof window.jsQR !== 'function' || !cameraVideo) return '';
    const rawWidth = Number(cameraVideo.videoWidth || 0);
    const rawHeight = Number(cameraVideo.videoHeight || 0);
    if (!rawWidth || !rawHeight) return '';
    const maxDimension = 960;
    const scale = Math.min(1, maxDimension / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    if (!cameraPairScanCanvas) cameraPairScanCanvas = document.createElement('canvas');
    if (cameraPairScanCanvas.width !== width || cameraPairScanCanvas.height !== height) {
      cameraPairScanCanvas.width = width;
      cameraPairScanCanvas.height = height;
      cameraPairScanContext = cameraPairScanCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!cameraPairScanContext) return '';
    cameraPairScanContext.drawImage(cameraVideo, 0, 0, width, height);
    const frame = cameraPairScanContext.getImageData(0, 0, width, height);
    const code = window.jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
    return String(code?.data || '').trim();
  }

  async function startPairingQrScan() {
    const hasNativeQrDecoder = typeof window.BarcodeDetector === 'function';
    const hasBundledQrDecoder = typeof window.jsQR === 'function';
    if (!hasNativeQrDecoder && !hasBundledQrDecoder) {
      pmToast('QR scanning is unavailable in this browser. Use Gateway Connections → Add gateway and enter the short-lived pair code.', 'info');
      return false;
    }
    cameraPairScanDetector = null;
    if (hasNativeQrDecoder) {
      try {
        cameraPairScanDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        cameraPairScanDetector = null;
      }
    }
    if (!cameraPairScanDetector && !hasBundledQrDecoder) {
      pmToast('This camera does not expose a safe QR decoder. Use the pair-code fallback.', 'info');
      return false;
    }
    await openCameraCapture({ target: 'pairing' });
    if (!cameraStream || !cameraVideo || (!cameraPairScanDetector && !hasBundledQrDecoder)) return false;
    cameraPairScanBusy = false;
    cameraPairScanLastAt = 0;
    cameraShutter?.setAttribute('disabled', 'disabled');
    cameraShutter?.setAttribute('aria-label', 'QR scanner active');
    setCameraStatus('Point the camera at a Prometheus pairing QR');
    const scan = async (now = performance.now()) => {
      if (!cameraStream || cameraCapture?.hidden || cameraCaptureOptions?.target !== 'pairing') return;
      if (!cameraPairScanBusy && now - cameraPairScanLastAt >= 140) {
        cameraPairScanBusy = true;
        cameraPairScanLastAt = now;
        try {
          const raw = cameraPairScanDetector
            ? String((await cameraPairScanDetector.detect(cameraVideo))?.[0]?.rawValue || '').trim()
            : decodePairingQrFrameWithJsQr();
          if (raw) {
            let parsedUrl = null;
            try { parsedUrl = new URL(raw); } catch {}
            const pairValue = parsedUrl && ['http:', 'https:'].includes(parsedUrl.protocol)
              ? parsedUrl.searchParams.get('pair')
              : '';
            const payload = getPairingPayload(pairValue || '');
            if (payload && payload.origin === parsedUrl.origin) {
              stopCameraCapture();
              // This is the deliberate multi-gateway path. Keep the current
              // PWA document/origin so its catalog remains the hub, then let
              // the pairing page claim and poll the scanned target directly.
              // The validated payload is the only thing carried forward;
              // arbitrary QR URLs and unrelated query data are discarded.
              if (!setPendingGatewayPair(pairValue)) {
                setCameraStatus('That pairing QR is no longer valid');
                cameraPairScanBusy = false;
                return;
              }
              navigate?.('#mobile/pair/add');
              return;
            }
            setCameraStatus('That is not a valid Prometheus pairing QR');
          }
        } catch {}
        cameraPairScanBusy = false;
      }
      cameraPairScanTimer = requestAnimationFrame(scan);
    };
    cameraPairScanTimer = requestAnimationFrame(scan);
    return true;
  }

  const previousPairingScanner = window.__pmMobilePairingScanner;
  const pairingScannerBridge = () => { startPairingQrScan().catch(() => {}); };
  window.__pmMobilePairingScanner = pairingScannerBridge;
  try {
    if (sessionStorage.getItem('pm_open_pairing_scanner') === '1') {
      sessionStorage.removeItem('pm_open_pairing_scanner');
      setTimeout(() => startPairingQrScan().catch(() => {}), 120);
    }
  } catch {}

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.96) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture camera frame.'));
      }, type, quality);
    });
  }

  function readCameraFrameDataUrl(maxDim = 1024, quality = 0.78) {
    if (!cameraVideo || !cameraStream) return null;
    const capturedAt = Date.now();
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) return null;
    const scale = Math.min(1, Math.max(320, Number(maxDim) || 1024) / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', Math.max(0.5, Math.min(0.9, Number(quality) || 0.78))),
      width: canvas.width,
      height: canvas.height,
      capturedAt,
      encodedAt: Date.now(),
      frameId: `chat_camera_${++voiceCameraFrameSequence}`,
    };
  }

  function stopVoiceCameraFrameCache() {
    const restoreRealtimeResponseCreation = __pmRealtimeAgent?.liveCameraFrameReader === voiceCameraLiveFrameReader
      && (__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening';
    const restoreViaTurnGate = __pmRealtimeAgent?.liveCameraVision?.responseGateActive === true;
    if (voiceCameraFrameCacheTimer) clearInterval(voiceCameraFrameCacheTimer);
    voiceCameraFrameCacheTimer = null;
    voiceCameraFrameCache = null;
    voiceCameraFrameCacheRefreshPending = false;
    voiceCameraFrameCacheRefreshPromise = null;
    if (__pmRealtimeAgent?.liveCameraFrameReader === voiceCameraLiveFrameReader) {
      __pmRealtimeAgent.liveCameraFrameReader = null;
    }
    if (__pmRealtimeAgent?.liveCameraFrameAsyncReader === refreshVoiceCameraFrameCache) {
      __pmRealtimeAgent.liveCameraFrameAsyncReader = null;
    }
    voiceCameraLiveFrameReader = null;
    if (restoreRealtimeResponseCreation || restoreViaTurnGate || __pmRealtimeAgent?.cameraRuntime?.open === true) {
      _setMobileRealtimeCameraRuntime(false, { source: 'chat_camera', reason: 'chat_camera_closed' });
    }
    _stopMobileRealtimeLiveCameraVision('camera_closed');
    if (restoreRealtimeResponseCreation && !restoreViaTurnGate) _sendMobileRealtimeAgentCreateResponseFlag(true);
    if (__pmRealtimeAgent?.autoCaptureCameraFrames === autoCaptureVoiceCameraFrames) {
      __pmRealtimeAgent.autoCaptureCameraFrames = null;
    }
  }

  function readVoiceCameraFrameDataUrlAsync(maxDim = 768, quality = 0.68) {
    if (!cameraVideo || !cameraStream) return Promise.resolve(null);
    const capturedAt = Date.now();
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) return Promise.resolve(null);
    const scale = Math.min(1, Math.max(320, Number(maxDim) || 768) / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(readCameraFrameDataUrl(maxDim, quality));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve({
          dataUrl: String(reader.result || ''),
          width: canvas.width,
          height: canvas.height,
          capturedAt,
          encodedAt: Date.now(),
          frameId: `chat_camera_${++voiceCameraFrameSequence}`,
        });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }, 'image/jpeg', Math.max(0.5, Math.min(0.9, Number(quality) || 0.68)));
    });
  }

  async function refreshVoiceCameraFrameCache(options = {}) {
    if (String(cameraCaptureOptions?.target || '') !== 'voice') return voiceCameraFrameCache;
    const force = options?.force === true;
    const requestedAt = Date.now();
    const previous = voiceCameraFrameCacheRefreshPromise;
    if (previous) {
      let previousTimedOut = false;
      const existing = await _awaitMobileRealtimeCameraOperation(
        () => previous,
        900,
        () => { previousTimedOut = true; },
      );
      if (previousTimedOut) {
        _voiceDebug('realtime-agent-live-camera-cache-refresh-timeout', { force });
        // A stalled toBlob/FileReader must not poison every later turn-boundary
        // refresh by leaving the old promise as the only cache source.
      } else {
        const existingCapturedAt = Number(existing?.capturedAt || 0) || 0;
        // A turn-boundary request may await a cache refresh that started a few
        // milliseconds earlier, but it must not accept an older timer result as
        // the turn's frame when that refresh has already gone stale.
        if (!force || existingCapturedAt >= requestedAt - 150) return existing;
      }
    }
    // Live vision is sampled once per spoken second. Keep those frames lighter
    // than a user-captured photo. `toBlob`/FileReader keeps JPEG encoding off
    // the synchronous live-audio read path on iOS. A forced read retries briefly
    // while Safari finishes exposing the first video frame.
    const work = (async () => {
      let frame = null;
      for (let attempt = 0; attempt < (force ? 3 : 1); attempt++) {
        frame = await _awaitMobileRealtimeCameraOperation(
          () => readVoiceCameraFrameDataUrlAsync(768, 0.68),
          force ? 500 : 800,
        );
        if (frame?.dataUrl) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (frame?.dataUrl && String(cameraCaptureOptions?.target || '') === 'voice' && cameraStream) {
        voiceCameraFrameCache = frame;
      }
      return frame?.dataUrl ? frame : (force ? null : voiceCameraFrameCache);
    })().catch(() => (force ? null : voiceCameraFrameCache));
    let promise = null;
    promise = work.finally(() => {
      if (voiceCameraFrameCacheRefreshPromise === promise) voiceCameraFrameCacheRefreshPromise = null;
    });
    voiceCameraFrameCacheRefreshPromise = promise;
    return promise;
  }

  function scheduleVoiceCameraFrameCacheRefresh() {
    if (voiceCameraFrameCacheRefreshPending || String(cameraCaptureOptions?.target || '') !== 'voice') return;
    voiceCameraFrameCacheRefreshPending = true;
    const run = () => {
      voiceCameraFrameCacheRefreshPending = false;
      if (String(cameraCaptureOptions?.target || '') === 'voice' && cameraStream) refreshVoiceCameraFrameCache();
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 900 });
    else setTimeout(run, 0);
  }

  function startVoiceCameraFrameCache() {
    stopVoiceCameraFrameCache();
    __pmRealtimeAgent.autoCaptureCameraFrames = autoCaptureVoiceCameraFrames;
    voiceCameraLiveFrameReader = () => {
      const now = Date.now();
      const cached = voiceCameraFrameCache;
      if (cached?.dataUrl && now - Number(cached.capturedAt || 0) >= 2000) scheduleVoiceCameraFrameCacheRefresh();
      // Never synchronously JPEG-encode a fresh frame from the audio/live-feed
      // read path. A slightly older cached frame is preferable to blocking the
      // realtime output callback while the camera is open.
      const frame = cached?.dataUrl ? cached : null;
      return frame?.dataUrl ? { ...frame } : null;
    };
    __pmRealtimeAgent.liveCameraFrameReader = voiceCameraLiveFrameReader;
    __pmRealtimeAgent.liveCameraFrameAsyncReader = refreshVoiceCameraFrameCache;
    _setMobileRealtimeCameraRuntime(true, { source: 'chat_camera', reason: 'chat_camera_opened' });
    _startMobileRealtimeLiveCameraVision('chat_camera_opened');
    // Disable server-VAD auto responses before the first camera turn reaches
    // speech_stopped. Sending this at camera-open time closes the race where
    // response.created arrives before the per-turn camera gate can be applied.
    if ((__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening') {
      _sendMobileRealtimeAgentCreateResponseFlag(false);
    }
    refreshVoiceCameraFrameCache();
    voiceCameraFrameCacheTimer = setInterval(scheduleVoiceCameraFrameCacheRefresh, 1000);
  }

  function stageVoiceCameraDataUrl(dataUrl, sid, name, options = {}) {
    const url = String(dataUrl || '').trim();
    if (!url.startsWith('data:image')) return false;
    _stageMobileRealtimeAgentImage({
      dataUrl: url,
      name: name || `Live camera frame ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`,
      mimeType: 'image/jpeg',
      base64: '',
    }, sid, { toast: options.toast !== false });
    return true;
  }

  async function autoCaptureVoiceCameraFrames(reason = 'speech_started', options = {}) {
    if (String(cameraCaptureOptions?.target || '') !== 'voice') return false;
    if (!cameraStream || !cameraVideo || cameraOpening || cameraRecorder) return false;
    if (!_voiceAttachmentSessionAvailable()) return false;
    const now = Date.now();
    const cooldownMs = Math.max(400, Number(options.cooldownMs || 1400) || 1400);
    if (voiceCameraAutoCaptureInFlight || now - voiceCameraAutoCaptureLastAt < cooldownMs) return false;
    voiceCameraAutoCaptureLastAt = now;
    voiceCameraAutoCaptureInFlight = (async () => {
      let sid = _voiceAttachmentSessionId();
      if (sid === MOBILE_CHAT_SESSION_ID) {
        sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'voice_camera_auto_session_created' });
      }
      const frames = [];
      let cached = voiceCameraFrameCache && now - Number(voiceCameraFrameCache.capturedAt || 0) < 2600
        ? voiceCameraFrameCache
        : await refreshVoiceCameraFrameCache();
      if (cached?.dataUrl) frames.push(cached);
      const wantCount = Math.max(1, Math.min(2, Number(options.count || 2) || 2));
      if (frames.length < wantCount) {
        await new Promise((resolve) => setTimeout(resolve, 260));
        const fresh = await refreshVoiceCameraFrameCache();
        if (fresh?.dataUrl && fresh.dataUrl !== frames[0]?.dataUrl) frames.push(fresh);
      }
      const staged = [];
      frames.slice(0, wantCount).forEach((frame, index) => {
        if (stageVoiceCameraDataUrl(frame.dataUrl, sid, index === 0 ? 'Live camera view' : 'Live camera follow-up view', { toast: false })) {
          staged.push(frame.dataUrl);
        }
      });
      if (staged.length) {
        _voiceDebug('voice-camera-auto-captured', { reason, frames: staged.length });
      }
      return staged.length > 0;
    })().catch((err) => {
      _voiceDebug('voice-camera-auto-capture-failed', { reason, message: err?.message || String(err) });
      return false;
    }).finally(() => {
      voiceCameraAutoCaptureInFlight = null;
    });
    return voiceCameraAutoCaptureInFlight;
  }

  async function captureCameraFrame() {
    if (!cameraVideo || !cameraStream) return;
    try { pmHaptic?.(12); } catch {}
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) {
      pmToast('Camera is still warming up.', 'info');
      return;
    }
    try {
      setCameraStatus('Capturing...');
      let blob = null;
      const track = cameraStream.getVideoTracks?.()[0];
      if (track && typeof window.ImageCapture === 'function' && (cameraPinchZoom?.hasHardwareZoom?.() || (cameraPinchZoom?.getZoom?.() || 1) <= 1.001)) {
        try {
          const imageCapture = new window.ImageCapture(track);
          const photoCapabilities = await imageCapture.getPhotoCapabilities?.();
          const photoSettings = {};
          const photoWidth = Number(photoCapabilities?.imageWidth?.max || 0);
          const photoHeight = Number(photoCapabilities?.imageHeight?.max || 0);
          if (photoWidth > 0) photoSettings.imageWidth = photoWidth;
          if (photoHeight > 0) photoSettings.imageHeight = photoHeight;
          blob = await imageCapture.takePhoto(photoSettings);
        } catch (err) {
          console.debug('[mobile camera] still capture fallback:', err?.message || err);
        }
      }
      if (!blob) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not prepare camera capture.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const zoom = Math.max(1, Number(cameraPinchZoom?.getZoom?.() || 1) || 1);
        const sourceWidth = width / zoom;
        const sourceHeight = height / zoom;
        const sourceX = (width - sourceWidth) / 2;
        const sourceY = (height - sourceHeight) / 2;
        ctx.drawImage(cameraVideo, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
        blob = await canvasToBlob(canvas);
      }
      const mimeType = blob.type || 'image/jpeg';
      const file = new File([blob], `prometheus-camera-${Date.now()}.jpg`, { type: mimeType });
      const normalized = await _normalizeMobileFile(file);
      const target = String(cameraCaptureOptions?.target || 'chat');
      if (target === 'voice' && typeof cameraCaptureOptions?.onCapture === 'function') {
        const onCapture = cameraCaptureOptions.onCapture;
        try {
          await onCapture(normalized, { file, dataUrl: normalized.dataUrl, blob });
        } finally {
          // The callback owns voice delivery. Do not invalidate its
          // connection/reader until the captured image has been delivered.
          stopCameraCapture();
        }
      } else {
        getPendingAttachments().push(normalized);
        renderPendingAttachments();
        stopCameraCapture();
      }
      pmToast(target === 'voice' ? 'Snapshot sent to voice.' : 'Snapshot attached.', 'success');
    } catch (err) {
      setCameraStatus('');
      pmToast(err?.message || 'Could not capture image.', 'error');
    }
  }

  // Control wiring stays a separate call so it runs at the same point in the
  // route render as before the split.
  function bindControls() {
    cameraClose?.addEventListener('click', stopCameraCapture);
    cameraMore?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCameraMoreMenuOpen(!cameraMore.classList.contains('is-open'));
    });
    cameraFlash?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCameraTorch().catch(() => {});
    });
    cameraPairScan?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCameraMoreMenuOpen(false);
      startPairingQrScan().catch(() => {});
    });
    cameraFlip?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCameraMoreMenuOpen(false);
      flipCameraCapture().catch(() => {});
    });
    function clearCameraHoldTimer() {
      if (cameraHoldTimer) clearTimeout(cameraHoldTimer);
      cameraHoldTimer = null;
    }
    function beginCameraShutterPress(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!cameraStream || cameraOpening || cameraPointerActive) return;
      try { pmHaptic?.(10); } catch {}
      cameraPointerActive = true;
      cameraSuppressClick = false;
      clearCameraHoldTimer();
      cameraHoldTimer = setTimeout(() => {
        cameraHoldTimer = null;
        if (!cameraPointerActive) return;
        cameraSuppressClick = true;
        try { pmHaptic?.(16); } catch {}
        startCameraRecording();
      }, CAMERA_RECORD_HOLD_MS);
    }
    function endCameraShutterPress(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!cameraPointerActive) return;
      cameraPointerActive = false;
      if (cameraRecorder && cameraRecorder.state !== 'inactive') {
        clearCameraHoldTimer();
        stopCameraRecording();
        return;
      }
      if (cameraHoldTimer) {
        clearCameraHoldTimer();
        captureCameraFrame().catch(() => {});
        return;
      }
      setTimeout(() => { cameraSuppressClick = false; }, 250);
    }
    function cancelCameraShutterPress(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      cameraPointerActive = false;
      clearCameraHoldTimer();
      if (cameraRecorder && cameraRecorder.state !== 'inactive') stopCameraRecording();
    }
    cameraShutter?.addEventListener('contextmenu', (event) => event.preventDefault());
    cameraShutter?.addEventListener('selectstart', (event) => event.preventDefault());
    cameraShutter?.addEventListener('click', (event) => {
      if (cameraSuppressClick) {
        event.preventDefault();
        event.stopPropagation();
        cameraSuppressClick = false;
      }
    });
    cameraShutter?.addEventListener('pointerdown', beginCameraShutterPress);
    cameraShutter?.addEventListener('pointerup', endCameraShutterPress);
    cameraShutter?.addEventListener('pointercancel', cancelCameraShutterPress);
    cameraShutter?.addEventListener('pointerleave', cancelCameraShutterPress);
    cameraShutter?.addEventListener('touchstart', beginCameraShutterPress, { passive: false });
    cameraShutter?.addEventListener('touchend', endCameraShutterPress, { passive: false });
    cameraShutter?.addEventListener('touchcancel', cancelCameraShutterPress, { passive: false });
    window.addEventListener('pagehide', stopCameraCapture, { once: true });
    if (__pmChat.cameraVisibilityHandler) document.removeEventListener('visibilitychange', __pmChat.cameraVisibilityHandler);
    __pmChat.cameraVisibilityHandler = () => {
      if (document.visibilityState === 'hidden' && !cameraOpening) stopCameraCapture();
    };
    document.addEventListener('visibilitychange', __pmChat.cameraVisibilityHandler);
  }

  return {
    openCameraCapture,
    stopCameraCapture,
    bindControls,
    getCameraStream: () => cameraStream,
    restorePairingScanner() {
      if (window.__pmMobilePairingScanner === pairingScannerBridge) window.__pmMobilePairingScanner = previousPairingScanner;
    },
  };
}
