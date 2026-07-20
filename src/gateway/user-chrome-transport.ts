/** Page-shaped adapter for the Personal Chrome extension's chrome.debugger CDP. */
import { getUserChromeRelay } from './user-chrome-relay.js';

let relayFactory: () => any = getUserChromeRelay;
/** Test seam; production always uses the authenticated relay singleton. */
export function setUserChromeRelayFactoryForTesting(factory?: () => any): void { relayFactory = factory || getUserChromeRelay; }
function relay() { return relayFactory(); }

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); }
function expressionFor(fn: any, arg: any): string {
  const serialized = arg === undefined ? '' : `, ${JSON.stringify(arg)}`;
  return `(${String(fn)})(${serialized.slice(2)})`;
}
function keyDefinition(key: string): { key: string; code: string; modifiers: number } {
  const parts = String(key || '').split('+'); const value = parts.pop() || '';
  const modifiers = (parts.includes('Control') || parts.includes('Ctrl') ? 2 : 0) | (parts.includes('Alt') ? 1 : 0) | (parts.includes('Shift') ? 8 : 0) | (parts.includes('Meta') ? 4 : 0);
  const aliases: Record<string, string> = { Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Space: ' ' };
  return { key: aliases[value] || value, code: aliases[value] || (value.length === 1 ? `Key${value.toUpperCase()}` : value), modifiers };
}

