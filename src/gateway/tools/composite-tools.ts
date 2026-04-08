import fs from 'fs';
import path from 'path';

export interface CompositeStep {
  tool: string;
  args: Record<string, any>;
}

export interface CompositeDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  steps: CompositeStep[];
}

const COMPOSITES_DIR = path.join(process.cwd(), '.prometheus', 'composites');

function ensureDir() {
  if (!fs.existsSync(COMPOSITES_DIR)) fs.mkdirSync(COMPOSITES_DIR, { recursive: true });
}

export function loadComposites(): Map<string, CompositeDef> {
  const map = new Map<string, CompositeDef>();
  if (!fs.existsSync(COMPOSITES_DIR)) return map;
  for (const file of fs.readdirSync(COMPOSITES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const def: CompositeDef = JSON.parse(fs.readFileSync(path.join(COMPOSITES_DIR, file), 'utf-8'));
      if (def?.name && Array.isArray(def.steps)) map.set(def.name, def);
    } catch { /* skip malformed */ }
  }
  return map;
}

export function saveComposite(def: CompositeDef): void {
  ensureDir();
  fs.writeFileSync(path.join(COMPOSITES_DIR, `${def.name}.json`), JSON.stringify(def, null, 2), 'utf-8');
}

export function deleteComposite(name: string): boolean {
  const file = path.join(COMPOSITES_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function substitute(value: any, params: Record<string, string>): any {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in params ? params[k] : `{{${k}}}`));
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, params));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params)]));
  }
  return value;
}

function collectUnresolvedPlaceholders(value: any): string[] {
  const found = new Set<string>();
  function scan(v: any) {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') Object.values(v).forEach(scan);
  }
  scan(value);
  return [...found];
}

/**
 * When the AI forgot to pass required composite params, use the session history
 * as context to auto-resolve them via a direct LLM call.
 */
async function resolveParamsViaLLM(
  compositeName: string,
  missingParamNames: string[],
  paramDefs: Record<string, { type: string; description: string; required?: boolean }>,
  sessionId: string
): Promise<Record<string, string>> {
  try {
    const { getProvider, getPrimaryModel } = await import('../../providers/factory');
    const { getHistory } = await import('../session');

    const history = getHistory(sessionId, 10);
    const contextSnippet = history
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => {
        const c = m.content;
        const text = typeof c === 'string'
          ? c
          : Array.isArray(c)
            ? (c as any[]).filter((x: any) => x.type === 'text').map((x: any) => x.text).join(' ')
            : JSON.stringify(c);
        return `${String(m.role).toUpperCase()}: ${text.slice(0, 500)}`;
      })
      .join('\n\n');

    const paramList = missingParamNames
      .map(p => `  "${p}": ${paramDefs[p]?.description || p}`)
      .join('\n');

    const prompt =
      `The composite tool "${compositeName}" was invoked but these required parameters were not provided:\n${paramList}\n\n` +
      `Based on the conversation context below, determine what each missing parameter value should be.\n` +
      `Respond with ONLY a valid JSON object. No explanation, no markdown.\n\n` +
      `CONVERSATION CONTEXT:\n${contextSnippet}`;

    const provider = getProvider();
    const model = getPrimaryModel();
    const result = await provider.chat(
      [{ role: 'user', content: prompt }],
      model,
      { max_tokens: 300 }
    );

    const rawContent = result.message?.content;
    const text = typeof rawContent === 'string' ? rawContent
      : Array.isArray(rawContent) ? (rawContent as any[]).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('') : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    // silently fall through — execution will continue with what we have
  }
  return {};
}

export async function executeComposite(
  name: string,
  callArgs: Record<string, any>,
  executeToolFn: (name: string, args: any, ...rest: any[]) => Promise<{ result: string; error: boolean }>,
  ...passthru: any[]
): Promise<string> {
  const composites = loadComposites();
  const def = composites.get(name);
  if (!def) return `Composite "${name}" not found.`;

  // Extract sendSSE/sessionId from passthru (workspacePath, deps, sessionId)
  const sendSSE: ((event: string, data: any) => void) | undefined = passthru[1]?.sendSSE;
  const sessionId: string | undefined = passthru[2];

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(callArgs)) {
    if (v !== undefined && v !== null) params[k] = String(v);
  }

  // Auto-resolve any required params that were not passed by asking the LLM
  const missingRequired = Object.entries(def.parameters || {})
    .filter(([k, v]) => v.required !== false && (params[k] === undefined || params[k].trim() === ''))
    .map(([k]) => k);

  if (missingRequired.length > 0 && sessionId) {
    const resolved = await resolveParamsViaLLM(name, missingRequired, def.parameters || {}, sessionId);
    for (const [k, v] of Object.entries(resolved)) {
      if (v !== undefined && String(v).trim() !== '') params[k] = String(v);
    }
  }

  const results: string[] = [];
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const resolvedArgs = substitute(step.args, params);

    // If any placeholder is still unresolved after substitution + LLM resolution,
    // try one more targeted LLM call for just those params before giving up.
    const stillUnresolved = collectUnresolvedPlaceholders(resolvedArgs);
    if (stillUnresolved.length > 0 && sessionId) {
      const extraResolved = await resolveParamsViaLLM(name, stillUnresolved, def.parameters || {}, sessionId);
      for (const [k, v] of Object.entries(extraResolved)) {
        if (v !== undefined && String(v).trim() !== '') params[k] = String(v);
      }
      // Re-substitute with the newly resolved values
      Object.assign(resolvedArgs, substitute(step.args, params));
    }

    sendSSE?.('tool_call', {
      action: step.tool,
      args: resolvedArgs,
      composite: name,
      stepNum: i + 1,
      totalSteps: def.steps.length,
      synthetic: true,
    });

    const res = await executeToolFn(step.tool, resolvedArgs, ...passthru);

    sendSSE?.('tool_result', {
      action: step.tool,
      result: res.result,
      error: res.error,
      composite: name,
      stepNum: i + 1,
      totalSteps: def.steps.length,
    });

    results.push(`[Step ${i + 1}/${def.steps.length}: ${step.tool}]\n${res.result}`);
    if (res.error) {
      results.push(`(Composite stopped at step ${i + 1} due to error)`);
      break;
    }
  }
  return results.join('\n\n');
}

