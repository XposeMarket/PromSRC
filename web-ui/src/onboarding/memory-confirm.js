// Final onboarding step: shows the user exactly what will be written into their
// workspace memory files (USER.md / BUSINESS.md / TOOLS.md / MEMORY.md), with
// per-file checkboxes. Nothing is persisted until they hit Save.

export function showMemoryConfirm(profile, opts = {}) {
  const devTest = !!opts.devTest;
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Save onboarding memory">
        <div class="prom-onb-header">
          <div class="prom-onb-step">Step · Save what you told me</div>
          <button class="prom-onb-skip" data-skip>Skip — don't save anything</button>
        </div>
        <div class="prom-onb-body">
          <h2 class="prom-onb-title">Lock in your starting context</h2>
          <p class="prom-onb-caption">
            Here's what I'd add to my memory based on our conversation. Uncheck
            anything you'd rather not save. You can always edit these files later.
          </p>
          ${devTest ? `<div style="margin-top:10px;padding:10px 12px;background:rgba(163,108,224,0.12);border:1px dashed #a36ce0;border-radius:8px;font-size:12px;color:#7a3ec1;font-weight:600">🧪 Dev test mode — saving is disabled. No memory will be written.</div>` : ''}
          <div data-plans style="margin-top:14px;display:flex;flex-direction:column;gap:10px"></div>
          <div data-error style="display:none;color:var(--err,#c43d3d);font-size:13px;margin-top:10px"></div>
        </div>
        <div class="prom-onb-footer">
          <div style="font-size:11px;color:var(--muted,#888)" data-status>Loading proposed changes…</div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn primary" data-save disabled>Save selected</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const plansEl  = root.querySelector('[data-plans]');
    const saveBtn  = root.querySelector('[data-save]');
    const skipBtn  = root.querySelector('[data-skip]');
    const statusEl = root.querySelector('[data-status]');
    const errorEl  = root.querySelector('[data-error]');

    let plans = [];

    function dismiss() {
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 200);
    }

    function fileLabel(p) {
      const parts = p.split(/[\\\/]/);
      return parts[parts.length - 1] || p;
    }

    function renderPlans() {
      const changedPlans = plans.filter(p => p.changed);
      if (!changedPlans.length) {
        plansEl.innerHTML = `<div style="font-size:13px;color:var(--muted,#666);font-style:italic">Nothing to save — looks like you skipped everything. That's fine, we can always come back to this.</div>`;
        statusEl.textContent = 'Nothing to save.';
        saveBtn.disabled = true;
        saveBtn.textContent = 'Continue';
        saveBtn.disabled = false;
        return;
      }
      plansEl.innerHTML = changedPlans.map((p, i) => {
        const added = p.proposedContent.length - p.currentContent.length;
        const verb = p.exists ? 'Update' : 'Create';
        const proposedEsc = p.proposedContent
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
          <div class="prom-onb-plan" style="border:1px solid var(--line,#e2e2e8);border-radius:10px;overflow:hidden">
            <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(99,102,241,0.06);cursor:pointer">
              <input type="checkbox" data-plan-idx="${i}" checked style="width:16px;height:16px;cursor:pointer"/>
              <div style="flex:1">
                <div style="font-weight:600;font-size:13px;color:var(--text,#222)">${verb} <code style="background:#fff;padding:1px 6px;border-radius:4px;font-size:12px">${fileLabel(p.path)}</code></div>
                <div style="font-size:11px;color:var(--muted,#777);margin-top:2px">${added > 0 ? `+${added} chars` : `${added} chars`}</div>
              </div>
              <button type="button" data-toggle-idx="${i}" style="border:none;background:transparent;color:var(--brand,#0d4faf);font-size:12px;cursor:pointer;font-family:inherit">Show preview</button>
            </label>
            <pre data-preview-idx="${i}" style="display:none;margin:0;padding:12px;background:#fafbff;font-size:11px;line-height:1.5;font-family:'IBM Plex Mono',monospace;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#22263a">${proposedEsc}</pre>
          </div>
        `;
      }).join('');

      plansEl.querySelectorAll('[data-toggle-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = btn.getAttribute('data-toggle-idx');
          const pre = plansEl.querySelector(`[data-preview-idx="${idx}"]`);
          if (!pre) return;
          const open = pre.style.display === 'block';
          pre.style.display = open ? 'none' : 'block';
          btn.textContent = open ? 'Show preview' : 'Hide preview';
        });
      });

      statusEl.textContent = `${changedPlans.length} file${changedPlans.length === 1 ? '' : 's'} ready.`;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save selected';
    }

    async function loadPlans() {
      try {
        const r = await fetch('/api/onboarding/memory-seed?dryRun=true', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: profile || {}, dryRun: true }),
        });
        if (!r.ok) throw new Error('plan request failed: ' + r.status);
        const data = await r.json();
        plans = Array.isArray(data?.plans) ? data.plans : [];
        renderPlans();
      } catch (e) {
        console.warn('[onboarding] memory-seed dry run failed:', e);
        statusEl.textContent = 'Could not load preview.';
        errorEl.style.display = 'block';
        errorEl.textContent = 'Could not load proposed changes. You can skip this step and edit memory files manually later.';
      }
    }

    saveBtn.addEventListener('click', async () => {
      if (devTest) { dismiss(); resolve('dev_test_no_write'); return; }
      const changedPlans = plans.filter(p => p.changed);
      if (!changedPlans.length) { dismiss(); resolve('nothing_to_save'); return; }

      const approvedPaths = [];
      changedPlans.forEach((p, i) => {
        const cb = plansEl.querySelector(`[data-plan-idx="${i}"]`);
        if (cb && cb.checked) approvedPaths.push(p.path);
      });

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const r = await fetch('/api/onboarding/memory-seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: profile || {}, approvedPaths }),
        });
        if (!r.ok) throw new Error('save failed: ' + r.status);
        dismiss();
        resolve('saved');
      } catch (e) {
        console.warn('[onboarding] memory-seed save failed:', e);
        errorEl.style.display = 'block';
        errorEl.textContent = 'Save failed. ' + (e?.message || 'Try again.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save selected';
      }
    });

    skipBtn.addEventListener('click', async () => {
      if (!devTest) {
        try {
          await fetch('/api/onboarding/memory-seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: profile || {}, approvedPaths: [] }),
          });
        } catch (e) { console.warn('[onboarding] skip-seed call failed:', e); }
      }
      dismiss();
      resolve('skipped');
    });

    loadPlans();
  });
}
