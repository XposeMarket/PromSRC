// Guided tour. Instead of slides describing the app, it spotlights the real
// controls in place: a cut-out highlight over the element (or a group of
// elements) plus a callout card with an arrow pointing at it. The sidebar is
// opened for the tour when it is collapsed and put back afterwards, so the
// sidebar steps never degrade into floating cards. Steps whose target is still
// missing or hidden fall back to a centered card, so the tour never breaks
// when the layout changes.
//
// Resolves with 'completed' or 'skipped'.

export const TOUR_STEPS = [
  {
    title: 'A quick look around',
    body: 'Prom is an assistant that actually does things on your computer: files, browser, code, schedules, and teams of agents. This tour takes about 30 seconds.',
  },
  {
    target: '#chat-input',
    title: 'Just ask',
    body: 'Everything starts here. Describe what you want in plain words, like "clean up my Downloads folder" or "research flights to Denver". Prom picks the tools.',
    place: 'top',
  },
  {
    target: '#model-switcher-btn',
    title: 'Switch models any time',
    body: 'This is the model doing the thinking. Click it to switch models or how hard it thinks. Your choice is saved.',
    place: 'top',
  },
  {
    target: '#sessions-new-btn',
    title: 'Chats are saved',
    body: 'Start a fresh chat for each topic. Earlier chats stay in the sidebar, and Prom keeps important facts in long-term memory.',
    place: 'right',
    needsSidebar: true,
  },
  {
    targets: ['#nav-bgtasks', '#nav-schedule', '#nav-teams'],
    title: 'Work that keeps going',
    body: 'Background tasks run long jobs while the chat stays free. Ask for something "every morning" and it lands in Schedule. For big goals, Prom can run a Team of specialist agents.',
    place: 'right',
    needsSidebar: true,
  },
  {
    target: '[onclick="openSettings()"]',
    title: 'Settings and connections',
    body: 'Connect models, apps like Gmail or GitHub, voice, and your phone. You can replay this tour from Settings › System.',
    place: 'right',
    needsSidebar: true,
  },
  {
    target: '#chat-input',
    title: "You're all set",
    body: 'We put a first question in the box for you. Press Enter to send it, or replace it with anything you want.',
    place: 'top',
    finalLabel: 'Start chatting',
    starterPrompt: 'What can you help me with on this computer?',
  },
];

function elementRect(selector) {
  if (!selector) return null;
  let el = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return null;
  return r;
}

