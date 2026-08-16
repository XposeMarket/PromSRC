from pathlib import Path
p = Path('src/gateway/provider-status.ts')
text = p.read_text(encoding='utf-8')
old = """  const cached = readProviderStatusCache(cacheKey);\n  if (cached) return cached.connected;\n\n  const connected = await Promise.race([\n"""
new = """  const cached = readProviderStatusCache(cacheKey);\n  if (cached) {\n    providerStatusChecking = false;\n    return cached.connected;\n  }\n\n  const connected = await Promise.race([\n"""
if old not in text:
    raise SystemExit('provider status cache-hit anchor not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')

reg = Path('src/gateway/provider-status.regression.ts')
r = reg.read_text(encoding='utf-8')
r = r.replace(
    "  invalidateProviderStatusCache,\n  markProviderStatus,",
    "  invalidateProviderStatusCache,\n  isProviderStatusChecking,\n  markProviderStatus,\n  markProviderStatusChecking,",
    1,
)
old_assert = """    assert.equal(second, true, 'fresh same-identity result should be reused');\n    assert.equal(probes, 1, 'fresh cache should suppress duplicate provider probes');\n\n    const oldProbe = resolveProviderStatus(async () => {\n"""
new_assert = """    assert.equal(second, true, 'fresh same-identity result should be reused');\n    assert.equal(probes, 1, 'fresh cache should suppress duplicate provider probes');\n    markProviderStatusChecking(true);\n    await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');\n    assert.equal(isProviderStatusChecking(), false, 'a periodic cache hit must clear the transient checking flag');\n    assert.equal(probes, 1, 'checking-flag refresh must not force another provider probe');\n\n    const oldProbe = resolveProviderStatus(async () => {\n"""
if old_assert not in r:
    raise SystemExit('provider status regression anchor not found')
reg.write_text(r.replace(old_assert, new_assert, 1), encoding='utf-8')
print('provider status checking reset patch applied')
