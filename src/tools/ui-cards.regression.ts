// Regression: show_ui_card live-data builders + frontend card renderers.
// Network-backed builders run against the real keyless APIs (bounded); pure
// renderers are checked for structure, escaping, and malformed-input safety.
import assert from 'node:assert/strict';
import { buildCurrencyCard, buildClockCard, buildSportsCard, normalizeCurrencyCode, resolveLeague, mapEspnEvent, buildProductCard, buildPlacesCard } from './ui-cards.js';
// @ts-ignore web-ui JS module
import { renderInteractiveCard, reduceInteractiveCard, normalizeQuiz } from '../../web-ui/src/cards/cards-interactive.js';
// @ts-ignore web-ui JS module
import { renderDataCard, youTubeId } from '../../web-ui/src/cards/cards-data.js';
// @ts-ignore web-ui JS module
import { extractCardFences, citeChips } from '../../web-ui/src/cards/index.js';

// inline citation chips: [1]-style and hostname links become pills, prose links untouched
const cited = citeChips('<p>Score <a href="https://www.nba.com/game/1">[1]</a> and <a href="https://espn.com/x">read the recap</a> via <a href="https://www.wnba.com/s">wnba.com</a></p>');
assert.ok(cited.includes('class="pc-cite" href="https://www.nba.com/game/1"') && cited.includes('>nba.com</a>'), 'numeric citation -> chip');
assert.ok(cited.includes('<a href="https://espn.com/x">read the recap</a>'), 'prose link untouched');
assert.ok(cited.includes('>wnba.com</a>') && (cited.match(/pc-cite/g) || []).length === 2, 'hostname link -> chip');

const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = performance.now();
  try { return await fn(); } finally { timings[label] = Math.round(performance.now() - s); }
}

