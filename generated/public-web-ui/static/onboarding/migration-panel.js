function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function summarize(report) {
  const s = report?.summary || {};
  return [
    `${s.migrated || 0} importable`,
    `${s.conflict || 0} conflicts`,
    `${s.archived || 0} archived`,
    `${s.skipped || 0} skipped`,
  ].join(' · ');
}

function sourceTitle(source) {
  const kind = source?.kind === 'hermes' ? 'Hermes' : source?.kind === 'openclaw' ? 'OpenClaw' : source?.kind === 'localclaw' ? 'LocalClaw' : 'Custom';
  return `${kind} setup`;
}

export function showMigrationPanel(opts = {}) {
  const devTest = !!opts.devTest;
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Import existing setup">
        <div class="prom-onb-header">
          <div class="prom-onb-step">Step · Bring your setup over</div>
          <button class="prom-onb-skip" data-skip>Skip</button>
        </div>
        <div class="prom-onb-body">
          <h2 class="prom-onb-title">Import from another agent app</h2>
          <p class="prom-onb-caption">
            I can look for Hermes, OpenClaw, or LocalClaw data and show you a preview before anything is written.
          </p>
          ${devTest ? `<div style="margin-top:10px;padding:10px 12px;background:rgba(163,108,224,0.12);border:1px dashed #a36ce0;border-radius:8px;font-size:12px;color:#7a3ec1;font-weight:600">Dev test mode · importing is disabled.</div>` : ''}
          <div data-status style="font-size:12px;color:var(--muted,#666);margin:12px 0">Scanning…</div>
          <div data-sources style="display:flex;flex-direction:column;gap:10px"></div>
          <div data-preview style="display:none;margin-top:14px"></div>
          <div data-error style="display:none;color:var(--err,#c43d3d);font-size:13px;margin-top:10px"></div>
        </div>
        <div class="prom-onb-footer">
          <div style="font-size:11px;color:var(--muted,#888)" data-foot>Nothing will be imported without a preview.</div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn" data-preview-btn disabled>Preview</button>
            <button class="prom-onb-btn primary" data-import disabled>Import selected</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const statusEl = root.querySelector('[data-status]');
    const sourcesEl = root.querySelector('[data-sources]');
    const previewEl = root.querySelector('[data-preview]');
    const errorEl = root.querySelector('[data-error]');
    const footEl = root.querySelector('[data-foot]');
    const previewBtn = root.querySelector('[data-preview-btn]');
    const importBtn = root.querySelector('[data-import]');
    const skipBtn = root.querySelector('[data-skip]');

    let sources = [];
    let selectedSourceId = '';
    let previewReport = null;

    function dismiss(result) {
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => { root.remove(); resolve(result); }, 200);
    }

    async function markDone(skipped, sourceId = '') {
      if (!devTest) {
        try {
          await fetch('/api/onboarding/migration-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skipped, sourceId }),
          });
        } catch (e) {
          console.warn('[onboarding] migration-complete failed:', e);
        }
      }
    }

    function selectedOptions() {
      const mode = root.querySelector('[name="prom-migration-mode"]:checked')?.value || 'user-data';
      return {
        sourceId: selectedSourceId,
        mode,
        includeSecrets: mode === 'full',
        overwrite: !!root.querySelector('[data-overwrite]')?.checked,
        skillConflict: root.querySelector('[data-skill-conflict]')?.value || 'skip',
      };
    }

    function renderSources() {
      if (!sources.length) {
        statusEl.textContent = 'No Hermes, OpenClaw, or LocalClaw setup was found on this machine.';
        sourcesEl.innerHTML = `
          <div style="border:1px dashed var(--line,#ddd);border-radius:10px;padding:12px;background:#fff;font-size:13px;color:var(--muted,#666)">
            You can run this later from Settings → Migration if you install or locate an older setup.
          </div>
        `;
        footEl.textContent = 'You can continue onboarding now.';
        previewBtn.disabled = true;
        importBtn.disabled = true;
        return;
      }

      selectedSourceId = selectedSourceId || sources[0].id;
      statusEl.textContent = `${sources.length} source${sources.length === 1 ? '' : 's'} found.`;
      sourcesEl.innerHTML = `
        ${sources.map((source) => `
          <label style="display:flex;align-items:flex-start;gap:10px;border:1px solid ${source.id === selectedSourceId ? '#bdd3f6' : 'var(--line,#ddd)'};border-radius:10px;padding:12px;background:${source.id === selectedSourceId ? '#f0f6ff' : '#fff'};cursor:pointer">
            <input type="radio" name="prom-migration-source" value="${esc(source.id)}" ${source.id === selectedSourceId ? 'checked' : ''} style="margin-top:3px" />
            <div style="min-width:0;flex:1">
              <div style="font-size:13px;font-weight:700;color:var(--text,#222)">${esc(sourceTitle(source))}</div>
              <div style="font-size:11px;color:var(--muted,#666);word-break:break-all;margin-top:2px">${esc(source.path)}</div>
              <div style="font-size:11px;color:var(--muted,#666);margin-top:4px">${esc((source.details || []).join(' · ') || 'Candidate source')}</div>
            </div>
          </label>
        `).join('')}
        <div style="border:1px solid var(--line,#ddd);border-radius:10px;padding:12px;background:#fff">
          <div style="font-size:12px;font-weight:700;margin-bottom:8px">Import scope</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px"><input type="radio" name="prom-migration-mode" value="user-data" checked /> User data only</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:8px"><input type="radio" name="prom-migration-mode" value="full" /> Full compatible import, including supported secrets</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px"><input data-overwrite type="checkbox" /> Append/overwrite conflicts</label>
            <select data-skill-conflict style="border:1px solid var(--line,#ddd);border-radius:8px;padding:7px;font-size:12px">
              <option value="skip">Keep existing skill folders</option>
              <option value="rename">Import conflicting skills under new names</option>
              <option value="overwrite">Overwrite imported skill conflicts</option>
            </select>
          </div>
        </div>
      `;

      sourcesEl.querySelectorAll('[name="prom-migration-source"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          selectedSourceId = radio.value;
          previewReport = null;
          previewEl.style.display = 'none';
          importBtn.disabled = true;
          renderSources();
        });
      });
      previewBtn.disabled = false;
      importBtn.disabled = true;
    }

    function renderPreview(report) {
      const items = Array.isArray(report?.items) ? report.items : [];
      previewEl.style.display = 'block';
      previewEl.innerHTML = `
        <div style="border:1px solid #bdd3f6;border-radius:10px;background:#f8fbff;overflow:hidden">
          <div style="padding:10px 12px;border-bottom:1px solid #dbeafe;display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-size:13px;font-weight:700;color:#1e40af">Preview</div>
            <div style="font-size:11px;color:#1e40af">${esc(summarize(report))}</div>
          </div>
          <div style="max-height:230px;overflow:auto">
            ${items.map((item) => `
              <div style="padding:9px 12px;border-bottom:1px solid #e7eefc;display:grid;grid-template-columns:90px 1fr;gap:8px">
                <div style="font-size:11px;font-weight:700;color:${item.status === 'conflict' ? '#9a6700' : item.status === 'error' ? '#c43d3d' : '#1e40af'}">${esc(item.status)}</div>
                <div>
                  <div style="font-size:12px;color:var(--text,#222);font-weight:600">${esc(item.label)}</div>
                  <div style="font-size:11px;color:var(--muted,#666);line-height:1.5">${esc(item.reason || item.destination || item.source || '')}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      importBtn.disabled = devTest;
      footEl.textContent = devTest ? 'Dev test mode: importing is disabled.' : 'Review the preview, then import when ready.';
    }

    async function loadSources() {
      try {
        const r = await fetch('/api/migration/sources');
        if (!r.ok) throw new Error('scan failed: ' + r.status);
        const data = await r.json();
        sources = Array.isArray(data?.sources) ? data.sources : [];
        renderSources();
      } catch (e) {
        statusEl.textContent = 'Could not scan for migration sources.';
        errorEl.style.display = 'block';
        errorEl.textContent = e?.message || 'Scan failed.';
      }
    }

    previewBtn.addEventListener('click', async () => {
      if (!selectedSourceId) return;
      previewBtn.disabled = true;
      previewBtn.textContent = 'Previewing…';
      try {
        const r = await fetch('/api/migration/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selectedOptions()),
        });
        if (!r.ok) throw new Error('preview failed: ' + r.status);
        const data = await r.json();
        previewReport = data.report;
        renderPreview(previewReport);
      } catch (e) {
        errorEl.style.display = 'block';
        errorEl.textContent = e?.message || 'Preview failed.';
      } finally {
        previewBtn.disabled = false;
        previewBtn.textContent = 'Preview';
      }
    });

    importBtn.addEventListener('click', async () => {
      if (!selectedSourceId || devTest) return;
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        const r = await fetch('/api/migration/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selectedOptions()),
        });
        if (!r.ok) throw new Error('import failed: ' + r.status);
        const data = await r.json();
        previewReport = data.report;
        renderPreview(previewReport);
        await markDone(false, selectedSourceId);
        dismiss('imported');
      } catch (e) {
        errorEl.style.display = 'block';
        errorEl.textContent = e?.message || 'Import failed.';
        importBtn.disabled = false;
        importBtn.textContent = 'Import selected';
      }
    });

    skipBtn.addEventListener('click', async () => {
      await markDone(true, selectedSourceId || '');
      dismiss('skipped');
    });

    loadSources();
  });
}
