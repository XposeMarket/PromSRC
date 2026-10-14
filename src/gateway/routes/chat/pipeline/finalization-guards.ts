

export const isReadOnlyDevPlanStep = (step: string): boolean => {
    const text = String(step || '').toLowerCase();
    return /\b(read|inspect|grep|search|list|locate|review|understand|check|confirm|compare|audit)\b/.test(text)
      && !/\b(edit|patch|replace|write|insert|delete|update|fix|apply|sync|build|verify|test|restart|reload)\b/.test(text);
  };

export const planStepNeedsWriteEvidence = (stepText: string, note: string): boolean => {
    const text = `${stepText || ''} ${note || ''}`.toLowerCase();
    if (!text.trim()) return false;
    if (/\b(read|inspect|grep|search|list|locate|review|understand|check|confirm|audit)\b/.test(text)
      && !/\b(write|create|implement|build|edit|patch|replace|insert|delete|update|fix|add|scaffold|generate)\b/.test(text)) {
      return false;
    }
    return /\b(write|create|implement|build|edit|patch|replace|insert|delete|update|fix|add|scaffold|generate|complete)\b/.test(text)
      && /\b(file|html|index|app|game|page|component|code|script|style|feature|control|button|ui|tool|deliverable)\b/.test(text);
  };

