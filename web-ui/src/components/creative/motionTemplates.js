function getSessionId(deps = {}) {
  return String(deps.getSessionId?.() || window.currentSessionId || 'default').trim() || 'default';
}

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || fallbackMessage || `Creative motion request failed with HTTP ${response.status}`);
  }
  return data;
}

export function createCreativeMotionTemplateClient(deps = {}) {
  async function listCreativeMotionTemplates() {
    const params = new URLSearchParams({ sessionId: getSessionId(deps) });
    const response = await fetch(`/api/canvas/creative-motion-templates?${params.toString()}`);
    return parseJsonResponse(response, 'Could not load Creative Motion templates.');
  }

  async function previewCreativeMotionTemplate(payload = {}) {
    const response = await fetch('/api/canvas/creative-motion-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sessionId: getSessionId(deps),
        root: deps.getCreativeStorageRoot?.() || undefined,
      }),
    });
    return parseJsonResponse(response, 'Could not create Creative Motion preview.');
  }

  async function prepareCreativeMotionTemplate(payload = {}) {
    const response = await fetch('/api/canvas/creative-motion-apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sessionId: getSessionId(deps),
      }),
    });
    return parseJsonResponse(response, 'Could not prepare Creative Motion template.');
  }

  async function generateCreativeMotionVariants(payload = {}) {
    const response = await fetch('/api/canvas/creative-motion-variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sessionId: getSessionId(deps),
      }),
    });
    return parseJsonResponse(response, 'Could not generate Creative Motion variants.');
  }

  return {
    listCreativeMotionTemplates,
    previewCreativeMotionTemplate,
    prepareCreativeMotionTemplate,
    generateCreativeMotionVariants,
  };
}
