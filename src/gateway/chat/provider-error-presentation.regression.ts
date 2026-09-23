import assert from 'node:assert/strict';
import { presentProviderCallFailure } from './provider-error-presentation';

const quotaError = new Error('anthropic API error 400: {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_test"}');
const rendered = presentProviderCallFailure(quotaError);
assert.match(rendered, /Anthropic billed this request to extra usage instead of your Claude plan/);
assert.match(rendered, /extra usage is turned off on the account\. Prometheus already retried once/);
assert.match(rendered, /switch to another connected model/);
assert.doesNotMatch(rendered, /\{"type"|req_test/);
assert.equal(presentProviderCallFailure(new Error('anthropic API error 400: invalid JSON')), 'Error: anthropic API error 400: invalid JSON');
assert.equal(presentProviderCallFailure(new Error('other failure')), 'Error: other failure');
console.log('Provider error presentation regression passed.');
