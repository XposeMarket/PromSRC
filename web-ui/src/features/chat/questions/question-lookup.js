// Unlike best-effort history hydration, reconciliation must distinguish a
// successful empty list from an unavailable gateway or malformed response.
export async function lookupQuestion(request, id) {
  const data = await request('/api/questions?status=all', { cache: 'no-store' });
  if (!Array.isArray(data?.questions)) throw new Error('Question list unavailable');
  return data.questions.find(q => String(q?.id || q?.questionId || q?.question_id || '').trim() === id) || null;
}
