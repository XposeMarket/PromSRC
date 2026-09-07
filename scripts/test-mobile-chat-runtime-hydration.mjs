import assert from 'node:assert/strict';

import { createMobileChatPageRenderer } from '../web-ui/src/mobile/mobile-chat-page-runtime.js';

const expectedStop = new Error('hydration regression reached post-runtime setup');
const receiptLedger = { has: () => false, add: () => {} };
let ledgerCreations = 0;
let boundReceipts = null;

const hydratedRuntime = {
  createMobileStreamReceiptLedger() {
    ledgerCreations += 1;
    return receiptLedger;
  },
  _renderChatMessageHtml() {
    return '<div>hydrated</div>';
  },
};

const context = {
  __pmChat: {},
  mobileChatRendererRuntime: null,
  async loadMobileChatRendererRuntime() {
    return hydratedRuntime;
  },
  setReceipts(value) {
    boundReceipts = value;
  },
  async _ensureMobileQuestionController() {
    throw expectedStop;
  },
};

const renderChatPage = createMobileChatPageRenderer(() => context);
await assert.rejects(
  renderChatPage({}, { navigate() {} }),
  (error) => error === expectedStop,
  'the route should advance beyond renderer hydration without dereferencing its stale null context snapshot',
);

assert.equal(ledgerCreations, 1, 'the hydrated runtime must create the route receipt ledger');
assert.equal(boundReceipts, receiptLedger, 'the hydrated ledger must be rebound into shared page state');

console.log('Mobile Chat runtime hydration regression passed.');
