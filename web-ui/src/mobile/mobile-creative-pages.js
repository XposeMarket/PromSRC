// Creative route owner. Loaded only when its route or a shared dependent feature is requested.
import { ICONS, escapeHtml, renderMobileHeader, wireHeaderActions } from './mobile-shell.js';
import { pmToast } from './mobile-feedback.js';
import { formatMobileTimeAgo as _formatTimeAgo } from './mobile-format.js';
import {
  MOBILE_CHAT_SESSION_ID,
  buildInlineMediaUrl,
  creativeExtractLayers,
  loadCanvasImageDataUrl,
  loadCreativeGallery,
  mobileGatewayFetch,
  streamChat,
  uploadMobileBinaryFile,
} from './mobile-api.js';

/* ---------------- CREATIVE ---------------- */

const PM_CREATIVE_PROVIDERS = {
  image: [
    { id: 'xai',     label: 'xAI Image',     provider: 'xai',    model: '' },
    { id: 'openai',  label: 'OpenAI Image',  provider: 'openai', model: '' },
    { id: 'hf',      label: 'HyperFrames',   provider: 'hf',     model: '' },
  ],
  video: [
    { id: 'xai',     label: 'xAI Video',     provider: 'xai',    model: '' },
    { id: 'hf',      label: 'HyperFrames',   provider: 'hf',     model: '' },
  ],
};

const PM_CREATIVE_TEMPLATES = [
  { id: 'chibi',     title: 'Chibi',                 hint: 'Cute & stylized',     prompt: 'Adorable chibi-style character portrait, soft lighting, vivid colors, big expressive eyes, clean studio background, high-detail illustration.' },
  { id: 'headshot',  title: 'Professional Headshot', hint: 'Clean & polished',    prompt: 'Professional studio headshot, soft natural light, neutral background, sharp focus, photorealistic, business attire, confident expression.' },
  { id: 'bg-gen',    title: 'Background Generator',  hint: 'Scenic & textures',   prompt: 'Cinematic background plate with rich textures, depth, no characters, balanced composition for a product hero shot.' },
  { id: 'street70s', title: '70s Street Style',      hint: 'Vintage mood',        prompt: '1970s street fashion photograph, grainy film, warm tones, urban backdrop, golden hour, candid pose.' },
];

const PM_CREATIVE_MOTION_PRESETS = [
  { id: 'flythrough', title: 'Sci-Fi Flythrough', prompt: 'Slow cinematic flythrough across a futuristic floating city above the clouds, fighter jets escorting the camera, golden hour, 6 seconds, smooth motion.' },
  { id: 'neon',       title: 'Neon Streets',      prompt: 'Walking POV down neon-lit night streets, rain-slicked asphalt, blade-runner palette, slow handheld motion, 4 seconds.' },
  { id: 'sunrise',    title: 'Mountain Sunrise',  prompt: 'Time-lapse sunrise over a mountain lake reflecting pink and amber clouds, drifting mist, 5 seconds.' },
  { id: 'cozy',       title: 'Cozy Interior',     prompt: 'Slow dolly through a warm cozy living room, fireplace glow, soft sunbeams through window, vintage decor, 3 seconds.' },
];

const PM_CREATIVE_ASPECTS = {
  image: [
    { id: 'portrait',  label: '2:3',  ratio: 'portrait' },
    { id: 'square',    label: '1:1',  ratio: 'square' },
    { id: 'landscape', label: '3:2',  ratio: 'landscape' },
  ],
  video: [
    { id: 'landscape', label: '16:9', ratio: 'landscape' },
    { id: 'square',    label: '1:1',  ratio: 'square' },
    { id: 'portrait',  label: '9:16', ratio: 'portrait' },
  ],
};

function _creativeState() {
  if (!window.__pmCreative) {
    window.__pmCreative = {
      mode: 'image',
      provider: 'xai',
      aspect: 'portrait',
      agent: false,
      busy: false,
      currentResult: null, // { kind:'image'|'video', path:string, dataUrl?:string }
      gallery: { image: [], video: [] },
      sessionId: MOBILE_CHAT_SESSION_ID + '_creative',
      extract: { busy: false, requestId: '', stage: '', detail: '', stages: [] },
    };
  }
  return window.__pmCreative;
}

function _pmCreativeFmtName(name) {
  return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 32);
}

