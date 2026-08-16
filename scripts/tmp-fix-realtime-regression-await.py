from pathlib import Path
p = Path('src/gateway/realtime/codex-app-server-bridge.regression.ts')
text = p.read_text(encoding='utf-8')
anchor = "const cleanup = new CodexAppServerBridge() as any;"
if anchor not in text:
    raise SystemExit('realtime regression start anchor not found')
text = text.replace(anchor, "async function main(): Promise<void> {\n" + anchor, 1)
end = "console.log('codex realtime cache cleanup regression: ok');"
if end not in text:
    raise SystemExit('realtime regression end anchor not found')
text = text.replace(end, end + "\n}\n\nmain().catch((error) => {\n  console.error(error);\n  process.exitCode = 1;\n});", 1)
p.write_text(text, encoding='utf-8')
print('realtime regression async wrapper applied')
