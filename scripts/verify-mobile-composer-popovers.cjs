const fs = require('fs');
const http = require('http');
const path = require('path');
const cp = require('child_process');
const { chromium } = require('playwright');
const root = process.cwd();
const out = 'C:/Users/rafel/PromSRC/research/chat-render-lanes';
const read = (p, before) => before ? cp.execFileSync('git', ['show', 'HEAD:' + p], {encoding:'utf8', maxBuffer:8e6}) : fs.readFileSync(p,'utf8');
const extract = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));
(async () => {
  const server = http.createServer((req,res) => {
    const p = path.join(root, 'web-ui', decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(path.join(root,'web-ui'))) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', p.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(p)); } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true});
  try {
    // Isolated fixture: no gateway state or production assets are changed.
    for (const before of [true,false]) for (const height of [844,450]) for (const kind of ['attachment','reasoning']) {
      const page = await browser.newPage({viewport:{width:390,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await page.route('**/src/styles/mobile.css', route => route.fulfill({contentType:'text/css',body:read('web-ui/src/styles/mobile.css',before)}));
      await page.goto(base + '/src/styles/mobile.css');
      await page.setContent(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${base}/src/styles/mobile.css"><link rel="stylesheet" href="${base}/src/styles/mobile-composer-stack.css"><style>
      body{margin:0;background:#15191f;color:#eee;font-family:Arial} .pm-app{height:100vh} .pm-chat-body{padding:60px 24px;font-size:18px;line-height:2} #pm-composer{position:fixed!important;left:12px!important;right:12px!important;bottom:78px!important;height:178px!important;display:block!important;padding:14px!important;z-index:10040!important;transform:translateZ(0);isolation:isolate;background:rgba(80,85,98,.6)!important;border-radius:28px!important;backdrop-filter:blur(12px)} .fixture-chip{padding:10px;background:#515563;border-radius:12px;width:190px} #pm-composer-input{display:block;margin:12px 0;border:0;background:transparent;color:white;height:36px;width:95%} .fixture-controls{display:flex;align-items:center;justify-content:space-between;height:38px} #pm-attach{width:36px;height:36px} #pm-composer .pm-composer-model-badge{display:block!important;max-width:none!important} .pm-tabbar{position:fixed!important;bottom:8px!important;height:58px!important;left:12px!important;right:12px!important;display:flex!important;justify-content:space-around;align-items:center;z-index:10040!important;background:#484d58!important;border-radius:28px} .pm-attach-sheet-action{font-size:23px!important} .pm-reasoning-control{height:40px;background:linear-gradient(90deg,#698fff 65%,#555 65%);border-radius:24px;width:280px!important}.pm-model-badge{position:absolute;top:16px;left:100px}.pm-reasoning-advanced{margin:16px auto;color:white}.pm-msheet.is-reasoning .pm-msheet-body{gap:8px}
      </style></head><body class="pm-mobile-active"><div class="pm-app"><div class="pm-model-badge">Claude Opus 5.5 High</div><main class="pm-chat-body"><p>Mobile composer layout check</p><p>Chat text behind the popover.</p><p>All chrome should be blurred.</p></main><form id="pm-composer" class="pm-composer is-focused has-attachments"><div class="fixture-chip">▧ IMG_0765.png · 2.4 MB</div><textarea id="pm-composer-input">Check the attached image\nand these layout details.</textarea><div class="fixture-controls"><button id="pm-attach" type="button">＋</button><button type="button" class="pm-composer-model-badge">Claude Opus 5.5 High</button><span>◉ ↑</span></div><div id="pm-attach-sheet" class="pm-attach-sheet" hidden><div class="pm-attach-sheet-scrim"></div><div class="pm-attach-sheet-panel"><button class="pm-attach-sheet-action pm-attach-sheet-action--files" data-action="files">▧</button><button class="pm-attach-sheet-action pm-attach-sheet-action--camera" data-action="camera">◎</button></div></div></form><nav class="pm-tabbar">Chat　 Agents　 Tasks　 More</nav></div></body></html>`);
      await page.waitForTimeout(300);
      const runtime = read('web-ui/src/mobile/mobile-chat-page-runtime.js', before);
      const model = read('web-ui/src/mobile/mobile-model-badge.js', before);
      const geometry = read('web-ui/src/mobile/mobile-reasoning-sheet-geometry.js', before);
      await page.evaluate(({runtime,model,geometry,kind}) => {
        const get = id => document.getElementById(id);
        if(kind === 'attachment') {
          const prelude = `let attachSheetTarget,attachSheetOpenToken=0,attachSheetPositionCleanup=null;const form=document.getElementById('pm-composer'),attachSheet=document.getElementById('pm-attach-sheet'),attachBtn=document.getElementById('pm-attach'),input=document.getElementById('pm-composer-input'),contextDock=null,chatVoiceCamera=null;const holdComposerOpenForControl=()=>{},closeTargetPopover=()=>{},closeAttachSheet=()=>{window.__dismissed=true};`;
          eval(prelude + runtime + '\nopenAttachSheet();');
        } else {
          eval(geometry.replace('export function','function') + '\n' + model + `\nconst sheet=_openSheet('', '<div class="pm-reasoning-summary">High reasoning effort</div><div class="pm-reasoning-control"></div><button class="pm-reasoning-advanced">Advanced ›</button>');sheet.classList.add('is-reasoning');document.getElementById('pm-msheet-scrim').classList.add('is-reasoning');window.dispatchEvent(new Event('resize'));`);
        }
      }, {runtime:extract(runtime,'  function openAttachSheet(options = {}) {','  function closeAttachSheet()'), model:`function _closeSheetImmediate(){} function _closeSheet(){window.__dismissed=true} function _positionSheetNearBadge(){}\n`+extract(model,'function _visibleComposerModelBadge()','function _positionSheetNearBadge(')+extract(model,'function _openSheet(','function _closeSheetImmediate()'),geometry,kind});
      await page.waitForTimeout(600);
      const state=await page.evaluate(kind=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};const c=document.getElementById('pm-composer');const t=document.querySelector('.pm-tabbar');return {composer:rect(c),tab:rect(t),popover:rect(document.querySelector(kind==='attachment'?'.pm-attach-sheet-action':'#pm-msheet')),composerHit:document.elementFromPoint(c.getBoundingClientRect().right-20,c.getBoundingClientRect().bottom-20)?.className,tabHit:document.elementFromPoint(35,t.getBoundingClientRect().top+20)?.className}},kind);
      console.log(JSON.stringify({before,height,kind,...state}));
      await page.screenshot({path:path.join(out,`laneF-${before?'before':'after'}-${kind}-${height}.png`)});
      if (!before) {
        const detail = await page.evaluate(kind => {
          const trigger = document.querySelector(kind === 'attachment' ? '#pm-attach' : '.pm-composer-model-badge').getBoundingClientRect();
          const popover = document.querySelector(kind === 'attachment' ? '.pm-attach-sheet-action' : '#pm-msheet');
          const r = popover.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const scrim = document.querySelector(kind === 'attachment' ? '.pm-composer-popover-scrim' : '#pm-msheet-scrim');
          return {gap: trigger.top - r.bottom, interactive: popover.contains(hit), blur: getComputedStyle(scrim).backdropFilter};
        }, kind);
        if (!String(state.tabHit).includes('scrim') || !String(state.composerHit).includes('scrim')) throw Error('Composer/navigation not behind scrim');
        if (state.popover.y < 0 || detail.gap < 0 || detail.gap > 80) throw Error('Popover is not directly above trigger: ' + JSON.stringify(detail));
        if (kind === 'reasoning' && Math.abs(detail.gap - 8) > 1) throw Error('Reasoning trigger gap is not 8px');
        if (!detail.interactive || !detail.blur.includes('blur')) throw Error('Popover hit-test or backdrop blur failed');
        await page.mouse.click(8, 40);
        if (!await page.evaluate(() => window.__dismissed)) throw Error('Backdrop did not dismiss popover');
      }
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
