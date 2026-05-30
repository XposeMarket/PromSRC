const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const videoPath = path.resolve('workspace/downloads/x_fetch_media/videos/polsia-main-promo.mp4');
  const outDir = path.resolve('workspace/downloads/x_fetch_media/videos/polsia-analysis-frames/manual');
  fs.mkdirSync(outDir, { recursive: true });
  const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({ headless: false, executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:black"><video id="v" src="file:///${videoPath.replace(/\\/g,'/')}" width="1280" height="720" crossorigin="anonymous" muted playsinline preload="auto"></video><canvas id="c" width="1280" height="720" style="display:none"></canvas></body></html>`);
  const duration = await page.evaluate(async () => {
    const v = document.getElementById('v');
    if (v.readyState < 1) await new Promise((res, rej) => { v.addEventListener('loadedmetadata', res, {once:true}); v.addEventListener('error', () => rej(new Error('video load error')), {once:true}); setTimeout(()=>rej(new Error('metadata timeout')), 15000); });
    return v.duration;
  });
  console.log('duration', duration);
  const times = [0.5, 3, 7, 12, 18, 25, 34, 43, 52, 62, 74, Math.max(0, duration - 1)];
  for (const t of times) {
    await page.evaluate(async (t) => {
      const v = document.getElementById('v');
      const c = document.getElementById('c');
      const ctx = c.getContext('2d');
      v.currentTime = Math.min(t, v.duration - 0.1);
      await new Promise((res) => { v.addEventListener('seeked', res, {once:true}); setTimeout(res, 3000); });
      ctx.drawImage(v, 0, 0, c.width, c.height);
    }, t);
    const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);
    const file = path.join(outDir, `frame_${String(Math.round(t*10)).padStart(4,'0')}_${t.toFixed(1).replace('.','p')}s.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(file);
  }
  await browser.close();
})();
