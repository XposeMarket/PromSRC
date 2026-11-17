// Match the approved mobile B new-chat hero while retaining starter suggestions.
let observer;
let scheduled = false;
export function syncAgentEmptyState() {
  const enabled = !!document.querySelector('#pm-new-chat-context-dock.ea-new-chat-context');
  for (const empty of document.querySelectorAll('.pm-mobile-empty-chat')) {
    const cards = empty.querySelector('.pm-mobile-empty-chat-cards');
    if (!enabled) {
      empty.querySelector('.ea-empty-hero')?.remove();
      const details = empty.querySelector('.ea-empty-suggestions');
      if (details && cards) { details.before(cards); details.remove(); }
      empty.classList.remove('ea-empty-state');
      continue;
    }
    empty.classList.add('ea-empty-state');
    if (!empty.querySelector('.ea-empty-hero')) {
      const hero = document.createElement('div'); hero.className = 'ea-empty-hero';
      hero.innerHTML = '<div class="ea-empty-ember" aria-hidden="true"></div><h2>Prometheus One</h2><p>"I whom you see am Prometheus, who gave fire to mankind."</p>';
      empty.prepend(hero);
    }
    if (cards && !cards.closest('.ea-empty-suggestions')) {
      const details = document.createElement('details'); details.className = 'ea-empty-suggestions';
      const summary = document.createElement('summary'); summary.textContent = 'Suggested prompts';
      cards.before(details); details.append(summary, cards);
    }
  }
}
export function watchAgentEmptyState() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; syncAgentEmptyState(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
