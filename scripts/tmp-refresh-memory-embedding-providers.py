from pathlib import Path
p = Path('src/gateway/memory/embeddings/registry.ts')
text = p.read_text(encoding='utf-8')
old = '''let cachedProviders: MemoryEmbeddingProvider[] | null = null;\n\nexport function listMemoryEmbeddingProviders(): MemoryEmbeddingProvider[] {\n  if (!cachedProviders) {\n    cachedProviders = [\n      createOpenAiEmbeddingProvider(),\n      createOpenAiCodexOAuthEmbeddingProvider(),\n      createOllamaEmbeddingProvider(),\n      createLmStudioEmbeddingProvider(),\n      createVoyageEmbeddingProvider(),\n      createJinaEmbeddingProvider(),\n      hashMemoryEmbeddingProvider,\n    ];\n  }\n  return cachedProviders;\n}\n\nexport function resetMemoryEmbeddingProvidersForTests(): void {\n  cachedProviders = null;\n}\n'''
new = '''export function listMemoryEmbeddingProviders(): MemoryEmbeddingProvider[] {\n  // Provider factories are intentionally rebuilt from current configuration.\n  // They are lightweight descriptors, while caching them freezes endpoint,\n  // model, and secret-reference choices captured when the gateway first asks\n  // for memory embeddings. Settings changes must take effect without restart.\n  return [\n    createOpenAiEmbeddingProvider(),\n    createOpenAiCodexOAuthEmbeddingProvider(),\n    createOllamaEmbeddingProvider(),\n    createLmStudioEmbeddingProvider(),\n    createVoyageEmbeddingProvider(),\n    createJinaEmbeddingProvider(),\n    hashMemoryEmbeddingProvider,\n  ];\n}\n\nexport function resetMemoryEmbeddingProvidersForTests(): void {\n  // Kept as a compatibility no-op for existing tests/callers. Providers no\n  // longer retain configuration-backed state between resolutions.\n}\n'''
if old not in text:
    raise SystemExit('memory embedding provider cache anchor not found')
p.write_text(text.replace(old,new,1), encoding='utf-8')

reg = Path('scripts/test-memory-embedding-provider-cache-contract.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/gateway/memory/embeddings/registry.ts','utf8');
assert.doesNotMatch(source, /cachedProviders/, 'embedding provider descriptors must not freeze configuration for gateway lifetime');
assert.match(source, /export function listMemoryEmbeddingProviders[\s\S]*?createOpenAiEmbeddingProvider\(\)/);
assert.match(source, /Settings changes must take effect without restart/);
console.log('memory embedding provider cache contract regression: ok');
''', encoding='utf-8')
print('memory embedding provider cache patch applied')