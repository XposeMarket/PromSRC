#!/usr/bin/env node
// Desktop chat-row options regression (PR #833 round 2, fixes 1 and 2).
// Extracts the REAL renderChatSessionCard + options-menu functions from
// web-ui/src/legacy-desktop-bootstrap.js (TypeScript AST), renders them into a static harness that
// loads the real web-ui/src/styles/components-sidebar.css, and asserts at 1280 and 860 widths:
//   1. Escape closes the menu and leaves document.activeElement on the options trigger (still displayed).
//   2. The options trigger never covers the pin: elementFromPoint at the pin centre returns the pin,
//      at the trigger centre returns the trigger, and their rectangles do not overlap.
// Exits non-zero on any failure. Set ROW_OPTIONS_SHOT_DIR to also write round5-* screenshots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bootstrapPath = path.join(root, 'web-ui/src/legacy-desktop-bootstrap.js');
const cssPath = path.join(root, 'web-ui/src/styles/components-sidebar.css');
const shotDir = process.env.ROW_OPTIONS_SHOT_DIR || '';

const WANTED = [
  'renderChatSessionCard', '_getSessionHoverPreview', 'queueSessionHoverPreview',
  'scheduleSessionHoverPreviewClose', 'hideSessionHoverPreview', 'closeChatSessionOptions',
  '_syncChatSessionOptionsClosed', '_renderSessionHoverPreviewTitle', 'showSessionHoverPreview',
];

// Test doubles for renderer dependencies outside the row markup/menu under test.
const STUBS = `let _sessionOptionsOpen=false,_sessionOptionsTrigger=null,_sessionHoverPreviewEditing=false,_sessionHoverPreviewCloseTimer=null,_sessionHoverPreviewSource=null,_sessionHoverPreviewTimer=null; const _pinnedChats=[];window.openCount=0;window.actions=[];const escHtml=s=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const getSessionSearchResult=()=>null,renderSessionSearchPreview=()=>'',_isSessionWorking=()=>false,getSessionLastMessageAt=()=>0,_isImportedSession=()=>false,renderImportedSourceLogo=()=>'',SKILL_STAR_ICON=()=> '☆',renderImportedSourceMeta=()=>'<span class="chat-session-top-time">2m ago</span>',consumeSidebarClick=()=>false,openSession=()=>window.openCount++,toggleChatPin=(id,e)=>e.stopPropagation(),hideSidebarBranchPopover=()=>{},_sessionById=id=>({id,title:'Provider review '+id}),confirmSessionHoverSettle=()=>window.actions.push('settle'),confirmSessionHoverDelete=()=>window.actions.push('delete');`;