export class UserChromePage {
  readonly keyboard: any;
  readonly mouse: any;
  private tab: any;
  constructor(tab: any) {
    this.tab = tab;
    this.keyboard = {
      press: async (key: string) => {
        const def = keyDefinition(key);
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...def });
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...def });
      },
      type: async (text: string) => this.cdp('Input.insertText', { text: String(text || '') }),
      insertText: async (text: string) => this.cdp('Input.insertText', { text: String(text || '') }),
    };
    this.mouse = {
      move: async (x: number, y: number) => this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
      down: async () => this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 0, y: 0, button: 'left', clickCount: 1 }),
      up: async () => this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 0, y: 0, button: 'left', clickCount: 1 }),
      click: async (x: number, y: number, options: any = {}) => {
        const button = options.button || 'left';
        await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
      },
      wheel: async (deltaX: number, deltaY: number) => this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX, deltaY }),
    };
  }
  tabId() { return this.tab.id; }
  updateTab(tab: any) { this.tab = { ...this.tab, ...tab }; }
  private async request(method: string, params: any = {}, timeoutMs?: number) { return relay().request(method, { ...params, tabId: this.tab.id }, timeoutMs); }
  async cdp(method: string, params: any = {}) { return this.request('cdp', { method, params }); }
  url() { return String(this.tab.url || 'about:blank'); }
  async title() { const t = await this.request('tabs.get'); this.updateTab(t); return String(t.title || ''); }
  async goto(url: string) { await this.request('tabs.navigate', { url }); await sleep(75); const t = await this.request('tabs.get'); this.updateTab(t); return null; }
  async reload() { return this.cdp('Page.reload', {}); }
  async goBack() { const h = await this.cdp('Page.getNavigationHistory'); const entry = h.entries?.[Math.max(0, Number(h.currentIndex || 0) - 1)]; if (!entry) return null; return this.cdp('Page.navigateToHistoryEntry', { entryId: entry.id }); }
  async goForward() { const h = await this.cdp('Page.getNavigationHistory'); const entry = h.entries?.[Math.min((h.entries?.length || 1) - 1, Number(h.currentIndex || 0) + 1)]; if (!entry) return null; return this.cdp('Page.navigateToHistoryEntry', { entryId: entry.id }); }
  async bringToFront() { return this.request('tabs.activate', { windowId: this.tab.windowId }); }
  async close() { return this.request('tabs.remove', {}); }
  async waitForTimeout(ms: number) { await sleep(ms); }
  async waitForLoadState() { await sleep(100); }
  async waitForSelector(selector: string, options: any = {}) { return this.locator(selector).first().waitFor(options); }
  async addInitScript() { /* cannot persist script across untrusted navigations */ }
  async screenshot(options: any = {}) {
    const result = await this.cdp('Page.captureScreenshot', { format: options.type === 'jpeg' ? 'jpeg' : 'png', fromSurface: true, captureBeyondViewport: !!options.fullPage });
    return Buffer.from(String(result.data || ''), 'base64');
  }
  viewportSize() { return { width: Number(this.tab.width || 1280), height: Number(this.tab.height || 720) }; }
  async evaluate(fn: any, arg?: any): Promise<any> {
    const response = await this.cdp('Runtime.evaluate', { expression: expressionFor(fn, arg), awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Page JavaScript evaluation failed.');
    return response.result?.value;
  }
  async evaluateHandle(_fn: any, _arg?: any): Promise<any> { throw new Error('File input handles are unavailable in Personal Chrome. Use the website chooser manually; uploads are intentionally unsupported by chrome.debugger.'); }
  locator(selector: string) { return new UserChromeLocator(this, selector); }
  frames() { return [this]; }
  on() { return this; }
  off() { return this; }
  async waitForEvent() { throw new Error('Download event streaming is unavailable in Personal Chrome; inspect Chrome downloads after the click.'); }
}

export class UserChromeLocator {
  constructor(private readonly page: UserChromePage, private readonly selector: string) {}
  first() { return this; }
  locator(selector: string) { return new UserChromeLocator(this.page, `${this.selector} ${selector}`); }
  private async one<T>(body: string): Promise<T> { return this.page.evaluate(new Function('s', `const e=document.querySelector(s); ${body}`), this.selector); }
  async count() { return this.page.evaluate((s: string) => (globalThis as any).document.querySelectorAll(s).length, this.selector); }
  async isVisible() { return this.one<boolean>('if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!(r.width&&r.height&&s.visibility!=="hidden"&&s.display!=="none");'); }
  async textContent() { return this.one<string | null>('return e ? (e.textContent||"") : null;'); }
  async innerText() { return this.one<string>('return e ? (e.innerText||e.textContent||"") : "";'); }
  async getAttribute(name: string) { return this.page.evaluate((x: any) => (globalThis as any).document.querySelector(x.s)?.getAttribute(x.n) ?? null, { s: this.selector, n: name }); }
  async boundingBox() { return this.one<any>('if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};'); }
  async scrollIntoViewIfNeeded() { return this.one<void>('e?.scrollIntoView({block:"center",inline:"center"});'); }
  async click() { const b = await this.boundingBox(); if (!b) throw new Error(`No element found for selector "${this.selector}"`); await this.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
  async fill(text: string) { return this.page.evaluate((x: any) => { const g: any = globalThis; const e: any = g.document.querySelector(x.s); if (!e) throw new Error('not found'); e.focus(); e.value = x.t; e.dispatchEvent(new g.InputEvent('input', { bubbles: true, inputType: 'insertText', data: x.t })); e.dispatchEvent(new g.Event('change', { bubbles: true })); }, { s: this.selector, t: text }); }
  async evaluate(fn: any, arg?: any) { return this.page.evaluate((x: any) => { const e = (globalThis as any).document.querySelector(x.s); if (!e) throw new Error('not found'); return (new Function('el', 'arg', `return (${x.f})(el,arg)`))(e, x.a); }, { s: this.selector, f: String(fn), a: arg }); }
  async waitFor(options: any = {}) { const deadline = Date.now() + Number(options.timeout || 5_000); while (Date.now() < deadline) { if (await this.isVisible().catch(() => false)) return; await sleep(100); } throw new Error(`Timed out waiting for ${this.selector}`); }
  async setInputFiles() { throw new Error('File upload is unsupported in Personal Chrome because Chrome extensions cannot safely set a page file input.'); }
}

export async function createUserChromePage(): Promise<UserChromePage> {
  const connection = relay();
  const tabs = await connection.request('tabs.list');
  const active = tabs.find((tab: any) => tab.active) || tabs.find((tab: any) => /^https?:|^file:/.test(tab.url || '')) || tabs[0];
  if (!active) throw new Error('No Chrome tab is available. Open a regular Chrome tab and retry.');
  return new UserChromePage(active);
}
