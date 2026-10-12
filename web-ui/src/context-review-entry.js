import { api } from './api.js';
import { mountContextReview } from './context-review.js';
// Mount lazily from existing Audit / Memory / Skills surfaces, preserving their tools.
function install() {
  ['audit-view', 'memory-view', 'skills-view', 'hub-view'].forEach(id => {
    const page = document.getElementById(id);
    if (!page || page.querySelector('[data-context-review-entry]')) return;
    const launch = document.createElement('button');
    launch.type = 'button'; launch.dataset.contextReviewEntry = '1';
    launch.textContent = id === 'hub-view' || id === 'skills-view' ? 'Review skill routing evidence' : 'Review context evidence';
    launch.style.cssText = 'align-self:flex-start;margin:8px 0 16px;padding:10px 14px;border:1px solid var(--line);border-radius:9px;color:var(--text);background:transparent;cursor:pointer';
    launch.onclick = () => {
      let host = page.querySelector('[data-context-review-host]');
      if (host) { host.hidden = !host.hidden; return; }
      host = document.createElement('div'); host.dataset.contextReviewHost = '1'; page.insertBefore(host, launch.nextSibling);
      mountContextReview(host, { api, initialTab: id === 'hub-view' || id === 'skills-view' ? 'skills' : 'context' });
    };
    page.prepend(launch);
  });
}
install();
window.addEventListener('DOMContentLoaded', install, { once: true });

// Page owners may replace their markup after asynchronous loads. Re-anchor the
// launcher without taking ownership of their rendering or installing timers.
let installQueued = false;
const observer = new MutationObserver(() => {
  if (installQueued) return;
  installQueued = true;
  queueMicrotask(() => { installQueued = false; install(); });
});
if (document.body) observer.observe(document.body, { childList: true, subtree: true });
function openEvidenceLink() {
  if (!/^#context-review(?:\/skills)?$/.test(window.location.hash)) return;
  const skill = window.location.hash.endsWith('/skills');
  window.setMode?.(skill ? 'hub' : 'audit');
  install();
  const launcher = document.querySelector('#' + (skill ? 'hub-view' : 'audit-view') + ' [data-context-review-entry]');
  const host = launcher?.parentElement?.querySelector('[data-context-review-host]');
  if (host) host.hidden = false; else launcher?.click();
}
window.addEventListener('hashchange', openEvidenceLink);
window.addEventListener('DOMContentLoaded', openEvidenceLink, { once: true });
