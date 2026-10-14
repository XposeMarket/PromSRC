import { getOllamaClient } from '../../../../agents/ollama-client';
import { getSession, autoNameSession } from '../../../session';



export function cleanGeneratedSessionTitle(raw: unknown): string {
  let title = String(raw || '').trim();
  const match = title.match(/\[\s*Title\s*:\s*([^\]]+)\]/i) || title.match(/^Title\s*:\s*(.+)$/i);
  if (match) title = match[1] || '';
  title = title
    .split(/\r?\n/)[0]
    .replace(/^["'`*_ \t]+|["'`*_ \t]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,\-]+$/g, '')
    .trim();
  if (!title) return '';
  if (/^(?:new chat|untitled|greeting|hello|hey|hi)$/i.test(title)) return '';
  if (/^(?:name this|chat thread|conversation|short helpful title)$/i.test(title)) return '';
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 8) title = words.slice(0, 8).join(' ');
  return title.slice(0, 60).trim();
}

export function sessionTitleTranscript(session: ReturnType<typeof getSession>): { transcript: string; userCount: number; hasSubstantiveUserText: boolean } {
  const messages = Array.isArray(session?.history) ? session.history : [];
  const visible = messages
    .filter((msg: any) => {
      const role = String(msg?.role || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant' && role !== 'ai') return false;
      const content = String(msg?.content || '').trim();
      if (!content) return false;
      if (/^\s*(?:\[Title:|Title:)/i.test(content)) return false;
      return true;
    })
    .slice(0, 6);
  const userMessages = visible.filter((msg: any) => String(msg?.role || '').toLowerCase() === 'user');
  const hasSubstantiveUserText = userMessages.some((msg: any) => {
    const text = String(msg?.content || '').trim();
    return text.length >= 8 && !/^(?:hi|hey|hello|yo|good morning|good afternoon|good evening|what'?s up|sup)[.!?\s]*$/i.test(text);
  });
  const transcript = visible
    .map((msg: any) => {
      const role = String(msg?.role || '').toLowerCase() === 'user' ? 'User' : 'Prometheus';
      const content = String(msg?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      return `${role}: ${content}`;
    })
    .join('\n')
    .slice(0, 2200);
  return { transcript, userCount: userMessages.length, hasSubstantiveUserText };
}

export async function maybeAutoNameChatSession(sessionId: string): Promise<string | null> {
  const session = getSession(sessionId);
  if (!session || session.autoTitleLocked === true) return null;
  const { transcript, userCount, hasSubstantiveUserText } = sessionTitleTranscript(session);
  if (!transcript || !hasSubstantiveUserText || userCount < 1 || userCount > 3) return null;

  const prompt = [
    'Name this Prometheus chat thread based on the context so far.',
    'Return ONLY this exact shape: [Title:Short Helpful Title]',
    'Rules: 3-7 words, specific to the task, no quotes, no markdown, no trailing punctuation, never use "New chat".',
    '',
    'Transcript:',
    transcript,
  ].join('\n');

  let title = '';
  try {
    const generated = await Promise.race([
      getOllamaClient().generate(prompt, 'executor', {
        temperature: 0,
        num_predict: 32,
        think: 'none',
        usageContext: { sessionId },
      } as any),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
    ]);
    title = cleanGeneratedSessionTitle(generated);
  } catch (err: any) {
    console.warn('[chat-title] failed to generate session title:', err?.message || err);
  }

  if (!title) return null;
  const summary = autoNameSession(sessionId, title);
  return summary?.title || null;
}
