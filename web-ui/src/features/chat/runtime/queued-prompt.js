function cleanIdList(value) {
  return Array.isArray(value)
    ? value.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
}

export function createQueuedPromptTools({
  normalizeSkillIds = cleanIdList,
  normalizeSkillRefs,
  createId,
  now = () => Date.now(),
} = {}) {
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { message: String(value || '').trim(), files: [], excludedSkillIds: [], selectedSkillIds: [] };
    }
    const prompt = {
      message: String(value.message || value.text || '').trim(),
      files: Array.isArray(value.files) ? value.files : [],
      excludedSkillIds: cleanIdList(value.excludedSkillIds),
      selectedSkillIds: normalizeSkillIds(value.selectedSkillIds || value.forcedSkillIds || value.matchedSkillIds),
    };
    if (typeof normalizeSkillRefs === 'function') {
      prompt.selectedSkillRefs = normalizeSkillRefs(value.selectedSkillRefs || value.selectedSkills);
    }
    return prompt;
  }

  function create(message, files = [], options = {}) {
    const prompt = normalize({ ...options, message, files: Array.isArray(files) ? files.slice() : [] });
    if (typeof createId === 'function') prompt.id = createId();
    if (typeof createId === 'function') prompt.createdAt = now();
    return prompt;
  }

  return Object.freeze({
    normalize,
    create,
    message: (value) => normalize(value).message,
    files: (value) => normalize(value).files,
  });
}
