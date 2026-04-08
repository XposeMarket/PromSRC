// src/gateway/reply-processor.ts
// Reply sanitization and thinking-tag stripping — extracted from server-v2.ts (Step 17.1).
// Exports: separateThinkingFromContent, sanitizeFinalReply, stripExplicitThinkTags,
//          normalizeForDedup, isGreetingLikeMessage

export function separateThinkingFromContent(text: string): { reply: string; thinking: string } {
  if (!text) return { reply: '', thinking: '' };

  const hadThinkTags = /<think>/i.test(text);
  if (!hadThinkTags) return { reply: text.trim(), thinking: '' };

  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();

  if (!cleaned) return { reply: '', thinking: text };

  if (cleaned.length > 500 && /^(Okay|Ok,|Let me|First|Hmm|Wait|The user|I need|I should|So,)/i.test(cleaned)) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    let lastUseful: string | undefined;
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i];
      if (s.length > 10 && s.length < 200 && !/\b(the user|I need to|I should|let me|wait,|hmm|the rules|the tools|the instructions)\b/i.test(s)) {
        lastUseful = s;
        break;
      }
    }
    if (lastUseful) return { reply: lastUseful.trim(), thinking: cleaned };
    return { reply: '', thinking: cleaned };
  }

  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const reasoningRE = /\b(the user|the tools|the instructions|I need to|I should|let me|the problem|the question|the answer|looking at|first,|second,|wait,|hmm|the response|the correct|the assistant|check the rules|according to|the file|the current|the plan)\b/i;
  const starterRE = /^(Okay|Ok|Alright|Let me|First|Hmm|So,? |Wait|The user|Looking|I need|I should|Now,? |Since|Given|Based on|Check)/i;

  let lastIdx = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (reasoningRE.test(paragraphs[i]) || starterRE.test(paragraphs[i])) lastIdx = i;
  }

  if (lastIdx === -1) return { reply: cleaned, thinking: '' };
  if (lastIdx >= paragraphs.length - 1) {
    const last = paragraphs[paragraphs.length - 1];
    const sentences = last.split(/(?<=[.!?])\s+/);
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (!reasoningRE.test(sentences[i]) && sentences[i].length < 200) {
        return {
          reply: sentences.slice(i).join(' ').trim(),
          thinking: [...paragraphs.slice(0, -1), sentences.slice(0, i).join(' ')].join('\n\n').trim(),
        };
      }
    }
    return { reply: cleaned, thinking: '' };
  }

  const reply = paragraphs.slice(lastIdx + 1).join('\n\n');
  const replyChars = reply.replace(/\s/g, '').length;
  if (replyChars < 10 && cleaned.length > reply.length) return { reply: cleaned, thinking: '' };

  return { thinking: paragraphs.slice(0, lastIdx + 1).join('\n\n'), reply };
}

export function normalizeForDedup(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function isGreetingLikeMessage(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return false;
  if (/\b(search|open|read|write|file|code|task|build|fix|debug|run|install|http|www\.|\\.com|please|could you|can you)\b/i.test(raw)) return false;
  return /^(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening)|hey (claw|prom|prometheus|smallclaw)|hello (claw|prom|prometheus|smallclaw)|hi (claw|prom|prometheus|smallclaw)|how are you)[!.?\s]*$/i.test(raw);
}

export function sanitizeFinalReply(
  text: string,
  opts: { preflightReason?: string } = {},
): string {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  const metaPatterns: RegExp[] = [
    /^\s*No tools (are|were) needed for (this|the) greeting\.?\s*$/i,
    /^\s*Greeting only,\s*no tools needed\.?\s*$/i,
    /^\s*Advisor route selected .*$/i,
    /^\s*\[ADVISOR[^\]]*\]\s*$/i,
    /^\s*\[\/ADVISOR[^\]]*\]\s*$/i,
    /^\s*Understood\.?\s*I will execute this objective.*$/i,
  ];

  const reasonNorm = normalizeForDedup(opts.preflightReason || '');
  const parts = raw
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .filter((p) => {
      if (metaPatterns.some(re => re.test(p))) return false;
      if (reasonNorm && normalizeForDedup(p) === reasonNorm) return false;
      return true;
    });

  const deduped: string[] = [];
  let prevNorm = '';
  for (const p of parts) {
    const norm = normalizeForDedup(p);
    if (!norm) continue;
    if (norm === prevNorm) continue;
    deduped.push(p);
    prevNorm = norm;
  }

  return deduped.join('\n\n').trim();
}

export function stripExplicitThinkTags(text: string): { cleaned: string; thinking: string } {
  const raw = String(text || '');
  if (!raw) return { cleaned: '', thinking: '' };

  const blocks: string[] = [];
  let cleaned = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => {
    const t = String(inner || '').trim();
    if (t) blocks.push(t);
    return '';
  });

  const openIdx = cleaned.toLowerCase().lastIndexOf('<think>');
  if (openIdx !== -1) {
    const trailing = cleaned
      .slice(openIdx + '<think>'.length)
      .replace(/<\/think>/gi, '')
      .trim();
    if (trailing) blocks.push(trailing);
    cleaned = cleaned.slice(0, openIdx);
  }

  cleaned = cleaned.replace(/<\/think>/gi, '').trim();
  return { cleaned, thinking: blocks.join('\n\n').trim() };
}
