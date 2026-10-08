// Regression: the exact wrong-shape calls from a real broken visual (2026-10-08) must still render,
// and a thrown error must surface as a visible notice instead of a blank visual.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const kit = readFileSync(new URL('../web-ui/vendor/prom-viz/prom-viz.js', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="app"></div>');
await page.addScriptTag({ content: kit });
const r = await page.evaluate(() => {
  const root = document.getElementById('app');
  ui.page(root, { title: 'T', subtitle: 'S' });
  ui.kpis(root, [{ label: 'A', value: 1 }]);
  ui.bars(root, [{ label: 'x', value: 2 }, { label: 'y', value: 1 }]);
  ui.donut(root, [{ label: 'a', value: 3 }, { label: 'b', value: 1 }]);
  ui.table(root, { columns: ['PR', 'Change'], rows: [['#1', 'one'], ['#2', 'two']] });
  ui.table(root, [{ k: 'v' }]);
  ui.bars(root, {});
  return {
    title: !!document.querySelector('.pv-h1'),
    bars: document.querySelectorAll('.pv-bars').length,
    donut: document.querySelectorAll('.pv-donut svg, .pv-donut path').length,
    cells: [...document.querySelectorAll('.pv-table td')].map(t => t.textContent),
    empty: document.body.textContent.includes('Bars: no data to show'),
  };
});
await page.addScriptTag({ content: "setTimeout(function(){ throw new Error('boom'); }, 0)" });
await page.waitForTimeout(200);
const err = await page.evaluate(() => /Visual error:.*boom/.test(document.body.textContent));
await browser.close();
const fails = [];
if (!r.title) fails.push('page(root,{...}) lost the title');
if (r.bars < 1) fails.push('bars(array) rendered nothing');
if (r.donut < 1) fails.push('donut(array) rendered nothing');
for (const c of ['#1', 'one', '#2', 'two', 'v']) if (!r.cells.includes(c)) fails.push('table missing cell ' + c);
if (!r.empty) fails.push('empty bars had no notice');
if (!err) fails.push('runtime error not surfaced');
if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS prom-viz forgiving', JSON.stringify(r));
