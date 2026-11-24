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

import { usageCutoffNotice } from './provider-error-presentation';
const now=Date.UTC(2026,10,20), reset=now+4*86400000;
const notice=(headers:Record<string,string>)=>usageCutoffNotice({message:'anthropic API error 429: rate_limit_error',rateLimitHeaders:headers},now)!;
assert.match(notice({'anthropic-ratelimit-unified-7d-status':'rejected','anthropic-ratelimit-unified-7d-reset':String(reset/1000)}),/Resets .+\n\nType `continue` to resume\.$/);
assert.match(notice({'retry-after':'120'}),/Try again /);
assert.match(notice({'anthropic-ratelimit-unified-reset':'bad'}),/Reset time unavailable/);
assert.equal(usageCutoffNotice(new Error('HTTP 429: capacity unavailable')),undefined);
assert.match(usageCutoffNotice({message:'openai_codex API error 429: usage_limit_reached',resets_at:reset},now)!,/Resets /);
