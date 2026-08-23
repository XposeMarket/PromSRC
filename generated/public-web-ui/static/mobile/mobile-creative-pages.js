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
  };
}