/** Visible rect for a step: one target, or the union of every visible target in a group. */
export function stepRect(step) {
  const selectors = Array.isArray(step?.targets) ? step.targets : (step?.target ? [step.target] : []);
  const rects = selectors.map(elementRect).filter(Boolean);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function sidebarIsCollapsed() {
  const sidebar = document.getElementById('sidebar');
  return !!sidebar && sidebar.classList.contains('collapsed');
}

function setSidebar(collapsed) {
  try { if (typeof window.setSidebarCollapsed === 'function') window.setSidebarCollapsed(collapsed); } catch {}
}

export function showTutorial() {
  return new Promise((resolve) => {
    let index = 0;
    let finished = false;
    let settleTimer = 0;
    const startedCollapsed = sidebarIsCollapsed();
    let openedSidebar = false;

    const root = document.createElement('div');
    root.id = 'prom-tour-root';
    root.innerHTML = `
      <div class="prom-tour-shade" data-shade></div>
      <div class="prom-tour-spot" data-spot hidden><span class="prom-tour-pulse" aria-hidden="true"></span></div>
      <div class="prom-tour-card" role="dialog" aria-modal="true" aria-live="polite" data-card>
        <span class="prom-tour-arrow" aria-hidden="true" data-arrow></span>
        <div class="prom-tour-top">
          <span class="prom-tour-count" data-count></span>
          <button class="prom-tour-skip" data-skip type="button">Skip tour</button>
        </div>
        <h3 class="prom-tour-title" data-title></h3>
        <p class="prom-tour-body" data-body></p>
        <div class="prom-tour-bottom">
          <div class="prom-tour-dots" data-dots></div>
          <div class="prom-tour-actions">
            <button class="prom-onb-btn" data-back type="button">Back</button>
            <button class="prom-onb-btn primary" data-next type="button">Next</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const shade = root.querySelector('[data-shade]');
    const spot = root.querySelector('[data-spot]');
    const card = root.querySelector('[data-card]');
    const arrow = root.querySelector('[data-arrow]');
    const countEl = root.querySelector('[data-count]');
    const titleEl = root.querySelector('[data-title]');
    const bodyEl = root.querySelector('[data-body]');
    const dotsEl = root.querySelector('[data-dots]');
    const backBtn = root.querySelector('[data-back]');
    const nextBtn = root.querySelector('[data-next]');
    const skipBtn = root.querySelector('[data-skip]');

    function position() {
      const step = TOUR_STEPS[index];
      const rect = stepRect(step);
      const pad = 6;
      const margin = 16;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (!rect) {
        spot.hidden = true;
        shade.hidden = false;
        arrow.hidden = true;
        card.classList.add('centered');
        card.removeAttribute('data-place');
        card.style.left = '';
        card.style.top = '';
        return;
      }

      shade.hidden = true;
      spot.hidden = false;
      card.classList.remove('centered');
      spot.style.left = `${rect.left - pad}px`;
      spot.style.top = `${rect.top - pad}px`;
      spot.style.width = `${rect.width + pad * 2}px`;
      spot.style.height = `${rect.height + pad * 2}px`;

      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const order = [step.place || 'bottom', 'bottom', 'top', 'right', 'left'];
      let left = 0;
      let top = 0;
      let chosen = order[0];
      for (const place of order) {
        if (place === 'top')    { left = rect.left + rect.width / 2 - cw / 2; top = rect.top - pad - margin - ch; }
        if (place === 'bottom') { left = rect.left + rect.width / 2 - cw / 2; top = rect.bottom + pad + margin; }
        if (place === 'right')  { left = rect.right + pad + margin;           top = rect.top + rect.height / 2 - ch / 2; }
        if (place === 'left')   { left = rect.left - pad - margin - cw;        top = rect.top + rect.height / 2 - ch / 2; }
        chosen = place;
        const fits = left >= 8 && top >= 8 && left + cw <= vw - 8 && top + ch <= vh - 8;
        if (fits) break;
      }
      left = Math.max(8, Math.min(left, vw - cw - 8));
      top = Math.max(8, Math.min(top, vh - ch - 8));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;

      // Arrow on the card edge facing the target, aimed at the target's center.
      card.setAttribute('data-place', chosen);
      arrow.hidden = false;
      if (chosen === 'top' || chosen === 'bottom') {
        const x = Math.max(18, Math.min(cw - 18, rect.left + rect.width / 2 - left));
        arrow.style.left = `${x}px`;
        arrow.style.top = '';
      } else {
        const y = Math.max(18, Math.min(ch - 18, rect.top + rect.height / 2 - top));
        arrow.style.top = `${y}px`;
        arrow.style.left = '';
      }
    }

    function ensureLayoutFor(step) {
      if (step.needsSidebar && sidebarIsCollapsed()) {
        setSidebar(false);
        openedSidebar = true;
        // The sidebar animates open: re-anchor once it settles.
        clearTimeout(settleTimer);
        settleTimer = setTimeout(position, 380);
      }
    }

    function render() {
      const step = TOUR_STEPS[index];
      countEl.textContent = `${index + 1} / ${TOUR_STEPS.length}`;
      titleEl.textContent = step.title;
      bodyEl.textContent = step.body;
      dotsEl.innerHTML = TOUR_STEPS.map((_, i) => `<span class="prom-tour-dot${i === index ? ' active' : i < index ? ' done' : ''}"></span>`).join('');
      backBtn.disabled = index === 0;
      nextBtn.textContent = index === TOUR_STEPS.length - 1 ? (step.finalLabel || 'Done') : 'Next';
      skipBtn.hidden = index === TOUR_STEPS.length - 1;
      if (step.starterPrompt) {
        try {
          const input = document.getElementById('chat-input');
          if (input && !String(input.value || '').trim()) {
            input.value = step.starterPrompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch {}
      }
      card.classList.remove('enter');
      void card.offsetWidth;
      card.classList.add('enter');
      ensureLayoutFor(step);
      requestAnimationFrame(position);
      nextBtn.focus({ preventScroll: true });
    }

    function done(reason) {
      if (finished) return;
      finished = true;
      clearTimeout(settleTimer);
      window.removeEventListener('resize', position);
      document.removeEventListener('keydown', onKey, true);
      root.classList.add('leaving');
      // Leave the layout the way the user had it.
      if (openedSidebar && startedCollapsed) setSidebar(true);
      setTimeout(() => {
        root.remove();
        if (reason === 'completed') {
          try {
            const input = document.getElementById('chat-input');
            if (input) {
              input.focus();
              const end = String(input.value || '').length;
              input.setSelectionRange?.(end, end);
            }
          } catch {}
        }
        resolve(reason);
      }, 180);
    }

    function next() {
      if (index < TOUR_STEPS.length - 1) { index++; render(); }
      else done('completed');
    }
    function back() {
      if (index > 0) { index--; render(); }
    }

    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('skipped'); }
    }

    try { if (typeof window.setMode === 'function') window.setMode('chat'); } catch {}
    nextBtn.addEventListener('click', next);
    backBtn.addEventListener('click', back);
    skipBtn.addEventListener('click', () => done('skipped'));
    window.addEventListener('resize', position);
    document.addEventListener('keydown', onKey, true);
    render();
  });
}