export async function renderCreativePage(page, { navigate } = {}) {
  const state = _creativeState();
  const extras = `<button class="pm-icon-btn" id="pm-creative-refresh" aria-label="Refresh" style="background:var(--pm-surface);border:1px solid var(--pm-border);">${ICONS.refresh}</button>`;
  page.innerHTML = `
    ${renderMobileHeader({ title: 'Creative', online: true, extras, hideTitle: true, hideBrand: true })}
    <div class="pm-body pm-creative" id="pm-creative-body">
      <h1 class="pm-creative-title">Creative Studio</h1>
      <div class="pm-creative-status"><span class="pm-creative-dot"></span> Online</div>

      <div class="pm-creative-modeswitch" id="pm-creative-mode">
        <button class="${state.mode === 'image' ? 'active' : ''}" data-mode="image">${ICONS.image} <span>Image</span></button>
        <button class="${state.mode === 'video' ? 'active' : ''}" data-mode="video">${ICONS.video} <span>Video</span></button>
      </div>

      <div class="pm-creative-providers" id="pm-creative-providers"></div>

      <div class="pm-creative-actions">
        <button class="pm-creative-action" data-action="upload">${ICONS.upload} <span>Upload</span></button>
        <button class="pm-creative-action accent" data-action="secondary">${ICONS.layers} <span data-secondary-label>Extract Layers</span></button>
        <button class="pm-creative-action" data-action="presets">${ICONS.preset} <span>Presets</span> ${ICONS.chev}</button>
      </div>

      <section id="pm-creative-image-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-section-head">
          <h2>Featured Templates</h2>
          <button class="pm-creative-link" data-link="templates">View all</button>
        </div>
        <div class="pm-creative-templates" id="pm-creative-templates"></div>
      </section>

      <section id="pm-vstudio" class="pm-creative-section pm-vstudio" hidden></section>

      <section id="pm-creative-video-stage" class="pm-creative-section" hidden>
        <div class="pm-creative-preview" id="pm-creative-video-preview">
          <div class="pm-creative-preview-empty">
            <div class="pm-empty-icon">${ICONS.video}</div>
            <p>Generated video will appear here.</p>
          </div>
        </div>
        <div class="pm-creative-chiprow" id="pm-creative-video-meta" hidden>
          <span class="pm-creative-chip">${ICONS.eye} <span data-meta-res>720p</span></span>
          <span class="pm-creative-chip">${ICONS.clock} <span data-meta-dur>—</span></span>
          <span class="pm-creative-chip ok"><span class="pm-creative-dot"></span> Timeline live</span>
        </div>
      </section>

      <section class="pm-creative-section">
        <div class="pm-creative-section-head">
          <h2 id="pm-creative-gallery-title">Discover</h2>
          <button class="pm-creative-link" data-link="gallery">View all</button>
        </div>
        <div class="pm-creative-gallery" id="pm-creative-gallery"></div>
      </section>

      <section id="pm-creative-video-bottom" class="pm-creative-section" hidden>
        <div class="pm-creative-quickrow">
          <button class="pm-creative-quick" data-quick="create-hf">
            <span class="pm-creative-quick-icon">${ICONS.spark}</span>
            <div>
              <strong>Create HyperFrame</strong>
              <small>Generate motion with deterministic frames.</small>
            </div>
            ${ICONS.chev}
          </button>
          <button class="pm-creative-quick" data-quick="motion-preset">
            <span class="pm-creative-quick-icon">${ICONS.layers}</span>
            <div>
              <strong>Motion preset</strong>
              <small id="pm-creative-motion-preset-label">Sci-Fi Flythrough · View & edit preset</small>
            </div>
            ${ICONS.chev}
          </button>
        </div>
      </section>

      <div class="pm-creative-composer" id="pm-creative-composer">
        <span class="pm-glass-lens" aria-hidden="true"></span>
        <div class="pm-creative-composer-row">
          <button class="pm-icon-btn" data-composer="add" aria-label="Attach">${ICONS.plus}</button>
          <input type="text" class="pm-creative-input" id="pm-creative-prompt" placeholder="Type to imagine" autocomplete="off"/>
          <button class="pm-icon-btn" data-composer="voice" aria-label="Voice">${ICONS.micSmall}</button>
          <button class="pm-creative-send" id="pm-creative-send" aria-label="Generate">${ICONS.send}</button>
        </div>
        <div class="pm-creative-composer-meta">
          <button class="pm-creative-meta-chip" data-meta="agent"><span>${ICONS.robot}</span> Agent <small>${state.agent ? 'On' : 'Beta'}</small></button>
          <button class="pm-creative-meta-chip accent" data-meta="kind"><span data-kind-icon>${state.mode === 'video' ? ICONS.video : ICONS.image}</span> <span data-kind-label>${state.mode === 'video' ? 'Video' : 'Image'}</span></button>
          <button class="pm-creative-meta-chip" data-meta="aspect"><span>${ICONS.monitor}</span> <span data-aspect-label>${state.aspect}</span> ${ICONS.chev}</button>
          <button class="pm-creative-meta-chip" data-meta="outputs"><span>${ICONS.eye}</span> View outputs ${ICONS.chev}</button>
        </div>
      </div>
    </div>

    <div class="pm-creative-extract-modal" id="pm-creative-extract-modal" hidden>
      <div class="pm-creative-extract-card">
        <div class="pm-creative-extract-icon">${ICONS.layers}</div>
        <h3 id="pm-extract-stage">Extracting layers</h3>
        <p id="pm-extract-detail" class="pm-card-body">Preparing layer analysis...</p>
        <div class="pm-creative-extract-bar"><div id="pm-extract-fill"></div></div>
        <ul class="pm-creative-extract-stages" id="pm-extract-stages"></ul>
        <button class="pm-btn ghost" id="pm-extract-close">Hide</button>
      </div>
    </div>
  `;
  wireHeaderActions(page, {});

  const modeBar = page.querySelector('#pm-creative-mode');
  const providersBar = page.querySelector('#pm-creative-providers');
  const imageStage = page.querySelector('#pm-creative-image-stage');
  const videoStage = page.querySelector('#pm-creative-video-stage');
  const videoBottom = page.querySelector('#pm-creative-video-bottom');
  const templatesEl = page.querySelector('#pm-creative-templates');
  const galleryEl = page.querySelector('#pm-creative-gallery');
  const galleryTitle = page.querySelector('#pm-creative-gallery-title');
  const previewEl = page.querySelector('#pm-creative-video-preview');
  const promptInput = page.querySelector('#pm-creative-prompt');
  const sendBtn = page.querySelector('#pm-creative-send');
  const vstudio = _mountMobileVideoStudio(page.querySelector('#pm-vstudio'), { navigate });

  function paintProviders() {
    providersBar.innerHTML = PM_CREATIVE_PROVIDERS[state.mode].map(p => `
      <button class="pm-creative-provider ${state.provider === p.id ? 'active' : ''}" data-provider="${escapeHtml(p.id)}">
        ${p.id === 'xai' ? '<span class="pm-creative-provider-mark xai">𝕏</span>'
          : p.id === 'openai' ? '<span class="pm-creative-provider-mark oai">◎</span>'
          : `<span class="pm-creative-provider-mark hf">${ICONS.hf}</span>`}
        <span>${escapeHtml(p.label)}</span>
      </button>
    `).join('');
    providersBar.querySelectorAll('[data-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.provider = btn.getAttribute('data-provider');
        paintProviders();
      });
    });
  }

  function paintTemplates() {
    templatesEl.innerHTML = PM_CREATIVE_TEMPLATES.map(t => `
      <button class="pm-creative-template" data-template="${escapeHtml(t.id)}">
        <span class="pm-creative-template-thumb">${ICONS.image}</span>
        <strong>${escapeHtml(t.title)}</strong>
        <small>${escapeHtml(t.hint)}</small>
      </button>
    `).join('');
    templatesEl.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = PM_CREATIVE_TEMPLATES.find(t => t.id === btn.getAttribute('data-template'));
        if (tpl) { promptInput.value = tpl.prompt; promptInput.focus(); }
      });
    });
  }

  function paintGallery() {
    galleryTitle.textContent = state.mode === 'video' ? 'Recent renders' : 'Discover';
    const items = state.gallery[state.mode] || [];
    if (!items.length) {
      galleryEl.innerHTML = `<div class="pm-creative-gallery-empty">${ICONS[state.mode]} <span>No ${state.mode === 'video' ? 'renders' : 'images'} yet — generate one below.</span></div>`;
      return;
    }
    galleryEl.innerHTML = items.slice(0, 12).map(item => `
      <button class="pm-creative-gallery-card" data-gallery-path="${escapeHtml(item.relPath)}">
        ${state.mode === 'video'
          ? `<span class="pm-creative-thumb video">
              <video src="${escapeHtml(buildInlineMediaUrl(item.relPath))}#t=0.1" muted playsinline preload="metadata" crossorigin="use-credentials"></video>
              <span class="pm-creative-thumb-play">${ICONS.play}</span>
            </span>`
          : `<span class="pm-creative-thumb" data-thumb="${escapeHtml(item.relPath)}">${ICONS.image}</span>`}
        <strong>${escapeHtml(_pmCreativeFmtName(item.name))}</strong>
        <small>${escapeHtml(item.name.split('.').pop())} · ${_formatTimeAgo(item.mtime)}</small>
      </button>
    `).join('');
    // Lazy-load image thumbnails (videos render their first frame via #t=0.1).
    if (state.mode === 'image') {
      galleryEl.querySelectorAll('[data-thumb]').forEach(async (host) => {
        const rel = host.getAttribute('data-thumb');
        const url = await loadCanvasImageDataUrl(rel);
        if (url) host.innerHTML = `<img src="${url}" alt=""/>`;
      });
    }
    galleryEl.querySelectorAll('[data-gallery-path]').forEach(btn => {
      btn.addEventListener('click', () => openGalleryItem(btn.getAttribute('data-gallery-path')));
    });
  }

  async function openGalleryItem(relPath) {
    if (!relPath) return;
    if (state.mode === 'video') {
      await renderVideoPreview(relPath);
    } else {
      const url = await loadCanvasImageDataUrl(relPath);
      if (url) renderImagePreview(url, relPath);
    }
  }

  function renderImagePreview(dataUrl, relPath) {
    state.currentResult = { kind: 'image', path: relPath, dataUrl };
    // Show as a floating card at top of image stage.
    imageStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let card = page.querySelector('#pm-creative-image-current');
    if (!card) {
      card = document.createElement('div');
      card.id = 'pm-creative-image-current';
      card.className = 'pm-creative-current-image';
      imageStage.prepend(card);
    }
    card.innerHTML = `
      <div class="pm-creative-current-thumb"><img src="${dataUrl}" alt=""/></div>
      <div class="pm-creative-current-meta">
        <strong>${escapeHtml(_pmCreativeFmtName(relPath.split('/').pop()))}</strong>
        <small>${escapeHtml(relPath)}</small>
        <div class="pm-creative-current-actions">
          <button class="pm-btn primary" data-current-action="extract">${ICONS.layers} Extract Layers</button>
          <a class="pm-btn ghost" download href="${dataUrl}">${ICONS.download} Save</a>
        </div>
      </div>
    `;
    card.querySelector('[data-current-action="extract"]').addEventListener('click', () => runExtractLayers(relPath));
  }

  async function renderVideoPreview(relPath) {
    state.currentResult = { kind: 'video', path: relPath };
    const src = buildInlineMediaUrl(relPath);
    previewEl.innerHTML = `
      <video
        id="pm-creative-video-el"
        src="${escapeHtml(src)}"
        controls
        playsinline
        preload="metadata"
        crossorigin="use-credentials"
      ></video>
    `;
    const videoEl = previewEl.querySelector('#pm-creative-video-el');
    const metaRow = page.querySelector('#pm-creative-video-meta');
    if (metaRow) metaRow.hidden = false;
    if (videoEl) {
      videoEl.addEventListener('loadedmetadata', () => {
        const dur = Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration) : 0;
        const w = videoEl.videoWidth || 0;
        const h = videoEl.videoHeight || 0;
        const resLabel = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : (w && h ? `${w}x${h}` : '—');
        const durEl = page.querySelector('[data-meta-dur]');
        const resEl = page.querySelector('[data-meta-res]');
        if (durEl) durEl.textContent = dur ? `${dur}s` : '—';
        if (resEl) resEl.textContent = resLabel;
      }, { once: true });
      videoEl.addEventListener('error', () => {
        previewEl.innerHTML = `
          <div class="pm-creative-preview-stub">
            ${ICONS.video}
            <strong>${escapeHtml(_pmCreativeFmtName(relPath.split('/').pop()))}</strong>
            <small>${escapeHtml(relPath)}</small>
            <span class="pm-creative-preview-hint">Couldn't load this render. Tap Refresh and try again.</span>
          </div>
        `;
      });
    }
  }

  function paintMode() {
    const isImage = state.mode === 'image';
    imageStage.hidden = !isImage;
    videoStage.hidden = isImage;
    videoBottom.hidden = isImage;
    vstudio.setVisible(!isImage);
    // Reset provider if current isn't valid for this mode.
    if (!PM_CREATIVE_PROVIDERS[state.mode].find(p => p.id === state.provider)) {
      state.provider = PM_CREATIVE_PROVIDERS[state.mode][0].id;
    }
    state.aspect = PM_CREATIVE_ASPECTS[state.mode][0].id;
    const kindLabel = page.querySelector('[data-kind-label]');
    const kindIcon = page.querySelector('[data-kind-icon]');
    if (kindLabel) kindLabel.textContent = isImage ? 'Image' : 'Video';
    if (kindIcon) kindIcon.innerHTML = isImage ? ICONS.image : ICONS.video;
    const aspectLabel = page.querySelector('[data-aspect-label]');
    if (aspectLabel) aspectLabel.textContent = PM_CREATIVE_ASPECTS[state.mode][0].label;
    const secondaryLabel = page.querySelector('[data-secondary-label]');
    if (secondaryLabel) secondaryLabel.textContent = isImage ? 'Extract Layers' : 'Export';
    paintProviders();
    paintTemplates();
    paintGallery();
    promptInput.placeholder = isImage ? 'Type to imagine' : 'Describe the motion you want...';
  }

  // ---- generation via chat ----

  function buildGenerationPrompt() {
    const text = String(promptInput.value || '').trim();
    if (!text) return '';
    const provider = state.provider;
    const aspect = PM_CREATIVE_ASPECTS[state.mode].find(a => a.id === state.aspect)?.ratio || 'square';
    if (state.mode === 'video') {
      if (provider === 'hf') {
        return `Use HyperFrames to compose and render a short motion video. Prompt: ${text}\nAspect: ${aspect}. After rendering, save the MP4 under generated/videos/ and tell me the final path.`;
      }
      return `Use the generate_video tool with provider="xai" to create a short video.\nPrompt: ${text}\nAspect ratio: ${aspect}. Duration: 6 seconds. Resolution: 720p. Save under generated/videos/. Reply with the final file path.`;
    }
    if (provider === 'hf') {
      return `Compose a HyperFrames still using web-based motion freeze-frame. Prompt: ${text}\nAspect: ${aspect}. Save the result PNG under generated/images/ and report the path.`;
    }
    const transparencyHint = /\b(transparent|no background|alpha|cutout|sprite)\b/i.test(text)
      ? '\nSet background="transparent" and output_format="png" on the tool call for real alpha transparency.'
      : '';
    return `Use the generate_image tool with provider="${provider}" to create an image.\nPrompt: ${text}\nAspect ratio: ${aspect}.${transparencyHint} Save under generated/images/. Reply with the final file path.`;
  }

  let activeStream = null;

  async function runGeneration() {
    if (state.busy) return;
    const prompt = buildGenerationPrompt();
    if (!prompt) { pmToast('Enter a prompt first', 'error'); promptInput.focus(); return; }
    state.busy = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('busy');
    pmToast(state.mode === 'video' ? 'Generating video...' : 'Generating image...', 'info');
    let producedPath = '';
    activeStream = streamChat({ message: prompt, sessionId: state.sessionId }, {
      onToolResult: (evt) => {
        try {
          const name = String(evt?.name || evt?.tool || '');
          const extra = evt?.extra || evt?.toolResult?.extra || null;
          if (name === 'generate_image' && extra) {
            const path = extra.generated_image?.path || extra.generated_image || (Array.isArray(extra.generated_images) && extra.generated_images[0]?.path);
            if (path) producedPath = String(path);
          }
          if (name === 'generate_video' && extra) {
            const path = extra.generated_video?.path || extra.generated_video || (Array.isArray(extra.generated_videos) && extra.generated_videos[0]?.path);
            if (path) producedPath = String(path);
          }
        } catch {}
      },
      onError: (err) => {
        pmToast(err?.message || 'Generation failed', 'error');
      },
      onDone: async () => {
        state.busy = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('busy');
        activeStream = null;
        if (producedPath) {
          pmToast('Saved · refreshing gallery', 'success');
          if (state.mode === 'image') {
            const url = await loadCanvasImageDataUrl(producedPath);
            if (url) renderImagePreview(url, producedPath);
          } else {
            await renderVideoPreview(producedPath);
          }
        }
        await refreshGallery();
      },
    });
  }

  // ---- extract layers ----

  async function runExtractLayers(sourcePath) {
    if (!sourcePath) { pmToast('Pick or generate an image first', 'error'); return; }
    if (state.extract.busy) return;
    state.extract = { busy: true, requestId: 'mob_' + Date.now(), stage: 'Starting', detail: 'Submitting request', stages: [] };
    openExtractModal();
    try {
      const r = await creativeExtractLayers({
        sessionId: state.sessionId,
        source: sourcePath,
        mode: 'balanced',
        requestId: state.extract.requestId,
      });
      if (r?.success) {
        pmToast(`Extracted ${(r.layers || []).length} layers · scene saved`, 'success');
        const sceneRel = r.scenePath || '';
        if (sceneRel) {
          const stages = page.querySelector('#pm-extract-stages');
          if (stages) {
            const li = document.createElement('li');
            li.innerHTML = `<strong>Scene saved</strong> <small>${escapeHtml(sceneRel)}</small>`;
            stages.appendChild(li);
          }
        }
      } else {
        pmToast(r?.error || 'Extract failed', 'error');
      }
    } catch (err) {
      pmToast(err?.message || 'Extract failed', 'error');
    } finally {
      state.extract.busy = false;
      const closeBtn = page.querySelector('#pm-extract-close');
      if (closeBtn) closeBtn.textContent = 'Done';
    }
  }

  function openExtractModal() {
    const modal = page.querySelector('#pm-creative-extract-modal');
    modal.hidden = false;
    page.querySelector('#pm-extract-stage').textContent = 'Extracting layers';
    page.querySelector('#pm-extract-detail').textContent = 'Preparing layer analysis...';
    page.querySelector('#pm-extract-stages').innerHTML = '';
    page.querySelector('#pm-extract-fill').style.width = '4%';
    page.querySelector('#pm-extract-close').textContent = 'Hide';
  }

  function closeExtractModal() {
    const modal = page.querySelector('#pm-creative-extract-modal');
    if (modal) modal.hidden = true;
  }

  const PM_EXTRACT_STAGE_WEIGHTS = {
    source_loaded: 8, vision_candidates: 22, text_candidates: 32, proposal_merge: 38,
    foreground_start: 44, foreground_mask: 56, sam_start: 60, sam_masks: 74,
    alpha_cutouts: 78, vector_trace: 82, inpaint_start: 86, clean_plate: 94,
    scene_assembled: 96, layer_assets_saved: 100,
  };

  const onExtractProgress = (msg) => {
    if (!state.extract.busy) return;
    if (msg?.requestId && msg.requestId !== state.extract.requestId) return;
    const stage = String(msg.stage || 'progress');
    const label = String(msg.label || stage.replace(/_/g, ' '));
    const detail = String(msg.detail || '');
    page.querySelector('#pm-extract-stage').textContent = label;
    if (detail) page.querySelector('#pm-extract-detail').textContent = detail;
    const pct = PM_EXTRACT_STAGE_WEIGHTS[stage] || Math.min(95, (state.extract.stages.length + 1) * 10);
    page.querySelector('#pm-extract-fill').style.width = pct + '%';
    const stagesEl = page.querySelector('#pm-extract-stages');
    if (stagesEl) {
      state.extract.stages.push(stage);
      const li = document.createElement('li');
      li.innerHTML = `<span class="pm-creative-stage-dot"></span> <strong>${escapeHtml(label)}</strong>${detail ? ` <small>${escapeHtml(detail)}</small>` : ''}`;
      stagesEl.appendChild(li);
      stagesEl.scrollTop = stagesEl.scrollHeight;
    }
  };

  if (window.wsEventBus) {
    window.wsEventBus.on('creative_extract_layers_progress', onExtractProgress);
  }

  page.querySelector('#pm-extract-close').addEventListener('click', closeExtractModal);
  page.querySelector('#pm-creative-extract-modal').addEventListener('click', (e) => {
    if (e.target.id === 'pm-creative-extract-modal') closeExtractModal();
  });

  // ---- upload ----

  async function pickAndUploadImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = state.mode === 'video' ? 'video/*,image/*' : 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      pmToast('Uploading...', 'info');
      try {
        const buf = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const r = await uploadMobileBinaryFile({ filename: file.name, base64, mimeType: file.type });
        if (r?.success && r.path) {
          pmToast('Uploaded · ready to use', 'success');
          if (state.mode === 'image' && /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
            const url = await loadCanvasImageDataUrl(r.path);
            if (url) renderImagePreview(url, r.path);
          }
        } else {
          pmToast(r?.error || 'Upload failed', 'error');
        }
      } catch (err) {
        pmToast(err?.message || 'Upload failed', 'error');
      }
    };
    input.click();
  }

  // ---- aspect picker ----

  function openAspectPicker() {
    const opts = PM_CREATIVE_ASPECTS[state.mode];
    const overlay = document.createElement('div');
    overlay.className = 'pm-creative-sheet-overlay';
    overlay.innerHTML = `
      <div class="pm-creative-sheet">
        <h3>Aspect ratio</h3>
        <div class="pm-creative-sheet-options">
          ${opts.map(o => `<button data-aspect="${escapeHtml(o.id)}" class="${state.aspect === o.id ? 'active' : ''}">${escapeHtml(o.label)}<small>${escapeHtml(o.ratio)}</small></button>`).join('')}
        </div>
        <button class="pm-btn ghost" data-close="1">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.getAttribute('data-close')) overlay.remove();
      const a = e.target.closest('[data-aspect]');
      if (a) {
        state.aspect = a.getAttribute('data-aspect');
        const aspectLabel = page.querySelector('[data-aspect-label]');
        const opt = opts.find(o => o.id === state.aspect);
        if (aspectLabel && opt) aspectLabel.textContent = opt.label;
        overlay.remove();
      }
    });
  }

  function openPresetsSheet() {
    const list = state.mode === 'video' ? PM_CREATIVE_MOTION_PRESETS : PM_CREATIVE_TEMPLATES;
    const overlay = document.createElement('div');
    overlay.className = 'pm-creative-sheet-overlay';
    overlay.innerHTML = `
      <div class="pm-creative-sheet">
        <h3>${state.mode === 'video' ? 'Motion presets' : 'Image presets'}</h3>
        <div class="pm-creative-sheet-list">
          ${list.map(p => `<button data-preset="${escapeHtml(p.id)}"><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.hint || p.prompt.slice(0, 80))}</small></button>`).join('')}
        </div>
        <button class="pm-btn ghost" data-close="1">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.getAttribute('data-close')) overlay.remove();
      const p = e.target.closest('[data-preset]');
      if (p) {
        const item = list.find(i => i.id === p.getAttribute('data-preset'));
        if (item) { promptInput.value = item.prompt; promptInput.focus(); }
        overlay.remove();
      }
    });
  }

  // ---- gallery refresh ----

  async function refreshGallery() {
    const [images, videos] = await Promise.all([
      loadCreativeGallery({ kind: 'image' }),
      loadCreativeGallery({ kind: 'video' }),
    ]);
    state.gallery.image = images;
    state.gallery.video = videos;
    paintGallery();
  }

  // ---- wire all interactions ----

  modeBar.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.getAttribute('data-mode');
      modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
      paintMode();
    });
  });

  page.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'upload') return pickAndUploadImage();
      if (action === 'presets') return openPresetsSheet();
      if (action === 'secondary') {
        if (state.mode === 'image') {
          const path = state.currentResult?.path || (state.gallery.image[0]?.relPath || '');
          if (!path) { pmToast('Generate or upload an image first', 'error'); return; }
          return runExtractLayers(path);
        }
        // video: export
        const path = state.currentResult?.path || (state.gallery.video[0]?.relPath || '');
        if (!path) { pmToast('Generate a video first', 'error'); return; }
        window.open(buildInlineMediaUrl(path), '_blank');
      }
    });
  });

  page.querySelectorAll('[data-meta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const meta = btn.getAttribute('data-meta');
      if (meta === 'aspect') return openAspectPicker();
      if (meta === 'kind') {
        state.mode = state.mode === 'image' ? 'video' : 'image';
        modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === state.mode));
        paintMode();
      }
      if (meta === 'agent') {
        state.agent = !state.agent;
        btn.querySelector('small').textContent = state.agent ? 'On' : 'Beta';
      }
      if (meta === 'outputs') {
        document.getElementById('pm-creative-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  page.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-quick');
      if (q === 'create-hf') {
        state.mode = 'video';
        state.provider = 'hf';
        modeBar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === 'video'));
        paintMode();
        promptInput.focus();
      }
      if (q === 'motion-preset') openPresetsSheet();
    });
  });

  page.querySelectorAll('[data-composer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-composer');
      if (k === 'add') pickAndUploadImage();
      if (k === 'voice') navigate?.('#mobile/voice');
    });
  });

  page.querySelectorAll('[data-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-link');
      if (k === 'templates') openPresetsSheet();
      if (k === 'gallery') document.getElementById('pm-creative-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  sendBtn.addEventListener('click', runGeneration);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runGeneration(); }
  });
  page.querySelector('#pm-creative-refresh').addEventListener('click', refreshGallery);

  paintMode();
  await refreshGallery();

  // Cleanup: unbind WS handler when navigating away.
  page._pmCleanup = () => {
    try { window.wsEventBus?.off('creative_extract_layers_progress', onExtractProgress); } catch {}
    try { activeStream?.abort?.(); } catch {}
    try { vstudio.dispose(); } catch {}
  };
}

