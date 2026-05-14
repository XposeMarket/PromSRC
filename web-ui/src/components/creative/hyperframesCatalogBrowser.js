/**
 * HyperFrames catalog browser — self-contained component that lists the
 * bundled HF catalog and lets the user import a block as either an editable
 * Prometheus clip or an "advanced" code-backed block.
 *
 * Mount it inside any container; it owns its own DOM.
 *
 *   import { createHyperframesCatalogBrowser } from '/static/components/creative/hyperframesCatalogBrowser.js';
 *   const browser = createHyperframesCatalogBrowser({
 *     mount: document.querySelector('#catalog-slot'),
 *     api,                              // wrapper with get()/post()
 *     onInsertEditable: ({ html, item, durationMs, compositionId }) => addClip(...),
 *     onInsertAdvanced: ({ html, item, durationMs, compositionId }) => addClip(..., { advancedBlock: true }),
 *   });
 *   browser.refresh();
 */

export function createHyperframesCatalogBrowser(options = {}) {
  const {
    mount,
    api,
    onInsertEditable = () => {},
    onInsertAdvanced = () => {},
    onError = (err) => console.error('hyperframes-catalog', err),
  } = options;

  if (!mount || !api) throw new Error('createHyperframesCatalogBrowser: mount + api required');

  let items = [];
  let filtered = [];
  let query = '';

  const root = document.createElement('div');
  root.className = 'hyperframes-catalog-browser';
  root.innerHTML = `
    <div class="hf-catalog-toolbar" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--border-subtle, #e5e7eb)">
      <input class="hf-catalog-search" type="search" placeholder="Search HyperFrames catalog…" style="flex:1;padding:6px 10px;border:1px solid var(--border-subtle,#e5e7eb);border-radius:6px"/>
      <button class="hf-catalog-refresh" style="padding:6px 10px">Refresh</button>
    </div>
    <div class="hf-catalog-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:10px;overflow-y:auto"></div>
    <div class="hf-catalog-status" style="padding:8px;font-size:12px;color:var(--text-muted,#64748b)"></div>
  `;
  mount.appendChild(root);

  const searchInput = root.querySelector('.hf-catalog-search');
  const refreshBtn = root.querySelector('.hf-catalog-refresh');
  const listEl = root.querySelector('.hf-catalog-list');
  const statusEl = root.querySelector('.hf-catalog-status');

  function renderList() {
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-muted,#64748b)">No matching catalog items.</div>`;
      return;
    }
    for (const item of filtered) {
      const card = document.createElement('div');
      card.className = 'hf-catalog-card';
      card.style.cssText = 'border:1px solid var(--border-subtle,#e5e7eb);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--surface-1,#fff)';
      card.innerHTML = `
        <div style="font-weight:600;font-size:13px">${escapeHtml(item.name)}</div>
        <div style="font-size:11px;color:var(--text-muted,#64748b);min-height:32px">${escapeHtml(item.description || '')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--text-muted,#64748b)">
          ${(item.tags || []).slice(0, 4).map((t) => `<span style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:999px;padding:2px 6px">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div style="display:flex;gap:6px;margin-top:auto">
          <button class="hf-insert-editable" style="flex:1;padding:5px 8px;font-size:11px">Insert (editable)</button>
          <button class="hf-insert-advanced" style="flex:1;padding:5px 8px;font-size:11px">Insert (advanced)</button>
        </div>
      `;
      card.querySelector('.hf-insert-editable').addEventListener('click', () => insert(item, false));
      card.querySelector('.hf-insert-advanced').addEventListener('click', () => insert(item, true));
      listEl.appendChild(card);
    }
  }

  async function refresh() {
    setStatus('Loading catalog…');
    try {
      const res = await api.get('/api/canvas/hyperframes/catalog');
      items = Array.isArray(res?.items) ? res.items : [];
      applyFilter();
      setStatus(`${filtered.length} of ${items.length} items.`);
    } catch (err) {
      onError(err);
      setStatus(`Failed to load catalog: ${err?.message || err}`);
    }
  }

  function applyFilter() {
    const q = query.trim().toLowerCase();
    filtered = q
      ? items.filter((item) => {
          const hay = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
          return hay.includes(q);
        })
      : items.slice();
    renderList();
  }

  async function insert(item, advancedBlock) {
    setStatus(`Importing ${item.name}…`);
    try {
      const res = await api.post('/api/canvas/hyperframes/catalog/import', { id: item.id, ingestAssets: true });
      if (!res?.success) throw new Error(res?.error || 'Import failed');
      const html = res.template?.html || res.block?.html || '';
      const durationMs = Number(res.template?.durationMs) || 6000;
      const compositionId = res.template?.id || res.block?.id || `hyperframes-${item.id}`;
      let extraction = null;
      try {
        const extracted = await api.post('/api/canvas/hyperframes/extract-layers', { html });
        if (extracted?.success) extraction = extracted;
      } catch {}
      const payload = {
        html,
        item,
        durationMs: Number(extraction?.durationMs) || durationMs,
        compositionId: extraction?.compositionId || compositionId,
        advancedBlock: advancedBlock || extraction?.advancedBlock === true,
        importResult: res,
        extraction,
      };
      if (advancedBlock) onInsertAdvanced(payload); else onInsertEditable(payload);
      setStatus(`Inserted ${item.name} as ${advancedBlock ? 'advanced' : 'editable'}.`);
    } catch (err) {
      onError(err);
      setStatus(`Failed to import ${item.name}: ${err?.message || err}`);
    }
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  searchInput.addEventListener('input', (event) => {
    query = String(event.target.value || '');
    applyFilter();
  });
  refreshBtn.addEventListener('click', () => refresh());

  // Auto-load on mount
  refresh();

  return {
    refresh,
    setQuery(next) { query = String(next || ''); searchInput.value = query; applyFilter(); },
    dispose() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
