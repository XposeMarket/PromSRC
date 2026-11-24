import assert from 'node:assert/strict';
import { executeStockLookup, resolvePreviousClose } from './stocks';

// The stocks card must show the day's change, not the change over the chart range.
const DAY = 86_400;
const open = 1_795_530_600; // a session open, seconds

/** One month of daily bars: starts at 217.05, yesterday closed 150, live price 148.245. */
function monthChart(overrides: Record<string, unknown> = {}) {
  const closes = [217.05, 210, 190, 170, 160, 150, 148.245];
  return {
    meta: {
      symbol: 'NVDA', currency: 'USD', regularMarketPrice: 148.245, chartPreviousClose: 217.05,
      regularMarketTime: open + 5 * 3600, range: '1mo', ...overrides,
    },
    timestamp: closes.map((_, i) => open - (closes.length - 1 - i) * DAY),
    indicators: { quote: [{ close: closes }] },
  };
}

async function main(): Promise<void> {
  // Daily bars: previous close is the bar before the current session, not the range start.
  assert.equal(resolvePreviousClose(monthChart()), 150);

  // Yahoo's own previous close wins when it sends one (intraday ranges).
  assert.equal(resolvePreviousClose(monthChart({ previousClose: 151.5 })), 151.5);
  assert.equal(resolvePreviousClose(monthChart({ regularMarketPreviousClose: 152 })), 152);

  // Missing bars (null closes on holidays) are skipped, not treated as zero.
  const gappy = monthChart();
  (gappy.indicators.quote[0].close as any[])[5] = null;
  assert.equal(resolvePreviousClose(gappy), 160);

  // Latest bar is an older session (price is from a newer one): that bar IS the previous close.
  assert.equal(resolvePreviousClose(monthChart({ regularMarketTime: open + DAY + 5 * 3600 })), 148.245);

  // One-day chart: chartPreviousClose really is yesterday's close.
  assert.equal(resolvePreviousClose({ meta: { chartPreviousClose: 150, range: '1d' }, timestamp: [open], indicators: { quote: [{ close: [148.245] }] } }), 150);

  // Nothing usable: no change is reported rather than a wrong one.
  assert.equal(resolvePreviousClose({ meta: { range: '1mo' }, timestamp: [], indicators: { quote: [{ close: [] }] } }), undefined);
  assert.equal(resolvePreviousClose({}), undefined);

  // End to end through the tool with a stubbed network.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ chart: { result: [monthChart()] } }) })) as any;
  try {
    const result = await executeStockLookup({ symbols: ['NVDA'] });
    assert.equal(result.success, true);
    const item = result.data.items[0];
    assert.ok(Math.abs(item.changePct - ((148.245 - 150) / 150) * 100) < 1e-9, `day change, got ${item.changePct}`);
    assert.ok(item.changePct > -2 && item.changePct < 0, 'not the -31.7% move over the month');
    assert.ok(Math.abs(item.changeAbs - (148.245 - 150)) < 1e-9);
    assert.match(String(result.stdout), /NVDA 148\.245 USD \(-1\.17%\)/);
    assert.equal(item.sparkline.length, 7, 'the sparkline still covers the requested range');
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('stocks day-change regression passed');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