/** Scan all step args for {{placeholder}} names. */
function extractPlaceholdersFromSteps(steps: CompositeStep[]): string[] {
  const found = new Set<string>();
  for (const step of steps) {
    for (const name of collectUnresolvedPlaceholders(step.args)) found.add(name);
  }
  return [...found];
}

export function getCompositeDefs(): any[] {
  const composites = loadComposites();
  return Array.from(composites.values()).map(def => {
    const explicitParams: Record<string, any> = def.parameters || {};

    // Auto-derive any {{placeholder}} used in steps but not declared in parameters.
    // This ensures the tool schema always has required fields for every placeholder,
    // so the AI is forced to supply values at call time.
    const inferredParams: Record<string, any> = {};
    for (const placeholder of extractPlaceholdersFromSteps(def.steps)) {
      if (!explicitParams[placeholder]) {
        inferredParams[placeholder] = { type: 'string', description: `Value to substitute for {{${placeholder}}}` };
      }
    }

    const allParams = { ...inferredParams, ...explicitParams };
    const required = Object.entries(allParams)
      .filter(([, v]) => (v as any).required !== false)
      .map(([k]) => k);

    return {
      type: 'function',
      function: {
        name: def.name,
        description: `[Composite] ${def.description}`,
        parameters: {
          type: 'object',
          required,
          properties: Object.fromEntries(
            Object.entries(allParams).map(([k, v]) => [k, { type: (v as any).type || 'string', description: (v as any).description }])
          ),
        },
      },
    };
  });
}

export function getCompositeManagementTools(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'create_composite',
        description:
          'Create or overwrite a dynamic composite tool — a saved sequence of tool calls invocable as a single tool. ' +
          'IMPORTANT: Before calling this, you MUST first run each step manually (browser_open, browser_click, browser_type, etc.) ' +
          'to verify the exact selectors, refs, and flow actually work end-to-end. ' +
          'Only call create_composite once the live run succeeded — use the verified args and refs as the step definitions. ' +
          'Use {{param_name}} in step args to interpolate call-time arguments.',
        parameters: {
          type: 'object',
          required: ['name', 'description', 'steps'],
          properties: {
            name: { type: 'string', description: 'Tool name (no spaces, snake_case). This becomes the callable tool name.' },
            description: { type: 'string', description: 'What this composite does — shown to the LLM as tool description.' },
            parameters: {
              type: 'object',
              description: 'Map of parameter names to {type, description} objects. Use {{param_name}} in step args to reference them.',
            },
            steps: {
              type: 'array',
              description: 'Ordered list of {tool, args} objects to execute in sequence.',
              items: {
                type: 'object',
                required: ['tool', 'args'],
                properties: {
                  tool: { type: 'string', description: 'Tool name to call' },
                  args: { type: 'object', description: 'Args to pass. Use {{param_name}} for dynamic values.' },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_composite',
        description: 'Read the full definition of a composite tool (name, description, parameters, steps). Use this before editing to see what currently exists.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the composite to inspect.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_composite',
        description: 'Update an existing composite tool — replace its description, parameters, or steps. Call get_composite first to see the current definition.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the composite to edit.' },
            new_name: { type: 'string', description: 'Rename the composite to this name (optional).' },
            description: { type: 'string', description: 'New description (optional — replaces current).' },
            parameters: {
              type: 'object',
              description: 'New parameters map (optional — replaces entire parameters block). Each key maps to {type, description, required?}.',
            },
            steps: {
              type: 'array',
              description: 'New steps array (optional — replaces entire steps block).',
              items: {
                type: 'object',
                required: ['tool', 'args'],
                properties: {
                  tool: { type: 'string', description: 'Tool name to call.' },
                  args: { type: 'object', description: 'Args to pass. Use {{param_name}} for dynamic values.' },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_composite',
        description: 'Remove a saved composite tool by name.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the composite to delete.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_composites',
        description: 'List all saved composite tools with their descriptions and step counts.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    },
  ];
}
