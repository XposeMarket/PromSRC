import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { needsYouCount } from '../web-ui/src/needs-you-view-model.js';
import { preserveRequestCards } from '../web-ui/src/features/tasks/preserve-request-cards.js';
const question = { id: 'question:q1', kind: 'question', sessionId: 's1', payload: { id: 'q1', questions: [{id:'text',mode:'text',label:'Details'}] } };
assert.equal(needsYouCount([{ id: 'chat-plan:1', sourceKind: 'planned_chat', sessionId: 's1', status: 'awaiting_user_input' }], [question]), 1);
assert.equal(needsYouCount([{ id: 'chat-plan:2', sourceKind: 'planned_chat', sessionId: 's2', status: 'awaiting_user_input' }], [question]), 2);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main><article data-ny-entry="question:q1"><textarea></textarea><button>Submit</button></article></main>');
  await page.evaluate(({ source, question }) => {
    window.preserve = (0, eval)(`(${source})`);
    window.entry = { id: question.id, item: question };
    preserve(document.querySelector('main'), [entry])();
    window.original = document.querySelector('article');
    window.clicks = 0; original.querySelector('button').onclick = () => clicks++;
  }, { source: preserveRequestCards.toString(), question });
  await page.locator('textarea').fill('Do not erase this draft');
  await page.locator('textarea').focus();
  await page.evaluate(() => {
    const root = document.querySelector('main');
    const restore = preserve(root, [entry]);
    root.innerHTML = '<article data-ny-entry="question:q1"><textarea></textarea><button>Submit</button></article>';
    restore();
    if (document.querySelector('article') !== original) throw new Error('Form node was replaced');
    if (document.activeElement !== original.querySelector('textarea')) throw new Error('Focus lost');
  });
  assert.equal(await page.locator('textarea').inputValue(), 'Do not erase this draft');
  await page.getByRole('button').click();
  assert.equal(await page.evaluate(() => clicks), 1);
  await page.evaluate(() => { const root=document.querySelector('main'); const restore=preserve(root,[]); root.innerHTML=''; restore(); });
  assert.equal(await page.locator('article').count(), 0, 'resolved requests are never restored');
} finally { await browser.close(); }
for (const path of ['src/gateway/routes/chat.router.ts', 'src/gateway/routes/chat/pipeline/restart-continuity.ts']) {
  const source=fs.readFileSync(path,'utf8');
  assert.match(source,/recordPlannedChatProgress\(runtimeId/);
  assert.match(source,/finishPlannedChatRun\(runtimeId/);
}
const desktop=fs.readFileSync('web-ui/src/pages/TasksPage.js','utf8');
const mobile=fs.readFileSync('web-ui/src/mobile/mobile-tasks-pages.js','utf8');
assert.match(desktop,/sourceKind === 'planned_chat'/); assert.match(mobile,/sourceKind === 'planned_chat'/);
assert.match(desktop,/prepareTaskQuestionCards/); assert.match(mobile,/prepareMobileTaskInteractions/);
console.log('PASS Tasks dedup, live form node/draft/focus preservation, handler identity, resolved removal, route lifecycle wiring');
