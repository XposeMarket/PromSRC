import { buildMobileAttachmentInlineUrl } from '../mobile/mobile-api.js';

// Shared content preview. Existing hosts retain their approval/risk controls.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const drafts = new Map();
function mediaUrl(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /[:%?#\x00-\x1f]/.test(p) || p.split('/').some(x => !x || x === '..' || x === '.') || !/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i.test(p)) return '';
  return buildMobileAttachmentInlineUrl(p);
}
export function renderContentReview(record = {}) {
  const r = record.contentReview || record.finalAction?.contentReview;
  if (!r || !['post','generation','proposal'].includes(r.kind)) return '';
  const media = (Array.isArray(r.media) ? r.media : []).map((m, i) => {
    const url = mediaUrl(m.path); if (!url) return '';
    const alt = esc(m.label || `Media ${i + 1}`);
    return `<figure style="margin:0;flex:0 0 100%;scroll-snap-align:start">${m.kind === 'video' ? `<video controls playsinline preload="metadata" ${m.cover && mediaUrl(m.cover) ? `poster="${esc(mediaUrl(m.cover))}"` : ''} src="${esc(url)}" aria-label="${alt}" style="width:100%;max-height:420px;object-fit:contain"></video>` : `<a href="${esc(url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url)}" alt="${alt}" style="display:block;width:100%;max-height:420px;object-fit:contain"></a>`}<figcaption style="font-size:12px;opacity:.7">${i + 1} / ${r.media.length}${m.label ? ' · ' + alt : ''}</figcaption></figure>`;
  }).join('');
  const fields = [['Destination', [r.platform, r.account].filter(Boolean).join(' · ')], ['Audience', r.visibility], ['When', r.timing], ['Model', r.model], ['Usage / cost', r.cost || (r.kind === 'generation' ? 'Not quoted' : '')]];
  return `<section class="content-review" data-content-review-id="${esc(record.id)}" style="margin:14px 0;padding:14px;border:1px solid var(--border-color,rgba(128,128,128,.25));border-radius:14px;min-width:0">
    ${fields.filter(([,v])=>v).map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px"><span style="opacity:.65">${k}</span><strong style="text-align:right;overflow-wrap:anywhere">${esc(v)}</strong></div>`).join('')}
    ${media ? `<div style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px">${media}</div>` : ''}
    <strong style="display:block;margin-top:12px;font-size:12px">${r.kind === 'generation' ? 'FULL PROMPT' : 'FULL CAPTION / CONTENT'}</strong>
    <div class="content-review-text" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px">${esc(r.text)}</div>
    <p style="font-size:12px;opacity:.65;margin:12px 0 0">${r.kind === 'proposal' ? 'Proposal approval authorizes its stated work, not publication.' : 'Preview supplied by the requesting agent. Approval is not proof of publication. Changes require a new prepared request.'}</p>
    ${record.status === 'pending' && record.approvalKind === 'final_action' ? `<button type="button" data-content-review-edit style="margin-top:12px;min-height:44px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:10px;padding:8px 12px">Edit caption / Request changes</button><div data-content-review-editor ${drafts.has(record.id) ? '' : 'hidden'}><label style="display:block;margin-top:12px">Revised caption or instructions<textarea data-content-review-draft rows="5" style="width:100%;box-sizing:border-box;margin:8px 0;background:transparent;color:inherit;border:1px solid currentColor;border-radius:8px;padding:10px">${esc(drafts.get(record.id) ?? r.text)}</textarea></label><button type="button" data-content-review-send style="min-height:44px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:10px;padding:8px 12px">Send changes for fresh review</button><button type="button" data-content-review-cancel style="min-height:44px;margin-left:8px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:10px;padding:8px 12px">Cancel</button></div><div data-content-review-message role="status"></div>` : ''}
  </section>`;
}
if (typeof document !== 'undefined') {
  // Capture before host button/slide handlers: an unsent local edit must not approve old content.
  const blockWhileEditing = event => {
    const card = event.target.closest?.('.chat-approval-card,.pm-chat-approval');
    const section = card?.querySelector('[data-content-review-id]');
    if (!section || event.target.closest('[data-content-review-id]')) return;
    const editor = section.querySelector('[data-content-review-editor]');
    if (editor && !editor.hidden && event.target.closest('button,[data-pm-approval-action],.pm-approval-slide')) {
      event.preventDefault(); event.stopImmediatePropagation();
      section.querySelector('[data-content-review-message]').textContent = 'Send your changes for fresh review or cancel editing first.';
    }
  };
  document.addEventListener('click', blockWhileEditing, true);
  document.addEventListener('pointerdown', blockWhileEditing, true);
  document.addEventListener('touchstart', blockWhileEditing, { capture:true, passive:false });
  document.addEventListener('input', event => {
    const el = event.target; if (!el?.matches?.('[data-content-review-draft]')) return;
    drafts.set(el.closest('[data-content-review-id]').dataset.contentReviewId, el.value);
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-content-review-edit],[data-content-review-send],[data-content-review-cancel]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const section = button.closest('[data-content-review-id]');
    const editor = section.querySelector('[data-content-review-editor]');
    const message = section.querySelector('[data-content-review-message]');
    if (button.hasAttribute('data-content-review-edit')) { editor.hidden = false; drafts.set(section.dataset.contentReviewId, section.querySelector('textarea').value); section.querySelector('textarea').focus(); return; }
    if (button.hasAttribute('data-content-review-cancel')) { editor.hidden = true; drafts.delete(section.dataset.contentReviewId); return; }
    const feedback = section.querySelector('textarea').value;
    if (!feedback.trim()) { message.textContent = 'Describe the change first.'; return; }
    button.disabled = true;
    try {
      const { api } = await import('../api.js');
      const result = await api(`/api/approvals/${encodeURIComponent(section.dataset.contentReviewId)}/content-changes`, { method:'POST', body:JSON.stringify({feedback}) });
      if (!result.success) throw new Error(result.error || 'Could not send changes.');
      editor.hidden = true; message.textContent = 'Changes requested. This request cannot post; the agent must prepare a new approval.';
      drafts.delete(section.dataset.contentReviewId);
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}
