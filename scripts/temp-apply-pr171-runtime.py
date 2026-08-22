from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8', newline='')


router = read('src/gateway/routes/chat.router.ts')
if 'getActiveHistoryForApiCall(sessionId)' not in router:
    raise SystemExit('PR171 runtime patch is missing')

path = 'web-ui/src/mobile/mobile-settings.js'
text = read(path)
if "card('Context Compaction'" in text and "maxMessages: Number(val(page, 'pm-session-max'))" not in text:
    print('PR171 settings refinement already present')
    raise SystemExit(0)

old_card = """    ${card('Context Window', `
      <div class=\"pm-card-body\">Prometheus uses the selected model's token window automatically. Full active conversation context is retained until token pressure requires rolling compaction; there is no message-count context limit.</div>
    `, 'clipboard')}
"""
new_card = """    ${card('Context Compaction', `
      <div class=\"pm-card-body\">Prometheus uses the selected model's token window automatically. Context is compacted only when token pressure requires it; message count does not define model context.</div>
      ${toggleRow('pm-session-roll', 'Rolling compaction', session.rollingCompactionEnabled !== false, 'Automatically summarize older active context when token pressure requires it.')}
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
    if obsolete not in text:
        raise SystemExit(f'expected obsolete save field missing: {obsolete.strip()}')
    text = text.replace(obsolete, '', 1)
write(path, text)
print('PR171 token-aware mobile settings refined')
