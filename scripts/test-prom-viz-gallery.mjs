// Gallery regression: every public view must have a HELP entry, and every HELP example must
// render visible output with no error. Also writes temp/prom-viz-gallery.html (all examples) for review.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const kit = readFileSync(new URL('../web-ui/vendor/prom-viz/prom-viz.js', import.meta.url), 'utf8');
const help = JSON.parse(kit.match(/\/\*HELP_START\*\/([\s\S]*?)\/\*HELP_END\*\//)[1]);
const NON_VIEWS = new Set(['version', 'help', 'insert', 'toast', 'toPng', 'csv', 'spark', 'esc', 'h', 'tooltip', 'color', 'live', 'ready', 'card', 'grid']);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const fails = [];
await page.setContent('<div id="app"></div>');
await page.addScriptTag({ content: kit });
const apiKeys = await page.evaluate(() => Object.keys(window.ui));
for (const k of apiKeys) if (!NON_VIEWS.has(k) && !help[k]) fails.push(`ui.${k} is public but has no HELP entry`);
if (!(await page.evaluate(() => typeof ui.help === 'function' && !!ui.help('bars').sig))) fails.push('ui.help() missing');
const results = {};
for (const [name, e] of Object.entries(help)) {
  if (!e.ex) continue;
  const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errs = [];
  p.on('pageerror', (er) => errs.push(er.message));
  await p.setContent('<body></body>');
  await p.addScriptTag({ content: kit });
  await p.addScriptTag({ content: e.ex });
  await p.waitForTimeout(80);
  const r = await p.evaluate(() => {
    // A mark = a visible, non-script element with real area. Views mix SVG and plain DOM (bars, heatmap).
    const els = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE'].includes(e.tagName));
    const visible = els.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; });
    const contentH = visible.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
    return { h: Math.round(contentH), marks: visible.length, notice: /Visual error|no data to show/.test(document.body.textContent) };
  });
  await p.close();
  results[name] = r.marks;
  if (errs.length) fails.push(`${name}: threw ${errs[0]}`);
  else if (r.notice) fails.push(`${name}: rendered an error/empty notice`);
  else if (r.h < 16 || r.marks < 1) fails.push(`${name}: rendered blank (h=${r.h}, marks=${r.marks})`);
}
await browser.close();
mkdirSync(new URL('../temp/', import.meta.url), { recursive: true });
const gallery = Object.entries(help).filter(([, e]) => e.ex)
  .map(([n, e]) => `<script>ui.section(null,{kicker:'ui.${n}',title:${JSON.stringify(e.sig)}});\n${e.ex};</script>`).join('\n');
writeFileSync(new URL('../temp/prom-viz-gallery.html', import.meta.url), gallery);
if (fails.length) { console.error('FAIL prom-viz gallery\n' + fails.join('\n')); process.exit(1); }
console.log('PASS prom-viz gallery', JSON.stringify(results));
