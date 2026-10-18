/**
 * GPT models (trained on ChatGPT's UI) sometimes emit private layout markup
 * such as <row>, <box>, <AsyncImage/> and <Entity value="X"/>. Prometheus has
 * no renderer for it, so labels vanished, bold kept raw ** and image slots
 * left blank gaps on mobile/desktop and leaked as raw tags on channels.
 * Keep Entity text, drop the layout/image tags, leave code fences untouched.
 * Mirrored client-side by stripChatUiMarkup in web-ui/src/utils.js so replies
 * already saved in history render cleanly too.
 */
const CHAT_UI_MARKUP_TEST_RE = /<(?:Entity|AsyncImage)\b|<\/?(?:row|box)\b/;

export function stripChatUiMarkup(text: string): string {
  const s = String(text ?? '');
  if (!CHAT_UI_MARKUP_TEST_RE.test(s)) return s;
  return s.split(/(```[\s\S]*?```)/).map((part, i) => (i % 2 ? part : part
    .replace(/<Entity\b[^>]*?\bvalue=(?:"([^"]*)"|'([^']*)')[^>]*?\/?>/g, (_m, a, b) => a ?? b ?? '')
    .replace(/<Entity\b[^>]*?\/?>/g, '')
    .replace(/<AsyncImage\b[^>]*?\/?>[ \t]*\n?/g, '')
    .replace(/^[ \t]*<\/?(?:row|box)\b[^>]*>[ \t]*(?:\n|$)/gm, '')
    .replace(/<\/?(?:row|box)\b[^>]*>/g, '')
    .replace(/^[ \t]+(?=\*\*|\[|[A-Za-z])/gm, '')
  )).join('').replace(/\n{3,}/g, '\n\n');
}
