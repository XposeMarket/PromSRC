from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8', newline='')


# The runtime patch must already be present. This helper now only applies the
# final review refinements that need an exact branch checkout.
router_path = 'src/gateway/routes/chat.router.ts'
router = read(router_path)
if 'getActiveHistoryForApiCall(sessionId)' not in router:
    raise SystemExit('PR171 runtime patch is missing')

# The legacy UI toggle may disable proactive/legacy rolling maintenance, but it
# must never disable the hard model-call token-budget safety path now that
# message-count truncation has been removed.
legacy_disable = "  if (cfg?.rollingCompactionEnabled === false) return { compacted: false, projectedTokens: 0, triggerTokens: 0 };\n"
if legacy_disable in router:
    router = router.replace(legacy_disable, '', 1)
    write(router_path, router)
    print('Removed legacy hard-safety disable from model-call compaction')

path = 'web-ui/src/mobile/mobile-settings.js'
text = read(path)
if "card('Context Compaction'" not in text:
    old_card = """    ${card('Context Window', `
      <div class=\"pm-card-body\">Prometheus uses the selected model's token window automatically. Full active conversation context is retained until token pressure requires rolling compaction; there is no message-count context limit.</div>
    `, 'clipboard')}
"""
    new_card = """    ${card('Context Compaction', `
      <div class=\"pm-card-body\">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${toggleRow('pm-session-roll', 'Rolling compaction', session.rollingCompactionEnabled !== false, 'Enable proactive rolling summaries. Hard token-window safety remains automatic.')}
      ${field('Compaction threshold', input('pm-session-compact', session.compactionThreshold || 0.82, 'type=\"number\" min=\"0.4\" max=\"0.95\" step=\"0.01\"'))}
      ${field('Memory flush threshold', input('pm-session-memory', session.memoryFlushThreshold || 0.9, 'type=\"number\" min=\"0.5\" max=\"0.98\" step=\"0.01\"'))}
      ${field('Rolling tool turns', input('pm-session-tool-turns', session.rollingCompactionToolTurns || 4, 'type=\"number\" min=\"1\" max=\"12\"'))}
      ${field('Summary max words', input('pm-session-words', session.rollingCompactionSummaryMaxWords || 900, 'type=\"number\" min=\"80\" max=\"1500\"'))}
      ${field('Compaction model override', input('pm-session-model', session.rollingCompactionModel || '', 'placeholder=\"Optional\"'))}
      <button class=\"pm-btn primary\" id=\"pm-save-session\">${ICONS.check} Save compaction</button>
    `, 'clipboard')}
"""
    if old_card not in text:
        raise SystemExit('simplified Context Window card not found')
    text = text.replace(old_card, new_card, 1)

for obsolete in [
    "        maxMessages: Number(val(page, 'pm-session-max')),\n",
    "        rollingCompactionMessageCount: Number(val(page, 'pm-session-roll-count')),\n",
]:
    text = text.replace(obsolete, '', 1)
write(path, text)
print('PR171 final runtime/settings refinements applied')
