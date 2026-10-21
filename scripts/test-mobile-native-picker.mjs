import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const helper = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-native-picker.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<button id="picker">Original look</button>');
  await page.evaluate(async ({ helper }) => {
    const url = URL.createObjectURL(new Blob([helper], { type: 'text/javascript' }));
    const { attachNativePicker } = await import(url);
    const events = [];
    const entries = [{ value: 'a', label: 'Alpha', selected: true }, { value: 'b', label: '<Beta>', disabled: false }, { value: 'c', label: 'Unavailable', disabled: true }];
    const button = document.querySelector('#picker');
    const controller = attachNativePicker(button, { label: 'Model', options: () => entries, onChange: value => events.push(value) });
    window.testPicker = { controller, entries, events, button };
  }, { helper });
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
  await page.evaluate(() => {
    testPicker.entries[0].selected = false;
    testPicker.entries[1].selected = true;
    testPicker.controller.refresh();
  });
  assert.equal(await page.locator('select').first().inputValue(), 'b');
  // Regression: inside a pointer-events:none dock (new-chat context dock) the
  // select must still receive the tap instead of falling through.
  await page.evaluate(async ({ helper }) => {
    const { attachNativePicker } = await import(URL.createObjectURL(new Blob([helper], { type: 'text/javascript' })));
    const dock = document.createElement('div');
    dock.style.cssText = 'position:fixed;left:0;right:0;bottom:100px;pointer-events:none';
    dock.innerHTML = '<button id="docked" style="pointer-events:auto;width:200px;height:44px">Docked</button>';
    document.body.append(dock);
    window.dockedPicker = attachNativePicker(dock.querySelector('#docked'), { label: 'Docked', options: () => [{ value: 'x', label: 'X' }], onChange() {} });
  }, { helper });
  assert.equal(await page.evaluate(() => {
    const el = window.dockedPicker.select;
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el;
  }), true, 'select inside a pointer-events:none dock still receives the tap');
  await page.evaluate(() => window.dockedPicker.destroy());
  await page.evaluate(() => testPicker.controller.destroy());
  assert.equal(await page.locator('#picker').getAttribute('tabindex'), null);
  assert.equal(await page.locator('#picker').getAttribute('aria-hidden'), null);
  assert.equal(await page.locator('#picker').evaluate(el => el.parentElement.tagName), 'BODY');
  console.log('PASS mobile native picker: trusted-tap overlay, labels, disabled/selected values, change callbacks, dynamic refresh, cleanup');
} finally {
  await browser.close();
}
