/**
 * Utility cards Prom writes as fenced blocks (no data fetch):
 *   ```convert    {"value":5,"from":"mi","to":"km"}        unit converter
 *   ```calculator {"expression":"(12.5*4)+3^2"}             live calculator
 * Math runs through a small recursive-descent parser: no eval, no Function.
 */
import { esc, encodeCardData, decodeCardData, cardError } from './card-utils.js';

// ── units ──────────────────────────────────────────────────────────────────
// Factor = size of one unit in the category's base unit. Temperature is affine.
export const UNIT_TABLE = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318, t: 1000 },
  volume: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444, 'ft/s': 0.3048 },
  area: { m2: 1, km2: 1e6, ha: 10000, acre: 4046.8564224, ft2: 0.09290304, in2: 0.00064516, mi2: 2589988.110336 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, day: 86400, week: 604800, yr: 31557600 },
  data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
  energy: { J: 1, kJ: 1000, cal: 4.184, kcal: 4184, Wh: 3600, kWh: 3.6e6, BTU: 1055.06 },
  temperature: { C: 1, F: 1, K: 1 },
};

const UNIT_ALIASES = {
  meter: 'm', meters: 'm', metre: 'm', metres: 'm', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  centimeter: 'cm', centimeters: 'cm', millimeter: 'mm', millimeters: 'mm', mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd',
  foot: 'ft', feet: 'ft', inch: 'in', inches: 'in', '"': 'in', "'": 'ft', 'nautical mile': 'nmi', 'nautical miles': 'nmi',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', gram: 'g', grams: 'g', milligram: 'mg', milligrams: 'mg',
  pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', stone: 'st', tonne: 't', tonnes: 't', ton: 't',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml', gallon: 'gal', gallons: 'gal',
  quart: 'qt', quarts: 'qt', pint: 'pt', pints: 'pt', cups: 'cup', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', kph: 'km/h', kmh: 'km/h', knots: 'kn', knot: 'kn',
  'sq m': 'm2', 'm²': 'm2', 'sq ft': 'ft2', 'ft²': 'ft2', acres: 'acre', hectare: 'ha', hectares: 'ha', 'sq mi': 'mi2', 'km²': 'km2',
  second: 's', seconds: 's', sec: 's', minute: 'min', minutes: 'min', hour: 'h', hours: 'h', hr: 'h', days: 'day',
  weeks: 'week', year: 'yr', years: 'yr', bytes: 'B', celsius: 'C', '°c': 'C', fahrenheit: 'F', '°f': 'F', kelvin: 'K',
  calories: 'kcal', kilocalories: 'kcal', joules: 'J', joule: 'J',
};

/** Resolve a unit name to { category, unit } or null. Case-sensitive codes win (MB vs mb). */
export function resolveUnit(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  for (const [category, units] of Object.entries(UNIT_TABLE)) if (Object.prototype.hasOwnProperty.call(units, raw)) return { category, unit: raw };
  const lower = raw.toLowerCase();
  const alias = UNIT_ALIASES[lower];
  const code = alias || lower;
  for (const [category, units] of Object.entries(UNIT_TABLE)) {
    const hit = Object.keys(units).find((u) => u.toLowerCase() === code.toLowerCase());
    if (hit) return { category, unit: hit };
  }
  return null;
}

function toKelvin(v, u) { return u === 'C' ? v + 273.15 : u === 'F' ? (v - 32) * (5 / 9) + 273.15 : v; }
function fromKelvin(k, u) { return u === 'C' ? k - 273.15 : u === 'F' ? (k - 273.15) * (9 / 5) + 32 : k; }

export function convertUnit(value, from, to, category) {
  const v = Number(value);
  if (!Number.isFinite(v)) return NaN;
  if (category === 'temperature') return fromKelvin(toKelvin(v, from), to);
  const t = UNIT_TABLE[category];
  if (!t || !t[from] || !t[to]) return NaN;
  return (v * t[from]) / t[to];
}

export function formatQuantity(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) return n.toExponential(4);
  return Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: abs < 1 ? 8 : 6 });
}

