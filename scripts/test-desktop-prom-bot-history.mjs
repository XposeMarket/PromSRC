import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Exercise the real desktop bootstrap, sidebar, and history renderer. Only the
// gateway responses are fixtures; no account, model, or actual chat is touched.
const root = fileURLToPath(new URL('../web-ui/', import.meta.url));
const origin = 'http://prom-bot-history.test';
const agent = { id: 'history-bot', name: 'History Bot', status: 'idle' };
const emptyAgent = { id: 'empty-bot', name: 'Empty Bot', status: 'idle' };
const now = Date.now();
const messages = [
  { id: 'question', role: 'user', content: 'Did you finish the review?', ts: now - 3000 },
  { id: 'count', role: 'agent', content: 'The existing review is complete.', steps: 3, ts: now - 2000 },
  { id: 'metadata-count', role: 'agent', content: 'The follow-up notes are ready.', metadata: { stepCount: 2 }, ts: now - 1000 },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(10000);
  const errors = [];
  let openError = '';
  let fetchedHistory = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('[Prom Bot] Could not open subagent chat:')) openError = message.text();
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const { pathname } = url;
    if (pathname === '/api/account/status') return route.fulfill({ json: { authenticated: true, accountRequired: false } });
    if (pathname === '/api/onboarding/status') return route.fulfill({ json: { nextStep: 'done' } });
    if (pathname === '/api/agents') return route.fulfill({ json: { agents: [agent, emptyAgent] } });
    if (pathname === `/api/agents/${agent.id}/chat`) {
      fetchedHistory ||= url.searchParams.get('limit') === '100';
      return route.fulfill({ json: { messages } });
    }
    if (pathname === `/api/agents/${emptyAgent.id}/chat`) return route.fulfill({ json: { messages: [] } });
    if (pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (file.startsWith(root) && existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Turn on Prom Bot mode' }).click().catch(error => {
    throw new Error(`${error.message}\nDesktop boot errors: ${errors.join('; ')}`);
  });
  await page.locator('.prom-bot-agent-row').filter({ hasText: agent.name }).click();
  const surface = page.locator('#prom-bot-main-surface');
  const composer = surface.locator('#subagent-chat-input');
  try {
    await composer.waitFor({ state: 'visible' });
  } catch (error) {
    if (openError) assert.fail(openError);
    throw error;
  }
  assert.equal(fetchedHistory, true, 'opening the sidebar row must request full chat history');
  const history = surface.locator('#subagent-chat-messages');
  for (const { content } of messages) {
    await history.getByText(content, { exact: false }).waitFor().catch(async error => {
      throw new Error(`${error.message}\nRendered fixture history: ${await history.innerText()}`);
    });
  }
  assert.equal(await history.locator('.react-step').count(), 0, 'numeric metadata is not a list of tool actions');
  assert.equal(await composer.isEditable(), true);

  // Prove the shared footer still renders real tool actions for ordinary desktop chat.
  const footer = await page.evaluate(() => window.renderReactSteps([
    null, { thought: 'Not an action' }, { action: 'read_file', toolResult: 'Example result' },
  ]));
  assert.match(footer, /class="react-step-action">read_file</);
  assert.match(footer, /Example result/);
  assert.doesNotMatch(footer, /Not an action/);
  assert.equal(openError, '');

  const screenshots = process.env.PROM_BOT_HISTORY_SCREENSHOTS;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'bot-chat-history.png'), animations: 'disabled' });
  }

  await page.locator('.prom-bot-agent-row').filter({ hasText: emptyAgent.name }).click();
  await history.getByText('Start a direct chat with Empty Bot.', { exact: false }).waitFor();
  assert.equal(await composer.isEditable(), true);
  assert.deepEqual(errors, [], 'desktop runtime should not throw');
  assert.equal(openError, '');
  console.log('PASS: Bot sidebar opens existing and empty chats; numeric counts are ignored and action arrays still render.');
} finally {
  await browser.close();
}