/* ---------------- VIDEO STUDIO (server video projects) ----------------
 * Phone view of the same /api/video-projects document the desktop Studio tab
 * and Prom's video_project tool edit: pick a project, review shots, approve
 * generations, pick takes, assemble, render, and paste provider keys.
 * Full timeline editing stays on desktop. */

const VS_LS_ACTIVE = 'prometheus_vp_active_project';
const VS_BASE = '/api/video-projects';
const VS_SVG = {
  gen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M17 6l3 3M15 8l2 2"/></svg>',
  seq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/></svg>',
};

function _vsUsd(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
function _vsIsVideo(rel) { return /\.(mp4|webm|mov|m4v)$/i.test(String(rel || '')); }
function _vsTake(shot) {
  if (!shot?.takes?.length) return null;
  return shot.takes.find((t) => t.id === shot.selectedTakeId) || shot.takes[shot.takes.length - 1];
}
function _vsThumb(rel, cls) {
  if (!rel) return `<div class="${cls} is-empty">${VS_SVG.film}</div>`;
  const url = escapeHtml(buildInlineMediaUrl(rel));
  return _vsIsVideo(rel)
    ? `<video class="${cls}" src="${url}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img class="${cls}" src="${url}" alt="" loading="lazy">`;
}

function _mountMobileVideoStudio(root, { navigate } = {}) {
  const noop = { setVisible() {}, dispose() {} };
  if (!root) return noop;
  const st = {
    visible: false, loaded: false, projects: [], project: null, history: { undo: 0, redo: 0 },
    providers: {}, openShot: '', busy: '', keysOpen: false, renderPath: '',
  };
  let poll = null;
  let disposed = false;

  async function call(path, body, timeoutMs = 30000) {
    const res = await mobileGatewayFetch(`${VS_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    });
    if (res && res.success === false) throw new Error(res.error || 'Request failed');
    return res || {};
  }
  async function guard(label, fn) {
    st.busy = label; paint();
    try { return await fn(); }
    catch (err) { pmToast(String(err?.message || err), 'error'); return null; }
    finally { st.busy = ''; paint(); }
  }
  function take(res) {
    if (res?.project) st.project = res.project;
    if (res?.history) st.history = res.history;
  }
  async function loadAll() {
    try {
      const [list, prov] = await Promise.all([call(''), call('/providers')]);
      st.projects = list.projects || [];
      st.providers = prov.providers || {};
      let last = '';
      try { last = localStorage.getItem(VS_LS_ACTIVE) || ''; } catch { /* ignore */ }
      const id = st.projects.find((p) => p.id === last)?.id || st.projects[0]?.id || '';
      if (id) await open(id); else st.project = null;
    } catch (err) { pmToast(`Video projects: ${err?.message || err}`, 'error'); }
    st.loaded = true;
    paint();
  }
  async function open(id) {
    if (!id) { st.project = null; paint(); return; }
    const res = await call(`/${encodeURIComponent(id)}`);
    take(res);
    try { localStorage.setItem(VS_LS_ACTIVE, id); } catch { /* ignore */ }
    schedulePoll();
    paint();
  }
  async function refresh() {
    if (!st.project || disposed) return;
    try { take(await call(`/${encodeURIComponent(st.project.id)}`)); paint(); } catch { /* keep last */ }
    schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(poll);
    const running = (st.project?.jobs || []).some((j) => j.state === 'queued' || j.state === 'running');
    if (running && st.visible && !disposed) poll = setTimeout(refresh, 4000);
  }
  async function ops(list, label = 'Saving') {
    if (!st.project) return;
    take(await guard(label, () => call(`/${st.project.id}/ops`, { ops: list })));
    paint();
  }
  async function generate(shotIds, count = 1) {
    const pid = st.project?.id;
    if (!pid) return;
    let res = await guard('Estimating', () => call(`/${pid}/generate`, { shotIds, count }, 120000));
    if (!res) return;
    if (res.needsApproval) {
      const lines = (res.estimate?.shots || []).map((s) => `${s.title}: ${s.count}x ${s.modelId} ~ ${_vsUsd(s.usd)}`).join('\n');
      if (!window.confirm(`${res.reason || 'Approve this generation?'}\n\n${lines}\n\nTotal ~ ${_vsUsd(res.estimate?.total)}`)) return;
      res = await guard('Submitting', () => call(`/${pid}/generate`, { shotIds, count, approved: true }, 120000));
    }
    if (res) pmToast('Generating. Takes appear here when ready.', 'success');
    await refresh();
  }

  function providerChips() {
    const names = { xai: 'Grok', openai: 'OpenAI', fal: 'fal', higgsfield: 'Higgsfield' };
    return Object.keys(names).map((k) => {
      const ok = !!st.providers?.[k]?.configured;
      return `<span class="pm-vs-chip${ok ? ' ok' : ''}" title="${ok ? 'Ready' : 'Not configured'}"><i></i>${names[k]}</span>`;
    }).join('');
  }

  function keysSheet() {
    if (!st.keysOpen) return '';
    return `<div class="pm-vs-keys">
      <label>fal API key<input type="password" autocomplete="off" data-vs-key="fal" placeholder="${st.providers?.fal?.configured ? 'Configured. Paste to replace' : 'fal.ai key'}"></label>
      <label>Higgsfield key<input type="password" autocomplete="off" data-vs-key="higgsfield" placeholder="${st.providers?.higgsfield?.configured ? 'Configured. Paste to replace' : 'id:secret'}"></label>
      <button class="pm-vs-btn primary" data-vs="save-keys">${VS_SVG.check}<span>Save keys</span></button>
      <p class="pm-vs-hint">Stored encrypted in the vault. Never shown again.</p>
    </div>`;
  }

  function shotCard(shot, i) {
    const t = _vsTake(shot);
    const open = st.openShot === shot.id;
    const takes = open ? (shot.takes || []).slice().reverse().map((tk) => `
      <div class="pm-vs-take${tk.id === t?.id ? ' is-selected' : ''}">
        ${_vsIsVideo(tk.path)
          ? `<video src="${escapeHtml(buildInlineMediaUrl(tk.path))}#t=0.1" controls playsinline preload="metadata"></video>`
          : `<img src="${escapeHtml(buildInlineMediaUrl(tk.path))}" alt="">`}
        <div class="pm-vs-take-row">
          <small>${escapeHtml(tk.modelId || '')} · ${_vsUsd(tk.costUsd)}</small>
          ${tk.id === t?.id
            ? `<span class="pm-vs-used">${VS_SVG.check} In cut</span>`
            : `<button class="pm-vs-btn" data-vs="use-take" data-shot="${escapeHtml(shot.id)}" data-take="${escapeHtml(tk.id)}">${VS_SVG.check}<span>Use</span></button>`}
        </div>
      </div>`).join('') : '';
    return `<div class="pm-vs-shot${open ? ' is-open' : ''}">
      <button class="pm-vs-shot-head" data-vs="toggle-shot" data-shot="${escapeHtml(shot.id)}">
        ${_vsThumb(t?.path, 'pm-vs-thumb')}
        <div class="pm-vs-shot-meta">
          <strong>${i + 1}. ${escapeHtml(shot.title || 'Shot')}</strong>
          <small>${escapeHtml(String(shot.prompt || '').slice(0, 90) || 'No prompt yet')}</small>
          <span class="pm-vs-status is-${escapeHtml(shot.status)}">${escapeHtml(shot.status)} · ${shot.durationSec}s · ${(shot.takes || []).length} take${(shot.takes || []).length === 1 ? '' : 's'}</span>
        </div>
      </button>
      ${open ? `<div class="pm-vs-shot-body">
        <div class="pm-vs-row">
          <button class="pm-vs-btn primary" data-vs="gen" data-shot="${escapeHtml(shot.id)}" data-count="1">${VS_SVG.gen}<span>Generate</span></button>
          <button class="pm-vs-btn" data-vs="gen" data-shot="${escapeHtml(shot.id)}" data-count="3">${VS_SVG.gen}<span>3 variations</span></button>
        </div>
        <div class="pm-vs-takes">${takes || '<p class="pm-vs-hint">No takes yet.</p>'}</div>
      </div>` : ''}
    </div>`;
  }

  function paint() {
    if (disposed) return;
    if (!st.visible) { root.hidden = true; return; }
    root.hidden = false;
    const p = st.project;
    const running = (p?.jobs || []).filter((j) => j.state === 'queued' || j.state === 'running');
    const drafts = (p?.shots || []).filter((s) => !_vsTake(s)).map((s) => s.id);
    root.innerHTML = `
      <div class="pm-creative-section-head">
        <h2>Video projects</h2>
        <button class="pm-vs-icon" data-vs="keys" aria-label="Provider keys" title="Provider keys">${VS_SVG.key}</button>
      </div>
      <div class="pm-vs-chips">${providerChips()}</div>
      ${keysSheet()}
      ${!st.loaded ? '<p class="pm-vs-hint">Loading projects...</p>' : !st.projects.length ? `
        <div class="pm-vs-empty">
          <p>No video projects yet. Describe a video and Prom plans the shots.</p>
          <button class="pm-vs-btn primary" data-vs="new">${VS_SVG.gen}<span>New project</span></button>
        </div>` : `
        <div class="pm-vs-row">
          <select class="pm-vs-select" data-vs-project>${st.projects.map((x) => `<option value="${escapeHtml(x.id)}"${x.id === p?.id ? ' selected' : ''}>${escapeHtml(x.title)} · ${x.shots} shots</option>`).join('')}</select>
          <button class="pm-vs-icon" data-vs="new" aria-label="New project" title="New project">${ICONS.plus}</button>
        </div>`}
      ${p ? `
        <div class="pm-vs-toolbar">
          <button class="pm-vs-icon" data-vs="undo" aria-label="Undo" title="Undo"${st.history.undo ? '' : ' disabled'}>${VS_SVG.undo}</button>
          <button class="pm-vs-icon" data-vs="redo" aria-label="Redo" title="Redo"${st.history.redo ? '' : ' disabled'}>${VS_SVG.redo}</button>
          <button class="pm-vs-icon" data-vs="plan" aria-label="Plan with Prom" title="Plan with Prom">${VS_SVG.chat}</button>
          <span class="pm-vs-spacer"></span>
          <span class="pm-vs-spent">${_vsUsd(p.budget?.spentUsd)}${p.budget?.capUsd ? ` / ${_vsUsd(p.budget.capUsd)}` : ''}</span>
        </div>
        ${st.busy ? `<p class="pm-vs-busy">${escapeHtml(st.busy)}...</p>` : ''}
        ${running.length ? `<div class="pm-vs-jobs">${running.map((j) => `<div class="pm-vs-job"><span class="pm-vs-spin"></span><span>${escapeHtml(j.modelId)} · ${escapeHtml(j.state)}</span><button class="pm-vs-icon sm" data-vs="cancel-job" data-job="${escapeHtml(j.id)}" aria-label="Cancel job" title="Cancel">${VS_SVG.stop}</button></div>`).join('')}</div>` : ''}
        <div class="pm-vs-shots">${p.shots.length ? p.shots.map(shotCard).join('') : '<p class="pm-vs-hint">No shots yet. Tap the chat icon to plan them with Prom.</p>'}</div>
        <div class="pm-vs-row wrap">
          ${drafts.length ? `<button class="pm-vs-btn" data-vs="gen-drafts">${VS_SVG.gen}<span>Generate ${drafts.length} draft${drafts.length === 1 ? '' : 's'}</span></button>` : ''}
          <button class="pm-vs-btn" data-vs="assemble"${p.shots.some(_vsTake) ? '' : ' disabled'}>${VS_SVG.seq}<span>Assemble</span></button>
          <button class="pm-vs-btn primary" data-vs="render"${p.clips?.length ? '' : ' disabled'}>${VS_SVG.export}<span>Render MP4</span></button>
        </div>
        ${st.renderPath ? `<video class="pm-vs-render" src="${escapeHtml(buildInlineMediaUrl(st.renderPath))}" controls playsinline></video>` : ''}
      ` : ''}`;
  }

  async function onClick(e) {
    const el = e.target.closest('[data-vs]');
    if (!el || el.disabled) return;
    const act = el.dataset.vs;
    const p = st.project;
    if (act === 'keys') { st.keysOpen = !st.keysOpen; paint(); return; }
    if (act === 'save-keys') {
      for (const input of root.querySelectorAll('[data-vs-key]')) {
        const key = input.value.trim();
        if (!key) continue;
        const ok = await guard('Saving key', () => call(`/providers/${input.dataset.vsKey}/key`, { key }));
        if (ok) pmToast(`${input.dataset.vsKey} key saved`, 'success');
      }
      try { st.providers = (await call('/providers')).providers || st.providers; } catch { /* ignore */ }
      st.keysOpen = false; paint(); return;
    }
    if (act === 'new') {
      const title = window.prompt('Project name', 'New video');
      if (!title) return;
      const res = await guard('Creating', () => call('', { title }));
      if (res?.project) { st.projects = (await call('')).projects || []; await open(res.project.id); }
      return;
    }
    if (act === 'toggle-shot') { st.openShot = st.openShot === el.dataset.shot ? '' : el.dataset.shot; paint(); return; }
    if (!p) return;
    if (act === 'plan') {
      const brief = window.prompt('Describe the video (scenes, characters, mood):', p.brief || '');
      if (!brief) return;
      try { sessionStorage.setItem('pm_mobile_prefill_chat', `Plan my video project "${p.title}" (${p.id}) with video_project: ${brief} Target ${p.target?.aspect}. Build characters and a shot list with plan.setShots, show me the estimate, and wait for my approval before generating.`); } catch { /* ignore */ }
      pmToast('Brief ready. Send it in chat.', 'success');
      navigate?.('#mobile/chat');
      return;
    }
    if (act === 'gen') { await generate([el.dataset.shot], Number(el.dataset.count) || 1); return; }
    if (act === 'gen-drafts') { await generate(p.shots.filter((s) => !_vsTake(s)).map((s) => s.id), 1); return; }
    if (act === 'use-take') { await ops([{ op: 'take.select', shotId: el.dataset.shot, takeId: el.dataset.take }], 'Selecting'); return; }
    if (act === 'assemble') { await ops([{ op: 'timeline.assemble' }], 'Assembling'); pmToast('Cut assembled', 'success'); return; }
    if (act === 'undo' || act === 'redo') { take(await guard(act === 'undo' ? 'Undoing' : 'Redoing', () => call(`/${p.id}/${act}`, {}))); paint(); return; }
    if (act === 'cancel-job') { await guard('Canceling', () => call(`/${p.id}/jobs/${el.dataset.job}/cancel`, {})); await refresh(); return; }
    if (act === 'render') {
      const res = await guard('Rendering', () => call(`/${p.id}/render`, {}, 600000));
      if (res?.path) { st.renderPath = res.path; pmToast('Render ready', 'success'); }
      paint();
    }
  }
  async function onChange(e) {
    if (e.target.matches('[data-vs-project]')) { st.renderPath = ''; st.openShot = ''; await guard('Opening', () => open(e.target.value)); }
  }
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  return {
    setVisible(v) {
      st.visible = !!v;
      if (st.visible && !st.loaded) loadAll(); else { paint(); schedulePoll(); }
    },
    dispose() {
      disposed = true;
      clearTimeout(poll);
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
    },
  };
}
