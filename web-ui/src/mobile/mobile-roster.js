import { resolveKeyboardBandTop } from './mobile-keyboard-band.js';

// Run history is independent of directory order and of chat/metadata edits.
export function latestRosterRun(rows) {
  return rows.reduce((best, row) => Number(row.lastRunAt) > Number(best?.lastRunAt || 0) ? row : best, null);
}

export function wireRosterSearch(page, body, label, refresh) {
  const dock = document.createElement('label');
  dock.className = 'pm-roster-search';
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = `Search ${label}`; input.setAttribute('aria-label', input.placeholder);
  dock.append(input); page.append(dock);
  const empty = document.createElement('p'); empty.className = 'pm-roster-no-match'; empty.setAttribute('role', 'status');
  const filter = () => {
    const q = input.value.toLocaleLowerCase().trim();
    const tiles = [...body.querySelectorAll('[data-subagent], [data-team]')];
    let matches = 0;
    for (const tile of tiles) {
      tile.hidden = !tile.textContent.toLocaleLowerCase().includes(q); if (!tile.hidden) matches++;
    }
    const preview = body.querySelector('.pm-team-preview'); if (preview) preview.hidden = !!q;
    empty.textContent = `No matching ${label}`; empty.hidden = !q || !tiles.length || !!matches;
    if (tiles.length && !empty.isConnected) body.append(empty);
  };
  input.addEventListener('input', filter);
  const vv = window.visualViewport;
  let baseline = 0;
  const place = () => {
    dock.style.removeProperty('bottom');
    if (document.activeElement !== input || !vv || baseline - vv.height < 80) return;
    // Measure the fixed containing block, not innerHeight: some WebViews already shrink it.
    dock.style.bottom = '0px';
    dock.style.bottom = `${Math.max(0, dock.getBoundingClientRect().bottom - resolveKeyboardBandTop({offsetTop:vv.offsetTop, pageTop:vv.pageTop, rootTop:document.documentElement.getBoundingClientRect().top}) - vv.height)}px`;
  };
  input.addEventListener('focus', () => { baseline = vv?.height || innerHeight; place(); });
  input.addEventListener('blur', place); vv?.addEventListener('resize', place); vv?.addEventListener('scroll', place);
  let busy = false;
  const timer = setInterval(async () => { if (busy || document.hidden || !dock.isConnected) return; busy = true; try { await refresh(); } catch {} finally { busy = false; } }, 10000);
  page._pmCleanup = () => { clearInterval(timer); vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place); };
  return filter;
}