function extractRealSource() {
  const source = fs.readFileSync(bootstrapPath, 'utf8');
  const sf = ts.createSourceFile('legacy-desktop-bootstrap.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return sf.statements
    .filter((node) => {
      if (ts.isFunctionDeclaration(node) && WANTED.includes(node.name?.text)) return true;
      const text = node.getText(sf);
      return text.startsWith('window.openChatSessionOptions =')
        || (text.startsWith('document.addEventListener(') && text.includes('_sessionOptionsOpen'));
    })
    .map((node) => node.getText(sf))
    .join('\n');
}

function buildHarness() {
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(cssPath).href}">
<style>:root{--text:#eee;--muted:#aaa;--panel:#25272c;--brand:#d6ae61;--pm-gold:#d6ae61;--sidebar-text:#eee;--t-accent:#d6ae61}body{margin:30px;background:#181a1e;color:#eee;font:14px Arial}main{width:280px}.job-item{padding:14px;margin:8px 0;background:#25272c;border-radius:8px;min-height:25px}</style>
<button id="before">Before rows</button><main id="rows"></main>
<script>${STUBS}\n${extractRealSource()}
rows.innerHTML=renderChatSessionCard({id:'r1',title:'Provider logos review'},{})+renderChatSessionCard({id:'r2',title:'Second chat'},{});
</script>`;
}

const failures = [];
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

// Geometry + hit-testing for the first row. Returns what sits at the pin and trigger centres.
const probeRow = () => {
  const row = document.querySelector('.chat-session-item');
  const pin = row.querySelector('.chat-pin-btn');
  const trig = row.querySelector('.chat-session-options-trigger');
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, right: b.right, top: b.top, bottom: b.bottom, shown: b.width > 0 && b.height > 0 };
  };
  const at = (p) => {
    const el = document.elementFromPoint(p.x, p.y);
    if (!el) return 'none';
    if (el === pin || pin.contains(el)) return 'pin';
    if (el === trig || trig.contains(el)) return 'trigger';
    return el.className || el.tagName;
  };
  const pinBox = box(pin);
  const trigBox = box(trig);
  return {
    pinAt: at(pinBox),
    trigAt: trigBox.shown ? at(trigBox) : 'hidden',
    trigShown: trigBox.shown,
    overlap: trigBox.shown && pinBox.left < trigBox.right && trigBox.left < pinBox.right && pinBox.top < trigBox.bottom && trigBox.top < pinBox.bottom,
    expanded: trig.getAttribute('aria-expanded'),
    trigDisplay: getComputedStyle(trig).display,
    activeIsTrigger: document.activeElement === trig,
    rowMenuOpen: row.classList.contains('is-menu-open'),
  };
};

async function runWidth(browser, width, harnessUrl) {
  const page = await browser.newPage({ viewport: { width, height: 600 } });
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `round5-${name}.png`) }); };
  try {
    await page.goto(harnessUrl);
    await page.mouse.move(5, 590);
    const rest = await page.evaluate(probeRow);
    // The pin is hover-only at rest (its hit-test is the row), so assert the trigger's rest design:
    // hidden on desktop widths, always shown at narrow desktop (<=900px) where the hover popover is off.
    check(rest.trigShown === (width === 860), `${width}: options trigger rest visibility matches design (shown=${rest.trigShown})`);
    if (width === 860) await shot('860-rest');

    await page.locator('.chat-session-item').first().hover();
    const hover = await page.evaluate(probeRow);
    check(hover.trigShown, `${width}: options trigger is displayed on hover`);
    check(hover.pinAt === 'pin', `${width} hover: elementFromPoint at pin centre returns the pin (got ${hover.pinAt})`);
    check(hover.trigAt === 'trigger', `${width} hover: elementFromPoint at trigger centre returns the trigger (got ${hover.trigAt})`);
    check(!hover.overlap, `${width} hover: trigger and pin rectangles do not overlap`);
    if (width === 1280) await shot('1280-hover');

    // Keyboard path: focus the pin, Tab to the trigger, Enter opens, Escape closes.
    await page.mouse.move(5, 590);
    await page.locator('#before').focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.classList.contains('chat-session-options-trigger'))) break;
    }
    const focused = await page.evaluate(probeRow);
    check(focused.activeIsTrigger && focused.trigDisplay !== 'none', `${width}: Tab reaches the displayed options trigger`);
    if (width === 1280) await shot('1280-focus');
    if (width === 860) await shot('860-focus');

    await page.keyboard.press('Enter');
    const open = await page.evaluate(probeRow);
    check(open.expanded === 'true' && open.rowMenuOpen, `${width}: Enter opens the menu (aria-expanded + is-menu-open)`);

    await page.keyboard.press('Escape');
    const closed = await page.evaluate(probeRow);
    check(closed.expanded === 'false', `${width}: Escape sets aria-expanded=false`);
    check(closed.rowMenuOpen === false, `${width}: Escape clears is-menu-open`);
    check(closed.activeIsTrigger, `${width}: Escape returns document.activeElement to the options trigger (got ${await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)})`);
    check(closed.trigDisplay !== 'none', `${width}: trigger stays rendered while focused after Escape`);
  } finally {
    await page.close();
  }
}

async function main() {
  const harnessPath = path.join(os.tmpdir(), `prom-row-options-${process.pid}.html`);
  fs.writeFileSync(harnessPath, buildHarness());
  const browser = await chromium.launch({ headless: true });
  try {
    const harnessUrl = pathToFileURL(harnessPath).href;
    for (const width of [1280, 860]) await runWidth(browser, width, harnessUrl);
  } finally {
    await browser.close();
    fs.rmSync(harnessPath, { force: true });
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS desktop chat-row options: Escape focus return + pin/trigger hit-testing at 1280 and 860');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
