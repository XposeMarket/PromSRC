import assert from 'node:assert/strict';
import { citeChips, renderSourcePills } from './index.js';

const a = (href, text) => `<a href="${href}">${text}</a>`;
assert.match(citeChips(a('https://www.reuters.com/markets/x', 'Reuters')), /class="pc-cite"[^>]*>.*Reuters<\/a>/);
assert.match(citeChips(a('https://create.roblox.com/docs', 'Roblox')), /pc-cite/);
assert.match(citeChips(a('https://git-scm.com/docs', '1')), /git-scm\.com<\/a>/);
assert.match(citeChips(a('https://www.cnbc.com/2026/x', 'cnbc.com')), /pc-cite/);
// Ordinary prose links stay plain.
assert.doesNotMatch(citeChips(a('https://www.reuters.com/x', 'the latest Fed story')), /pc-cite/);
assert.doesNotMatch(citeChips(a('https://forecast.weather.gov/x', 'NWS forecast for Frederick')), /pc-cite/);

const html = renderSourcePills({ title: 'Sources', items: [{ url: 'https://www.rtings.com/kb', title: 'Best <Budget>' }, { url: 'nope' }] });
assert.match(html, /pc-src-pills/);
assert.match(html, /rtings\.com/);
assert.match(html, /Best &lt;Budget&gt;/);
assert.equal(renderSourcePills({ items: [] }), '');
console.log('cite-chips regression: ok');
