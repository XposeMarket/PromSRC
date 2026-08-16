import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/desktop-tools.ts', 'utf8');

assert.match(source, /const DESKTOP_SESSION_CACHE_LIMIT = Math\.max\(/, 'desktop session screenshot cache must have a hard entry bound');
assert.match(source, /capturedAt \+ DESKTOP_PACKET_TTL_MS <= now/, 'desktop session screenshots must expire on the same TTL as screenshot IDs');
assert.match(source, /sessions\.delete\(sessionId\);\s*sessionHistory\.delete\(sessionId\);/, 'current and previous screenshot caches must be evicted together');
assert.match(source, /export function getDesktopAdvisorPacket[\s\S]*?pruneDesktopSessionCaches\(\);/, 'reads must prune expired screenshot packets, not only future writes');
assert.match(source, /function storeDesktopPacket[\s\S]*?pruneDesktopSessionCaches\(packet\.capturedAt\);[\s\S]*?sessions\.set/, 'writes must prune before retaining another base64 screenshot packet');

console.log('desktop screenshot cache contract regression: ok');
