import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { takeSnapshot } from '../src/gateway/browser/snapshot';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {const page=await browser.newPage();await page.evaluate('globalThis.__name = (fn) => fn');await page.setContent('<input aria-label="Password" type=password value="CANARY_PASSWORD"><input aria-label="Code" autocomplete=one-time-code value="CANARY_OTP"><input aria-label="Saved" data-prom-secret value="CANARY_MARKED"><input aria-label="Ordinary" value="visible">');
 for(const limit of [25,100,500]){const snap=await takeSnapshot(page as any,limit);assert(!snap.includes('CANARY'),snap);assert(snap.includes('visible'),snap);}
 console.log('PASS real Chromium snapshot: password/OTP/broker-marked values masked; ordinary inputs retained.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
