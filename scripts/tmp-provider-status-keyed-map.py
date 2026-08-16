from pathlib import Path
p = Path('src/gateway/provider-status.ts')
text = p.read_text(encoding='utf-8')
text = text.replace(
    "let providerStatusCache: ProviderStatusCacheEntry | null = null;\nlet providerStatusChecking = false;",
    "const providerStatusCache = new Map<string, ProviderStatusCacheEntry>();\nconst PROVIDER_STATUS_CACHE_ENTRY_LIMIT = 8;\nlet providerStatusChecking = false;",
    1,
)
text = text.replace(
    "  providerStatusCache = { checkedAt: Date.now(), connected, cacheKey };",
    "  providerStatusCache.set(cacheKey, { checkedAt: Date.now(), connected, cacheKey });\n  while (providerStatusCache.size > PROVIDER_STATUS_CACHE_ENTRY_LIMIT) {\n    const oldest = [...providerStatusCache.entries()].sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0];\n    if (!oldest) break;\n    providerStatusCache.delete(oldest[0]);\n  }",
    1,
)
text = text.replace("  providerStatusCache = null;", "  providerStatusCache.clear();", 1)
old_read = """  const cached = providerStatusCache;\n  if (!cached) return null;\n  if (cached.cacheKey !== cacheKey || Date.now() - cached.checkedAt >= PROVIDER_STATUS_CACHE_MS) {\n    if (providerStatusCache === cached) providerStatusCache = null;\n    return null;\n  }\n  return { checkedAt: cached.checkedAt, connected: cached.connected };\n"""
new_read = """  const cached = providerStatusCache.get(cacheKey);\n  if (!cached) return null;\n  if (Date.now() - cached.checkedAt >= PROVIDER_STATUS_CACHE_MS) {\n    providerStatusCache.delete(cacheKey);\n    return null;\n  }\n  return { checkedAt: cached.checkedAt, connected: cached.connected };\n"""
if old_read not in text:
    raise SystemExit('provider status read anchor not found')
text = text.replace(old_read, new_read, 1)
p.write_text(text, encoding='utf-8')

reg = Path('src/gateway/provider-status.regression.ts')
r = reg.read_text(encoding='utf-8')
old = "assert.equal(readProviderStatusCache('new-provider'), null, 'an old in-flight probe must not be relabeled as the new provider identity');"
new = "assert.equal(readProviderStatusCache('new-provider')?.connected, true, 'an old in-flight probe must not overwrite the new provider identity');"
if old not in r:
    raise SystemExit('provider status race regression anchor not found')
reg.write_text(r.replace(old, new, 1), encoding='utf-8')
print('provider status keyed map patch applied')
