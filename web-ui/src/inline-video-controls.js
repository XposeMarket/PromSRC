let shareFileCache, shareOrDownloadFile;
let shareModulePromise;
const loadShareModule = () => shareModulePromise ||= import('./share-file-cache.js').then(m => {
  ({ shareFileCache, shareOrDownloadFile } = m);
});

export function installInlineVideoControls() {
  // Save icon under inline videos. On iOS the share sheet (navigator.share with
  // a File) offers "Save Video" to Photos. Safari drops the tap's user
  // activation if the download takes too long, so the file is cached: a second
  // tap then opens the sheet instantly. Desktop falls back to a download.
  // The file is warmed (prefetched) as soon as the video shows it is playable,
  // so the tap can call share() before its activation expires.
  const isPhone = () => document.body?.classList?.contains('pm-mobile') || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  const saveNameFor = (path) => (String(path || '').split(/[\\/]/).pop() || 'video.mp4').replace(/[?#].*$/, '');
  const warmInlineVideo = (video) => {
    if (!isPhone()) return;
    const btn = video.closest?.('.prom-inline-figure')?.querySelector?.('.prom-inline-save');
    const src = btn?.getAttribute('data-save-src') || '';
    if (!src || shareFileCache?.has(src)) return;
    loadShareModule().then(() => shareFileCache.load(src, saveNameFor(btn.getAttribute('data-workspace-path')), 'video/mp4'))
      .then(() => btn.classList.add('is-warm'))
      .catch(() => {});
  };
  const onVideoReady = (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.classList.contains('prom-inline-media')) return;
    video.closest('.prom-inline-figure')?.classList.remove('is-failed');
    // Warm only on play. loadedmetadata just clears a stale failure state:
    // warming on every rendered video would prefetch multi-MB files nobody plays.
    // Metadata never resets retries, so a failing video cannot loop forever.
    if (event.type === 'play') warmInlineVideo(video);
  };
  document.addEventListener('loadedmetadata', onVideoReady, true);
  document.addEventListener('play', onVideoReady, true);

  // Inline videos sometimes fail on iOS (load aborted by a re-render or a
  // flaky Funnel connection) and show the crossed-out play icon forever.
  // Retry twice with backoff, then show an explicit "Tap to retry" state.
  document.addEventListener('error', (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.classList.contains('prom-inline-media')) return;
    const base = video.getAttribute('data-base-src') || '';
    if (!base) return;
    const tries = Number(video.dataset.retries || 0);
    const figure = video.closest('.prom-inline-figure');
    if (tries >= 2) { figure?.classList.add('is-failed'); return; }
    video.dataset.retries = String(tries + 1);
    setTimeout(() => {
      if (!video.isConnected) return;
      const sep = base.includes('?') ? '&' : '?';
      video.src = `${base}${sep}r=${Date.now()}#t=0.1`;
      video.load();
    }, tries === 0 ? 800 : 2500);
  }, true);
  document.addEventListener('click', (event) => {
    const figure = event.target?.closest?.('.prom-inline-figure.is-video.is-failed');
    if (!figure || event.target?.closest?.('.prom-inline-save')) return;
    const video = figure.querySelector('video.prom-inline-media');
    const base = video?.getAttribute('data-base-src') || '';
    if (!video || !base) return;
    event.preventDefault();
    figure.classList.remove('is-failed');
    video.dataset.retries = '0';
    const sep = base.includes('?') ? '&' : '?';
    video.src = `${base}${sep}r=${Date.now()}#t=0.1`;
    video.load();
  });

  document.addEventListener('click', async (event) => {
    const btn = event.target?.closest?.('.prom-inline-save');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    if (btn.dataset.busy === '1') return;
    const src = btn.getAttribute('data-save-src') || '';
    const path = btn.getAttribute('data-workspace-path') || '';
    const name = saveNameFor(path);
    btn.classList.remove('is-ready', 'is-error');
    // Cached: share synchronously inside the tap so iOS keeps the activation.
    const markOutcome = (outcome) => btn.classList.add(outcome === 'needs-tap' ? 'is-ready' : 'is-done');
    const markError = () => { btn.classList.add('is-error'); setTimeout(() => btn.classList.remove('is-error'), 2000); };
    const cached = shareFileCache?.get(src);
    if (cached) {
      // Synchronous share call inside the tap (no await before it).
      try { const outcome = await shareOrDownloadFile(cached); if (outcome !== 'cancelled') markOutcome(outcome); }
      catch { markError(); }
      return;
    }
    btn.dataset.busy = '1';
    btn.classList.add('is-busy');
    try {
      await loadShareModule();
      // Activation may expire during the download; the file is cached then,
      // so the next tap opens the share sheet immediately.
      const outcome = await shareOrDownloadFile(await shareFileCache.load(src, name, 'video/mp4'));
      if (outcome !== 'cancelled') markOutcome(outcome);
    } catch {
      markError();
    } finally {
      btn.dataset.busy = '';
      btn.classList.remove('is-busy');
    }
  });
}
