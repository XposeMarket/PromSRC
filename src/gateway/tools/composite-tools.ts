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

export async function executeComposite(
  name: string,
  callArgs: Record<string, any>,
  executeToolFn: (name: string, args: any, ...rest: any[]) => Promise<{ result: string; error: boolean }>,
  ...passthru: any[]
): Promise<string> {
  const composites = loadComposites();
  const def = composites.get(name);
  if (!def) return `Composite "${name}" not found.`;

  // Extract sendSSE from deps (passthru[1] = deps, passthru[2] = sessionId)
  const sendSSE: ((event: string, data: any) => void) | undefined = passthru[1]?.sendSSE;

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(callArgs)) params[k] = String(v);

  const results: string[] = [];
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const resolvedArgs = substitute(step.args, params);

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

export function getCompositeDefs(): any[] {
  const composites = loadComposites();
  return Array.from(composites.values()).map(def => ({
    type: 'function',
    function: {
      name: def.name,
      description: `[Composite] ${def.description}`,
      parameters: {
        type: 'object',
        required: Object.entries(def.parameters)
          .filter(([, v]) => v.required !== false)
          .map(([k]) => k),
        properties: Object.fromEntries(
          Object.entries(def.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
        ),
      },
    },
  }));
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
        name: 'edit_composite',
        description: 'Update an existing composite tool — replace its description, parameters, or steps.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the composite to edit.' },
            description: { type: 'string', description: 'New description (optional).' },
            parameters: { type: 'object', description: 'New parameters map (optional — replaces entire parameters block).' },
            steps: { type: 'array', description: 'New steps array (optional — replaces entire steps block).' },
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
