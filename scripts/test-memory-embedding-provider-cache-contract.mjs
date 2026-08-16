import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/gateway/memory/embeddings/registry.ts','utf8');
assert.doesNotMatch(source, /cachedProviders/, 'embedding provider descriptors must not freeze configuration for gateway lifetime');
assert.match(source, /export function listMemoryEmbeddingProviders[\s\S]*?createOpenAiEmbeddingProvider\(\)/);
assert.match(source, /Settings changes must take effect without restart/);
console.log('memory embedding provider cache contract regression: ok');
