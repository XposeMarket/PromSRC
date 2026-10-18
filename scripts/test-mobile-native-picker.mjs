import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const helper = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-native-picker.js', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-theme-picker.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<button id="picker">Original look</button><button id="theme">Theme</button>');
  await page.evaluate(async ({ helper, theme }) => {
    const url = URL.createObjectURL(new Blob([helper], { type: 'text/javascript' }));
    const { attachNativePicker } = await import(url);
    const events = [];
    const entries = [{ value: 'a', label: 'Alpha', selected: true }, { value: 'b', label: '<Beta>', disabled: false }, { value: 'c', label: 'Unavailable', disabled: true }];
    const button = document.querySelector('#picker');
    const controller = attachNativePicker(button, { label: 'Model', options: () => entries, onChange: value => events.push(value) });
    window.testPicker = { controller, entries, events, button };
    const { bindMobileThemePicker } = await import(URL.createObjectURL(new Blob([theme.replace("'./mobile-native-picker.js'", JSON.stringify(url))], { type: 'text/javascript' })));
    window.themeChanges = [];
    bindMobileThemePicker(document.querySelector('#theme'), { themes: () => [{ id: 'system', label: 'System' }, { id: 'p1', label: 'One' }], current: () => 'system', apply: value => window.themeChanges.push(value) });
  }, { helper, theme });
  assert.equal(await page.locator('#picker').textContent(), 'Original look');
  assert.equal(await page.locator('select').first().getAttribute('aria-label'), 'Model');
  assert.equal(await page.locator('select').first().locator('option').nth(1).textContent(), '<Beta>');
  assert.equal(await page.locator('select').first().locator('option').nth(2).isDisabled(), true);
  assert.equal(await page.locator('select').first().evaluate(el => {
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el;
  }), true, 'real select, not the button, receives the original tap');
  await page.locator('select').first().selectOption('b');
  assert.deepEqual(await page.evaluate(() => testPicker.events), ['b']);
  await page.locator('select').nth(1).selectOption('p1');
  assert.deepEqual(await page.evaluate(() => themeChanges), ['p1']);
  await page.evaluate(() => {
    testPicker.entries[0].selected = false;
    testPicker.entries[1].selected = true;
    testPicker.controller.refresh();
  });
  assert.equal(await page.locator('select').first().inputValue(), 'b');
  await page.evaluate(() => testPicker.controller.destroy());
  assert.equal(await page.locator('#picker').getAttribute('tabindex'), null);
  assert.equal(await page.locator('#picker').getAttribute('aria-hidden'), null);
  assert.equal(await page.locator('#picker').evaluate(el => el.parentElement.tagName), 'BODY');
  console.log('PASS mobile native picker: trusted-tap overlay, labels, disabled/selected values, change callbacks, dynamic refresh, theme persistence callback, cleanup');
} finally {
  await browser.close();
}
