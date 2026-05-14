// Animated tutorial overlay. 7 panels introducing Prometheus's main surfaces.
// Pure HTML/CSS/SVG — no video dependency. Resolves with 'completed' or 'skipped'.

const PANELS = [
  {
    title: 'Welcome to Prometheus',
    caption: 'I\'m your everything-AI. Anything you can describe, I can probably help you do — chat, files, browser, desktop, the works.',
    illus: svgWelcome(),
  },
  {
    title: 'Your chat is the command line',
    caption: 'Talk to me like a teammate. I remember context, I write to my own memory, and I can hand work off to background agents.',
    illus: svgChat(),
  },
  {
    title: 'Tasks run in the background',
    caption: 'Long jobs go to the Tasks tab so the chat stays responsive. Check back any time to see progress or final results.',
    illus: svgTasks(),
  },
  {
    title: 'Schedule & Heartbeat keep me alive',
    caption: 'I can run on a cron, or on a recurring heartbeat to check in on your goals — even when you\'re not at your desk.',
    illus: svgSchedule(),
  },
  {
    title: 'Teams and Subagents do parallel work',
    caption: 'Spin up a team for big projects. I act as the manager, dispatching specialized subagents to work in parallel.',
    illus: svgTeams(),
  },
  {
    title: 'Browser, Desktop, Canvas, Files',
    caption: 'I can drive a real browser, click around your desktop, edit files in a shared canvas, and execute code. Real tools, not just text.',
    illus: svgTools(),
  },
  {
    title: 'Last step: connect your brain',
    caption: 'Pick a model provider next — ChatGPT, Claude, an API key, or local Ollama. After that we\'ll do a quick meet-and-greet.',
    illus: svgModel(),
  },
];

export function showTutorial() {
  return new Promise((resolve) => {
    let index = 0;

    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Prometheus onboarding tutorial">
        <div class="prom-onb-header">
          <div class="prom-onb-step" data-step>Step 1 of ${PANELS.length}</div>
          <button class="prom-onb-skip" data-skip>Skip tour</button>
        </div>
        <div class="prom-onb-body">
          <div class="prom-onb-illus" data-illus></div>
          <h2 class="prom-onb-title" data-title></h2>
          <p class="prom-onb-caption" data-caption></p>
        </div>
        <div class="prom-onb-footer">
          <div class="prom-onb-dots" data-dots></div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn" data-back>Back</button>
            <button class="prom-onb-btn primary" data-next>Next</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const stepEl    = root.querySelector('[data-step]');
    const illusEl   = root.querySelector('[data-illus]');
    const titleEl   = root.querySelector('[data-title]');
    const captionEl = root.querySelector('[data-caption]');
    const dotsEl    = root.querySelector('[data-dots]');
    const backBtn   = root.querySelector('[data-back]');
    const nextBtn   = root.querySelector('[data-next]');
    const skipBtn   = root.querySelector('[data-skip]');

    function render() {
      const p = PANELS[index];
      stepEl.textContent  = `Step ${index + 1} of ${PANELS.length}`;
      illusEl.innerHTML   = p.illus;
      titleEl.textContent = p.title;
      captionEl.textContent = p.caption;
      dotsEl.innerHTML = PANELS.map((_, i) => {
        const cls = i === index ? 'active' : (i < index ? 'done' : '');
        return `<div class="prom-onb-dot ${cls}"></div>`;
      }).join('');
      backBtn.disabled = index === 0;
      nextBtn.textContent = (index === PANELS.length - 1) ? 'Finish' : 'Next';
    }

    function done(reason) {
      root.style.transition = 'opacity 180ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => { root.remove(); resolve(reason); }, 180);
    }

    backBtn.addEventListener('click', () => { if (index > 0) { index--; render(); } });
    nextBtn.addEventListener('click', () => {
      if (index < PANELS.length - 1) { index++; render(); }
      else done('completed');
    });
    skipBtn.addEventListener('click', () => done('skipped'));

    render();
  });
}

// ── SVG illustrations (compact, brand-aligned) ──

function svgWelcome() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#a36ce0"/>
    </linearGradient></defs>
    <circle cx="100" cy="70" r="46" fill="url(#g1)"/>
    <path d="M 100 38 L 114 70 L 100 102 L 86 70 Z" fill="#fff" opacity="0.9"/>
    <circle cx="100" cy="70" r="6" fill="#0d4faf"/>
  </svg>`;
}
function svgChat() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="20" y="30" width="120" height="36" rx="10" fill="#dbe5ff"/>
    <rect x="60" y="76" width="120" height="36" rx="10" fill="#0d4faf"/>
    <circle cx="36" cy="48" r="5" fill="#0d4faf"/><circle cx="52" cy="48" r="5" fill="#0d4faf"/><circle cx="68" cy="48" r="5" fill="#0d4faf"/>
    <circle cx="80" cy="94" r="5" fill="#fff"/><circle cx="96" cy="94" r="5" fill="#fff"/><circle cx="112" cy="94" r="5" fill="#fff"/>
  </svg>`;
}
function svgTasks() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="30" y="28" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="28" width="100" height="20" rx="5" fill="#0d4faf"/>
    <rect x="30" y="58" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="58" width="60" height="20" rx="5" fill="#5b8def"/>
    <rect x="30" y="88" width="140" height="20" rx="5" fill="#e6f0ff"/>
    <rect x="30" y="88" width="130" height="20" rx="5" fill="#a36ce0"/>
  </svg>`;
}
function svgSchedule() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="70" r="44" fill="none" stroke="#0d4faf" stroke-width="3"/>
    <line x1="100" y1="70" x2="100" y2="38" stroke="#0d4faf" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="70" x2="124" y2="78" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="70" r="4" fill="#0d4faf"/>
  </svg>`;
}
function svgTeams() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="50" r="14" fill="#0d4faf"/>
    <circle cx="56"  cy="96" r="12" fill="#5b8def"/>
    <circle cx="100" cy="96" r="12" fill="#5b8def"/>
    <circle cx="144" cy="96" r="12" fill="#5b8def"/>
    <line x1="100" y1="64" x2="56"  y2="84" stroke="#a8b8d8" stroke-width="2"/>
    <line x1="100" y1="64" x2="100" y2="84" stroke="#a8b8d8" stroke-width="2"/>
    <line x1="100" y1="64" x2="144" y2="84" stroke="#a8b8d8" stroke-width="2"/>
  </svg>`;
}
function svgTools() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="20"  y="34" width="40" height="40" rx="8" fill="#5b8def"/>
    <rect x="74"  y="34" width="40" height="40" rx="8" fill="#a36ce0"/>
    <rect x="128" y="34" width="40" height="40" rx="8" fill="#0d4faf"/>
    <rect x="20"  y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
    <rect x="74"  y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
    <rect x="128" y="86" width="40" height="22" rx="6" fill="#dbe5ff"/>
  </svg>`;
}
function svgModel() {
  return `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="70" r="36" fill="#fff" stroke="#0d4faf" stroke-width="3"/>
    <path d="M 80 70 L 95 84 L 122 56" stroke="#0d4faf" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="44"  y1="70" x2="60"  y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="140" y1="70" x2="156" y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="22" x2="100" y2="34" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
    <line x1="100" y1="106" x2="100" y2="118" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