// pure helpers
assert.equal(normalizeCurrencyCode('euros'), 'EUR');
assert.equal(normalizeCurrencyCode('usd'), 'USD');
assert.equal(resolveLeague('NBA')?.league, 'nba');
assert.equal(resolveLeague('premier league')?.league, 'eng.1');
assert.equal(resolveLeague('curling'), null);
assert.equal(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'dQw4w9WgXcQ');
assert.equal(youTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
const ev = mapEspnEvent({ id: '1', name: 'A at B', status: { type: { state: 'in', shortDetail: '5:00 - 3rd' } }, competitions: [{ competitors: [
  { homeAway: 'home', score: '80', team: { abbreviation: 'B', shortDisplayName: 'Bees' }, linescores: [{ value: 20 }, { value: 30 }] },
  { homeAway: 'away', score: '69', team: { abbreviation: 'A', shortDisplayName: 'Ants' }, linescores: [{ value: 23 }] }] }] }, 'basketball');
assert.equal(ev.home.score, '80'); assert.equal(ev.away.abbr, 'A'); assert.deepEqual(ev.home.linescores, [20, 30]);

// interactive cards: quiz flow, answer letter normalization, escaping
const quizSpec = { title: 'T', questions: [{ question: 'Q <b>1</b>', options: ['a', 'b'], answer: 'B', hint: 'h' }, { question: 'Q2', options: ['x', 'y', 'z'], answer: 0 }] };
assert.equal(normalizeQuiz(quizSpec).questions[0].answer, 1, 'letter answers map to index');
let st: any = {};
let html = renderInteractiveCard('quiz', 'q1', JSON.stringify(quizSpec), st);
assert.ok(html.includes('Q &lt;b&gt;1&lt;/b&gt;'), 'question is escaped');
assert.ok(html.includes('data-pc-act="quiz-lock" disabled'), 'lock disabled before a pick');
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-pick', { k: '1' });
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-lock');
assert.ok(renderInteractiveCard('quiz', 'q1', JSON.stringify(quizSpec), st).includes('Correct!'));
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-next');
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-pick', { k: '2' });
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-lock');
st = reduceInteractiveCard('quiz', quizSpec, st, 'quiz-finish');
assert.ok(renderInteractiveCard('quiz', 'q1', JSON.stringify(quizSpec), st).includes('<strong>1/2</strong>'), 'score summary');
// flashcards cycle + missed review
const fc = { cards: [{ front: 'a', back: '1' }, { front: 'b', back: '2' }] };
let fs: any = reduceInteractiveCard('flashcards', fc, {}, 'fc-know');
fs = reduceInteractiveCard('flashcards', fc, fs, 'fc-miss');
assert.ok(renderInteractiveCard('flashcards', 'f', JSON.stringify(fc), fs).includes('Review 1 missed'));
assert.deepEqual(reduceInteractiveCard('flashcards', fc, fs, 'fc-missed').order, [1]);
// malformed bodies never throw and show an error card
assert.ok(renderInteractiveCard('quiz', 'x', '{not json', {}).includes("Couldn't render quiz"));
assert.ok(renderInteractiveCard('poll', 'x', '{"question":"q","options":["only"]}', {}).includes("Couldn't render poll"));
assert.ok(renderInteractiveCard('followups', 'x', '- one\n- two', {}).includes('data-prompt="one"'), 'followups accept a plain list');
assert.ok(renderInteractiveCard('writing', 'x', 'Plain text draft', {}).includes('Plain text draft'), 'writing accepts plain text');
// fence extraction: complete fence -> placeholder, open fence hidden while streaming
const ex = extractCardFences('Hi\n```poll\n{"question":"q","options":["a","b"]}\n```\nbye\n```quiz\n{"questions":[', 'PH');
assert.equal(ex.cards.length, 1);
assert.ok(ex.text.includes('PH0END'));
assert.ok(!ex.text.includes('"questions"'), 'streaming open fence is not shown raw');
assert.ok(ex.text.includes('Building quiz'));
// data cards: XSS-safe urls, malformed input -> error card not crash
const evil = renderDataCard({ type: 'news', items: [{ url: 'javascript:alert(1)', title: 'x' }, { url: 'https://a.com/x', title: '<img src=x onerror=alert(1)>' }] });
assert.ok(!evil.includes('javascript:'), 'non-http urls dropped');
assert.ok(!evil.includes('<img src=x'), 'titles escaped');
assert.ok(renderDataCard({ type: 'sports_game', games: [] }).includes("Couldn't render"));
assert.ok(renderDataCard({ type: 'gallery', items: null }).includes("Couldn't render"));
assert.equal(renderDataCard({ type: 'unknown_type' }), '');

async function main() {
// product (no network: enrichment callback stubbed)
const prod = await buildProductCard({ item: { title: 'AirPods Pro 3', productUrl: 'https://www.target.com/p/x', price: '$249.99' }, variant: 'hero' }, async (items) => items.map((i) => ({ ...i, imageUrl: 'https://img/x.jpg' })));
// A bare query runs the search hook and prefers a priced, imaged hit.
const byQuery = await buildProductCard({ query: 'airpods pro 3' }, undefined, async () => [
  { title: 'Article', productUrl: 'https://a/x' },
  { title: 'AirPods Pro 3', productUrl: 'https://t/p', price: '$249.99', imageUrl: 'https://img/a.jpg', merchant: 'Target' },
]);
assert.equal(byQuery.success, true, 'product card resolves a query');
assert.equal((byQuery as any).extra.richArtifacts[0].item.price, '$249.99');
const noHit = await buildProductCard({ query: 'nothing' }, undefined, async () => []);
assert.equal(noHit.success, false);

assert.equal(prod.extra?.richArtifacts[0].variant, 'hero');
assert.equal(prod.extra?.richArtifacts[0].item.imageUrl, 'https://img/x.jpg', 'enrichment fills missing image');
assert.ok(renderDataCard(prod.extra!.richArtifacts[0]).includes('Top pick'));

// live builders (real APIs)
const fx = await timed('currency', () => buildCurrencyCard({ from: 'usd', to: 'euro', amount: 100 }));
assert.ok(fx.success, fx.error); const fxa = fx.extra!.richArtifacts[0];
assert.equal(fxa.to, 'EUR'); assert.ok(Object.keys(fxa.rates).length > 20);
assert.ok(renderDataCard(fxa).includes('data-pc-fx="amount"'));
const fx2 = await timed('currency_cached', () => buildCurrencyCard({ from: 'USD', to: 'JPY' }));
assert.ok(fx2.success && timings.currency_cached < 20, `second currency lookup is cached (${timings.currency_cached}ms)`);
const clk = await timed('clock', () => buildClockCard({ locations: ['Tokyo', 'Europe/London', 'Nowhere-xyz-123'] }));
assert.ok(clk.success, clk.error); assert.equal(clk.extra!.richArtifacts[0].zones.length, 2, 'unresolvable city dropped');
const sb = await timed('sports_scores', () => buildSportsCard({ league: 'nfl' }));
assert.ok(sb.success || /No NFL games/.test(sb.error || ''), sb.error);
if (sb.success) assert.ok(renderDataCard(sb.extra!.richArtifacts[0]).includes('pc-game'));
const stn = await timed('sports_standings', () => buildSportsCard({ league: 'nba', view: 'standings' }));
assert.ok(stn.success, stn.error); assert.ok(stn.extra!.richArtifacts[0].groups.length >= 2, 'NBA has two conferences');
assert.ok(renderDataCard(stn.extra!.richArtifacts[0]).includes('pc-tab'));
const pl = await timed('sports_player', () => buildSportsCard({ view: 'player', player: 'Nikola Jokic' }));
assert.ok(pl.success, pl.error); assert.equal(pl.extra!.richArtifacts[0].player.team, 'Denver Nuggets');
const places = await timed('places_given', () => buildPlacesCard({ places: [{ name: 'Lincoln Memorial', address: '2 Lincoln Memorial Cir NW, Washington, DC', lat: 38.8893, lng: -77.0502 }] }));
assert.ok(places.success, places.error); assert.ok(places.extra!.richArtifacts[0].center);

console.log('ui-cards regression passed', JSON.stringify(timings));
}
main().catch((error) => { console.error(error); process.exit(1); });
