// Guided tour. Instead of slides describing the app, it spotlights the real
// controls in place: a cut-out highlight over the element plus a callout card
// anchored next to it. Steps whose target is missing or hidden fall back to a
// centered card, so the tour never breaks when the layout changes.
//
// Resolves with 'completed' or 'skipped'.

const STEPS = [
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
  },
  {
    target: '#nav-bgtasks',
    title: 'Long jobs run in the background',
    body: 'Big work runs here so the chat stays free. Check progress or results whenever you like.',
    place: 'right',
  },
  {
    target: '#nav-schedule',
    title: 'Put work on autopilot',
    body: 'Ask for something "every morning" or "every Friday" and it shows up here as an automation.',
    place: 'right',
  },
  {
    target: '#nav-teams',
    title: 'Teams for bigger projects',
    body: 'For bigger goals, Prom can create a team of specialist agents, manage them, and report back.',
    place: 'right',
  },
  {
    target: '[onclick="openSettings()"]',
    title: 'Settings and connections',
    body: 'Connect models, apps like Gmail or GitHub, voice, and your phone. You can replay this tour from Settings › System.',
    place: 'right',
  },
  {
    title: "You're all set",
    body: 'Try asking something real. A good first one: "What can you help me with on this computer?"',
    finalLabel: 'Start chatting',
  },
];

function visibleRect(selector) {
  if (!selector) return null;
  let el = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  return r;
}

export function showTutorial() {
  return new Promise((resolve) => {
    let index = 0;
    let finished = false;

    const root = document.createElement('div');
    root.id = 'prom-tour-root';
    root.innerHTML = `
      <div class="prom-tour-shade" data-shade></div>
      <div class="prom-tour-spot" data-spot hidden></div>
      <div class="prom-tour-card" role="dialog" aria-modal="true" aria-live="polite" data-card>
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
    const countEl = root.querySelector('[data-count]');
    const titleEl = root.querySelector('[data-title]');
    const bodyEl = root.querySelector('[data-body]');
    const dotsEl = root.querySelector('[data-dots]');
    const backBtn = root.querySelector('[data-back]');
    const nextBtn = root.querySelector('[data-next]');
    const skipBtn = root.querySelector('[data-skip]');

    function position() {
      const step = STEPS[index];
      const rect = visibleRect(step.target);
      const pad = 6;
      const margin = 14;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (!rect) {
        spot.hidden = true;
        shade.hidden = false;
        card.classList.add('centered');
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
      for (const place of order) {
        if (place === 'top')    { left = rect.left + rect.width / 2 - cw / 2; top = rect.top - pad - margin - ch; }
        if (place === 'bottom') { left = rect.left + rect.width / 2 - cw / 2; top = rect.bottom + pad + margin; }
        if (place === 'right')  { left = rect.right + pad + margin;           top = rect.top + rect.height / 2 - ch / 2; }
        if (place === 'left')   { left = rect.left - pad - margin - cw;        top = rect.top + rect.height / 2 - ch / 2; }
        const fits = left >= 8 && top >= 8 && left + cw <= vw - 8 && top + ch <= vh - 8;
        if (fits) break;
      }
      left = Math.max(8, Math.min(left, vw - cw - 8));
      top = Math.max(8, Math.min(top, vh - ch - 8));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    function render() {
      const step = STEPS[index];
      countEl.textContent = `${index + 1} / ${STEPS.length}`;
      titleEl.textContent = step.title;
      bodyEl.textContent = step.body;
      dotsEl.innerHTML = STEPS.map((_, i) => `<span class="prom-tour-dot${i === index ? ' active' : i < index ? ' done' : ''}"></span>`).join('');
      backBtn.disabled = index === 0;
      nextBtn.textContent = index === STEPS.length - 1 ? (step.finalLabel || 'Done') : 'Next';
      skipBtn.hidden = index === STEPS.length - 1;
      card.classList.remove('enter');
      void card.offsetWidth;
      card.classList.add('enter');
      requestAnimationFrame(position);
      nextBtn.focus({ preventScroll: true });
    }

    function done(reason) {
      if (finished) return;
      finished = true;
      window.removeEventListener('resize', position);
      document.removeEventListener('keydown', onKey, true);
      root.classList.add('leaving');
      setTimeout(() => {
        root.remove();
        if (reason === 'completed') {
          try { document.getElementById('chat-input')?.focus(); } catch {}
        }
        resolve(reason);
      }, 180);
    }

    function next() {
      if (index < STEPS.length - 1) { index++; render(); }
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
