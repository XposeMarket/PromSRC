function clean(value) {
  return String(value ?? '').trim();
}

export function createDesktopQuestionTransport(options = {}) {
  const {
    request,
    getActiveSessionId = () => '',
    switchSession = () => {},
    syncActiveChat = () => {},
    sendResume = () => {},
    createClientRequestId = () => '',
    schedule = (callback, delay) => setTimeout(callback, delay),
    warn = () => {},
  } = options;
  if (typeof request !== 'function') throw new TypeError('Desktop question transport requires request().');

  async function fetchQuestion(id) {
    const questionId = clean(id);
    if (!questionId) return null;
    try {
      const data = await request('/api/questions?status=all');
      return (Array.isArray(data?.questions) ? data.questions : [])
        .find((item) => clean(item?.id || item?.questionId || item?.question_id) === questionId) || null;
    } catch (error) {
      try { warn(error); } catch {}
      return null;
    }
  }

  function submit(id, payload) {
    return request(`/api/questions/${encodeURIComponent(clean(id))}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  function cancel(id) {
    return request(`/api/questions/${encodeURIComponent(clean(id))}/cancel`, {
      method: 'POST',
      body: '{}',
    });
  }

  async function resume(result, fallbackSessionId = '') {
    const resumePrompt = clean(result?.resumePrompt);
    if (!resumePrompt) return false;
    const targetSessionId = clean(
      result?.question?.sessionId
      || result?.question?.sourceSessionId
      || fallbackSessionId
      || getActiveSessionId(),
    );
    if (targetSessionId && targetSessionId !== clean(getActiveSessionId())) {
      switchSession(targetSessionId);
      syncActiveChat();
    }
    schedule(() => sendResume(resumePrompt, {
      clientRequestId: createClientRequestId(targetSessionId || getActiveSessionId()),
    }), 100);
    return true;
  }

  return Object.freeze({ fetchQuestion, submit, cancel, resume });
}
