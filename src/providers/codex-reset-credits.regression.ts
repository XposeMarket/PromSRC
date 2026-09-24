import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { creditRedeemRequestId, selectAvailableCredits } from './codex-reset-credits';

// Reference implementation copied from T3 Code (apps/server/src/usage/cliproxyApi.ts)
// so both apps derive the same redeem id and a retry in either one dedupes.
function t3(accountId: string, creditId: string): string {
  const bytes = crypto.createHash('sha1')
    .update(Buffer.from('6f1c2a9e2d4b4c1e9a7f3b8d5e0c1a42', 'hex'))
    .update(`${accountId}:${creditId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const id = creditRedeemRequestId('acct-1', 'cred-9');
assert.equal(id, t3('acct-1', 'cred-9'));
assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(creditRedeemRequestId('acct-1', 'cred-9'), id, 'deterministic');
assert.notEqual(creditRedeemRequestId('acct-1', 'cred-8'), id);

const now = Date.parse('2026-09-24T00:00:00Z');
const picked = selectAvailableCredits({
  credits: [
    { id: 'late', status: 'available', reset_type: 'codex_rate_limits', expires_at: '2026-10-20T00:00:00Z' },
    { id: 'soon', status: 'available', reset_type: 'codex_rate_limits', expires_at: '2026-09-30T00:00:00Z' },
    { id: 'used', status: 'redeemed', reset_type: 'codex_rate_limits', expires_at: '2026-10-01T00:00:00Z' },
    { id: 'expired', status: 'available', reset_type: 'codex_rate_limits', expires_at: '2026-09-01T00:00:00Z' },
    { id: 'other', status: 'available', reset_type: 'something_else', expires_at: '2026-10-01T00:00:00Z' },
  ],
}, now);
assert.deepEqual(picked.map((c) => c.id), ['soon', 'late'], 'available codex credits, soonest expiry first');
assert.deepEqual(selectAvailableCredits({}, now), []);
assert.deepEqual(selectAvailableCredits(null, now), []);

console.log('codex reset credits regression passed');
