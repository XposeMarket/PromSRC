import assert from 'node:assert/strict';
import { PluginConnectionPlanResolver } from './plugin-plan-resolver.js';

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

async function main(): Promise<void> {
  const resolver = new PluginConnectionPlanResolver(() => []);

  const readOnlyPlan = await resolver.resolve({
    serviceId: 'gmail',
    requestedCapabilities: ['email.read', 'email.send'],
    readOnly: true,
  });
  assert.equal(readOnlyPlan.strategy.readOnly, true);
  assert(readOnlyPlan.requestedScopes?.includes(GMAIL_READONLY));
  assert(!readOnlyPlan.requestedScopes?.includes(GMAIL_SEND));
  assert(!readOnlyPlan.requestedScopes?.includes(GMAIL_MODIFY));
  assert(!readOnlyPlan.strategy.capabilities.includes('email.send'));

  const sendPlan = await resolver.resolve({
    serviceId: 'gmail',
    requestedCapabilities: ['email.read', 'email.send'],
    readOnly: false,
  });
  assert.equal(sendPlan.strategy.readOnly, false);
  assert(sendPlan.strategy.capabilities.includes('email.send'));
  assert(sendPlan.requestedScopes?.includes(GMAIL_READONLY));
  assert(sendPlan.requestedScopes?.includes(GMAIL_SEND));
  assert(!sendPlan.requestedScopes?.includes(GMAIL_MODIFY));
  assert.deepEqual(sendPlan.requestedScopes, sendPlan.strategy.authentication?.scopes);

  const modifyPlan = await resolver.resolve({
    serviceId: 'gmail',
    requestedCapabilities: ['email.modify'],
    readOnly: false,
  });
  assert.equal(modifyPlan.strategy.readOnly, false);
  assert(modifyPlan.strategy.capabilities.includes('email.modify'));
  assert(modifyPlan.requestedScopes?.includes(GMAIL_MODIFY));
  assert(!modifyPlan.requestedScopes?.includes(GMAIL_SEND));

  console.log('[plugin-plan-resolver.regression] Gmail read-only defaults and explicit send/modify scope upgrades passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
