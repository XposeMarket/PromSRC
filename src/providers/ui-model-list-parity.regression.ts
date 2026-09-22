import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ANTHROPIC_MODELS } from './anthropic-adapter';

// ── UI model-list parity ────────────────────────────────────────────────────
// The canonical Anthropic catalog lives in `ANTHROPIC_MODELS`, but several web
// UI surfaces keep their own hardcoded fallback arrays so the picker still
// renders before/without a live catalog fetch. Those copies are easy to miss:
// adding Claude Opus 5.5 to the adapter + SettingsPage alone left six other
// surfaces stale, and the model was invisible on mobile even after a correct
// merge, pull, bundle regen, and gateway restart.
//
// This test enumerates every web-ui source file that hardcodes an Anthropic
// model id and asserts it carries the newest catalog entries, so a future
// model addition fails loudly here instead of silently shipping a partial UI.

const repoRoot = path.resolve(__dirname, '..', '..');
const webUiSrc = path.join(repoRoot, 'web-ui', 'src');

function collectJsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'generated') continue;
      collectJsFiles(full, out);
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// A surface "hardcodes the catalog" when it names a specific Anthropic model id
// in a quoted list. Matching on the quote avoids catching prose/comments.
const HARDCODES_CATALOG = /['"]claude-opus-\d/;

const files = collectJsFiles(webUiSrc);
assert.ok(files.length > 0, 'expected to find web-ui source files to scan');

const surfaces = files.filter((f) => HARDCODES_CATALOG.test(readFileSync(f, 'utf8')));
assert.ok(
  surfaces.length >= 6,
  `expected at least 6 web-ui surfaces with hardcoded Anthropic lists, found ${surfaces.length}`,
);

// Guard the newest entries. If the catalog gains a model and the UI copies are
// not updated, this fails with the exact file list that needs attention.
const NEWEST_REQUIRED = ['claude-opus-5-5'];

for (const model of NEWEST_REQUIRED) {
  assert.ok(
    ANTHROPIC_MODELS.includes(model),
    `${model} must exist in the canonical ANTHROPIC_MODELS catalog`,
  );
  const stale = surfaces.filter((f) => !readFileSync(f, 'utf8').includes(model));
  assert.deepEqual(
    stale.map((f) => path.relative(repoRoot, f)),
    [],
    `these web-ui surfaces are missing ${model} and will render a stale model picker`,
  );
}

// Ordering sanity: newer Opus must rank above older Opus in the canonical list
// so selectors that render catalog order show the recommended model first.
const idx55 = ANTHROPIC_MODELS.indexOf('claude-opus-5-5');
const idx5 = ANTHROPIC_MODELS.indexOf('claude-opus-5');
assert.ok(idx55 >= 0 && idx5 >= 0, 'both Opus 5.5 and Opus 5 must be present');
assert.ok(idx55 < idx5, 'claude-opus-5-5 must rank above claude-opus-5');

console.log(`ui-model-list-parity regression: ok (${surfaces.length} surfaces checked)`);