function renderConvert(id, raw) {
  const fromRes = resolveUnit(raw?.from);
  const toRes = resolveUnit(raw?.to);
  const category = fromRes?.category || toRes?.category || (UNIT_TABLE[raw?.category] ? raw.category : '');
  if (!category) return cardError('convert', 'Unknown units. Try mi/km, lb/kg, F/C, gal/l, mph/km/h.');
  const units = Object.keys(UNIT_TABLE[category]);
  const from = fromRes?.category === category ? fromRes.unit : units[0];
  const to = toRes?.category === category && toRes.unit !== from ? toRes.unit : units.find((u) => u !== from);
  const value = Number.isFinite(Number(raw?.value)) ? Number(raw.value) : 1;
  const sel = (name, cur) => `<select class="pc-select" data-pc-unit="${name}">${units.map((u) => `<option value="${esc(u)}" ${u === cur ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>`;
  const out = formatQuantity(convertUnit(value, from, to, category));
  return `<div class="pc-card pc-convert" data-pc-kind="convert" data-pc-id="${esc(id)}" data-card-json="${encodeCardData({ category })}"><div class="pc-head"><span class="pc-kicker">Convert</span><span class="pc-title">${esc(category[0].toUpperCase() + category.slice(1))}</span></div>
  <div class="pc-fx-row"><input class="pc-input" type="number" inputmode="decimal" step="any" value="${esc(value)}" data-pc-unit="value" aria-label="Value">${sel('from', from)}</div>
  <button type="button" class="pc-icon-btn pc-fx-swap" data-pc-act="unit-swap" title="Swap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <div class="pc-fx-row"><output class="pc-fx-out" data-pc-unit="out">${esc(out)}</output>${sel('to', to)}</div></div>`;
}

/** Live update from the card's current inputs (called by card-runtime). */
export function updateConvert(card) {
  if (!card) return;
  const category = decodeCardData(card)?.category || '';
  const q = (n) => card.querySelector(`[data-pc-unit="${n}"]`);
  const out = q('out');
  if (out) out.textContent = formatQuantity(convertUnit(q('value')?.value, q('from')?.value, q('to')?.value, category));
}

// ── calculator ─────────────────────────────────────────────────────────────
const FNS = { sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan };
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Safe arithmetic: + - * / ^ % ( ), unary minus, ×÷−, commas in numbers, functions and pi/e. */
export function evaluateExpression(input) {
  const src = String(input ?? '').replace(/[×x](?=\s*[\d(.])/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1').trim();
  if (!src || src.length > 300) throw new Error('empty');
  const tokens = src.match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+\d?|\*\*|[-+*/^%()]|\S/gi) || [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => { if (tokens[i] !== t) throw new Error(`expected ${t}`); i += 1; };
  const primary = () => {
    const t = tokens[i++];
    if (t == null) throw new Error('incomplete');
    if (/^\d*\.?\d+(e[+-]?\d+)?$/i.test(t)) return Number(t);
    if (t === '(') { const v = expr(); take(')'); return v; }
    if (t === '-') return -power();
    if (t === '+') return power();
    const name = t.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CONSTS, name)) return CONSTS[name];
    if (Object.prototype.hasOwnProperty.call(FNS, name)) { take('('); const v = expr(); take(')'); return FNS[name](v); }
    throw new Error(`unknown "${t}"`);
  };
  const postfix = () => { let v = primary(); while (peek() === '%' && !/^[\d(a-z]/i.test(tokens[i + 1] || '')) { i += 1; v /= 100; } return v; };
  const power = () => { const b = postfix(); if (peek() === '^' || peek() === '**') { i += 1; return b ** unary(); } return b; };
  const unary = () => (peek() === '-' ? (i += 1, -unary()) : peek() === '+' ? (i += 1, unary()) : power());
  const term = () => {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t === '*') { i += 1; v *= unary(); } else if (t === '/') { i += 1; v /= unary(); } else if (t === '%') { i += 1; v %= unary(); }
      else if (t === '(' || (t && /^[a-z]/i.test(t))) v *= unary(); // implicit 2(3), 2pi
      else return v;
    }
  };
  function expr() {
    let v = term();
    for (;;) { const t = peek(); if (t === '+') { i += 1; v += term(); } else if (t === '-') { i += 1; v -= term(); } else return v; }
  }
  const value = expr();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
  if (!Number.isFinite(value)) throw new Error('not a finite number');
  return value;
}

export function calcResult(expression) {
  try { return { ok: true, text: formatQuantity(evaluateExpression(expression)) }; } catch (error) { return { ok: false, text: String(expression || '').trim() ? '…' : '' }; }
}

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '(', ')', 'C', '⌫', '^', '+'];

function renderCalculator(id, raw) {
  const expression = String(raw?.expression ?? raw?.expr ?? raw?.input ?? (typeof raw === 'string' ? raw : '') ?? '');
  const r = calcResult(expression);
  const keys = KEYS.map((k) => `<button type="button" class="pc-key ${/[÷×−+^]/.test(k) ? 'op' : ''}" data-pc-act="calc-key" data-k="${esc(k)}">${esc(k)}</button>`).join('');
  return `<div class="pc-card pc-calc" data-pc-kind="calculator" data-pc-id="${esc(id)}"><div class="pc-head"><span class="pc-kicker">Calculator</span>${raw?.title ? `<span class="pc-title">${esc(raw.title)}</span>` : ''}</div>
  <input class="pc-input pc-calc-expr" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" value="${esc(expression)}" data-pc-calc="expr" aria-label="Expression">
  <output class="pc-calc-out ${r.ok ? '' : 'pending'}" data-pc-calc="out">${r.ok ? `= ${esc(r.text)}` : esc(r.text)}</output>
  <div class="pc-keypad">${keys}<button type="button" class="pc-key eq" data-pc-act="calc-key" data-k="=">=</button></div></div>`;
}

export function updateCalculator(card) {
  const input = card?.querySelector('[data-pc-calc="expr"]');
  const out = card?.querySelector('[data-pc-calc="out"]');
  if (!input || !out) return;
  const r = calcResult(input.value);
  out.textContent = r.ok ? `= ${r.text}` : r.text;
  out.classList.toggle('pending', !r.ok);
}

/** Keypad press; returns true when handled. */
export function pressCalculatorKey(card, key) {
  const input = card?.querySelector('[data-pc-calc="expr"]');
  if (!input) return false;
  if (key === 'C') input.value = '';
  else if (key === '⌫') input.value = input.value.slice(0, -1);
  else if (key === '=') { const r = calcResult(input.value); if (r.ok) input.value = r.text.replace(/,/g, ''); }
  else input.value += key;
  updateCalculator(card);
  return true;
}

export const TOOL_FENCES = ['convert', 'calculator'];

export function renderToolCard(kind, id, raw) {
  if (kind === 'convert') return renderConvert(id, raw);
  if (kind === 'calculator') return renderCalculator(id, raw);
  return '';
}
