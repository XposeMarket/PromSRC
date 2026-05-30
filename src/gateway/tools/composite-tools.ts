import fs from 'fs';
import path from 'path';

type ParamDef = { type: string; description: string; required?: boolean };
type ExecuteToolFn = (name: string, args: any, ...rest: any[]) => Promise<{ result: string; error: boolean; [key: string]: any }>;

export interface CompositeCondition {
  param?: string;
  state?: string;
  var?: string;
  exists?: boolean;
  equals?: any;
  notEquals?: any;
  contains?: any;
}

export interface CompositeAssertion {
  result_contains?: string;
  result_not_contains?: string;
  state_exists?: string;
  path_exists?: string;
  equals?: { left: any; right: any };
}

export interface CompositeStep {
  id?: string;
  tool: string;
  args: Record<string, any>;
  required?: boolean;
  continueOnError?: boolean;
  retry?: number | { attempts?: number; delayMs?: number };
  timeoutMs?: number;
  saveAs?: string;
  when?: CompositeCondition;
  fallback?: CompositeStep[];
  assert?: CompositeAssertion | CompositeAssertion[];
}

export interface CompositeDef {
  name: string;
  description: string;
  parameters: Record<string, ParamDef>;
  steps: CompositeStep[];
}

export interface CompositeExecutionResult {
  result: string;
  error: boolean;
  steps: Record<string, any>;
}

const TOOL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_COMPOSITE_DEPTH = 5;
const ACTIVE_COMPOSITE_STACKS = new Map<string, string[]>();

// Use PROMETHEUS_DATA_DIR when set (packaged Electron) so composites land in user data dir.
const COMPOSITES_DIR = path.join(
  process.env.PROMETHEUS_DATA_DIR ? path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus') : path.join(process.cwd(), '.prometheus'),
  'composites'
);

function ensureDir() {
  if (!fs.existsSync(COMPOSITES_DIR)) fs.mkdirSync(COMPOSITES_DIR, { recursive: true });
}

function normalizeCompositeName(raw: any): string {
  return String(raw || '').trim().replace(/\s+/g, '_');
}

function validateCompositeName(name: string): string | null {
  if (!name) return 'name is required';
  if (!TOOL_NAME_RE.test(name)) {
    return 'name must match /^[A-Za-z_][A-Za-z0-9_]{0,63}$/';
  }
  return null;
}

function validateStep(step: any, index: number): string | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return `step ${index + 1} must be an object`;
  if (!step.tool || typeof step.tool !== 'string') return `step ${index + 1} tool is required`;
  if (!TOOL_NAME_RE.test(step.tool)) return `step ${index + 1} tool name is invalid`;
  if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) return `step ${index + 1} args object is required`;
  if (step.fallback !== undefined) {
    if (!Array.isArray(step.fallback)) return `step ${index + 1} fallback must be an array`;
    for (let i = 0; i < step.fallback.length; i++) {
      const err = validateStep(step.fallback[i], i);
      if (err) return `step ${index + 1} fallback ${err}`;
    }
  }
  return null;
}

function validateCompositeDef(def: CompositeDef): string | null {
  const nameError = validateCompositeName(def.name);
  if (nameError) return nameError;
  if (!Array.isArray(def.steps) || !def.steps.length) return 'steps array is required';
  for (let i = 0; i < def.steps.length; i++) {
    const stepError = validateStep(def.steps[i], i);
    if (stepError) return stepError;
  }
  return null;
}

export function loadComposites(): Map<string, CompositeDef> {
  const map = new Map<string, CompositeDef>();
  if (!fs.existsSync(COMPOSITES_DIR)) return map;
  for (const file of fs.readdirSync(COMPOSITES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const def: CompositeDef = JSON.parse(fs.readFileSync(path.join(COMPOSITES_DIR, file), 'utf-8'));
      if (def?.name && Array.isArray(def.steps) && !validateCompositeName(def.name)) map.set(def.name, def);
    } catch { /* skip malformed */ }
  }
  return map;
}

export function saveComposite(def: CompositeDef): void {
  const validationError = validateCompositeDef(def);
  if (validationError) throw new Error(validationError);
  ensureDir();
  fs.writeFileSync(path.join(COMPOSITES_DIR, `${def.name}.json`), JSON.stringify(def, null, 2), 'utf-8');
}

export function deleteComposite(name: string): boolean {
  if (validateCompositeName(name)) return false;
  const file = path.join(COMPOSITES_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function getPathValue(root: any, dottedPath: string): any {
  if (!dottedPath) return undefined;
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
}

function makeTemplateContext(params: Record<string, string>, state: Record<string, any>): Record<string, any> {
  return { ...params, params, steps: state.steps, last: state.last };
}

function substitute(value: any, params: Record<string, string>, state: Record<string, any>): any {
  const context = makeTemplateContext(params, state);
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([\w.]+)\}\}$/);
    if (whole) {
      const direct = Object.prototype.hasOwnProperty.call(params, whole[1]) ? params[whole[1]] : undefined;
      const resolved = direct !== undefined ? direct : getPathValue(context, whole[1]);
      return resolved !== undefined ? resolved : value;
    }
    return value.replace(/\{\{([\w.]+)\}\}/g, (_, k) => {
      const direct = Object.prototype.hasOwnProperty.call(params, k) ? params[k] : undefined;
      const resolved = direct !== undefined ? direct : getPathValue(context, k);
      return resolved !== undefined ? String(resolved) : `{{${k}}}`;
    });
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, params, state));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params, state)]));
  }
  return value;
}

function collectUnresolvedPlaceholders(value: any): string[] {
  const found = new Set<string>();
  function scan(v: any) {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\{\{([\w.]+)\}\}/g)) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') Object.values(v).forEach(scan);
  }
  scan(value);
  return [...found];
}

function collectUnresolvedParamPlaceholders(value: any): string[] {
  return collectUnresolvedPlaceholders(value).filter(name => !name.includes('.'));
}

/**
 * When the AI forgot to pass required composite params, use the session history
 * as context to auto-resolve them via a direct LLM call.
 */
async function resolveParamsViaLLM(
  compositeName: string,
  missingParamNames: string[],
  paramDefs: Record<string, ParamDef>,
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
  } catch {
    // silently fall through — execution will continue with what we have
  }
  return {};
}

function getRetryConfig(step: CompositeStep): { attempts: number; delayMs: number } {
  if (typeof step.retry === 'number') return { attempts: Math.max(1, Math.floor(step.retry)), delayMs: 0 };
  if (step.retry && typeof step.retry === 'object') {
    return {
      attempts: Math.max(1, Math.floor(Number(step.retry.attempts || 1))),
      delayMs: Math.max(0, Math.floor(Number(step.retry.delayMs || 0))),
    };
  }
  return { attempts: 1, delayMs: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  const ms = Math.max(0, Math.floor(Number(timeoutMs || 0)));
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

function evalCondition(condition: CompositeCondition | undefined, params: Record<string, string>, state: Record<string, any>): boolean {
  if (!condition) return true;
  const context = makeTemplateContext(params, state);
  const pathName = condition.param ? condition.param : condition.state || condition.var || '';
  const value = condition.param ? params[condition.param] : getPathValue(context, pathName);
  if (condition.exists !== undefined) {
    const exists = value !== undefined && value !== null && value !== '';
    if (exists !== condition.exists) return false;
  }
  if (condition.equals !== undefined && value !== substitute(condition.equals, params, state)) return false;
  if (condition.notEquals !== undefined && value === substitute(condition.notEquals, params, state)) return false;
  if (condition.contains !== undefined && !String(value ?? '').includes(String(substitute(condition.contains, params, state)))) return false;
  return true;
}

function normalizeAssertions(assertion: CompositeStep['assert']): CompositeAssertion[] {
  if (!assertion) return [];
  return Array.isArray(assertion) ? assertion : [assertion];
}

function runAssertions(step: CompositeStep, res: { result: string; error: boolean }, params: Record<string, string>, state: Record<string, any>): string | null {
  for (const assertion of normalizeAssertions(step.assert)) {
    if (assertion.result_contains !== undefined) {
      const needle = String(substitute(assertion.result_contains, params, state));
      if (!String(res.result || '').includes(needle)) return `assertion failed: result did not contain "${needle}"`;
    }
    if (assertion.result_not_contains !== undefined) {
      const needle = String(substitute(assertion.result_not_contains, params, state));
      if (String(res.result || '').includes(needle)) return `assertion failed: result contained "${needle}"`;
    }
    if (assertion.state_exists !== undefined) {
      const statePath = String(substitute(assertion.state_exists, params, state));
      if (getPathValue(makeTemplateContext(params, state), statePath) === undefined) return `assertion failed: state path "${statePath}" was missing`;
    }
    if (assertion.path_exists !== undefined) {
      const filePath = String(substitute(assertion.path_exists, params, state));
      if (!fs.existsSync(filePath)) return `assertion failed: path does not exist: ${filePath}`;
    }
    if (assertion.equals !== undefined) {
      const left = substitute(assertion.equals.left, params, state);
      const right = substitute(assertion.equals.right, params, state);
      if (left !== right) return `assertion failed: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
    }
  }
  return null;
}

function bindStepOutput(step: CompositeStep, stepKey: string, res: any, state: Record<string, any>): void {
  const parsed = (() => {
    if (typeof res.result !== 'string') return undefined;
    const trimmed = res.result.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
    try { return JSON.parse(trimmed); } catch { return undefined; }
  })();
  const record = { ...res, parsed };
  state.steps[stepKey] = record;
  if (step.saveAs) state.steps[step.saveAs] = record;
  state.last = record;
}

async function executeStepList(
  compositeName: string,
  steps: CompositeStep[],
  params: Record<string, string>,
  state: Record<string, any>,
  executeToolFn: ExecuteToolFn,
  passthru: any[],
  depth: number,
  sendSSE?: (event: string, data: any) => void,
  parentLabel = ''
): Promise<{ lines: string[]; error: boolean }> {
  if (depth > MAX_COMPOSITE_DEPTH) {
    return { lines: [`Composite recursion limit exceeded (${MAX_COMPOSITE_DEPTH}).`], error: true };
  }

  const lines: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepLabel = parentLabel ? `${parentLabel}.${i + 1}` : `${i + 1}`;
    if (!evalCondition(step.when, params, state)) {
      lines.push(`[Step ${stepLabel}/${steps.length}: ${step.tool}] skipped by condition`);
      continue;
    }

    let resolvedArgs = substitute(step.args, params, state);
    const stillUnresolved = collectUnresolvedParamPlaceholders(resolvedArgs);
    const sessionId: string | undefined = passthru[2];
    if (stillUnresolved.length > 0 && sessionId) {
      const extraResolved = await resolveParamsViaLLM(compositeName, stillUnresolved, {}, sessionId);
      for (const [k, v] of Object.entries(extraResolved)) {
        if (v !== undefined && String(v).trim() !== '') params[k] = String(v);
      }
      resolvedArgs = substitute(step.args, params, state);
    }

    const unresolved = collectUnresolvedPlaceholders(resolvedArgs);
    if (unresolved.length > 0) {
      const result = `Unresolved placeholder(s): ${unresolved.join(', ')}`;
      lines.push(`[Step ${stepLabel}/${steps.length}: ${step.tool}]\n${result}`);
      if (step.required === false || step.continueOnError) continue;
      return { lines, error: true };
    }

    const retry = getRetryConfig(step);
    let res: any = { result: 'step did not run', error: true };
    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
      sendSSE?.('tool_call', {
        action: step.tool,
        args: resolvedArgs,
        composite: compositeName,
        stepNum: i + 1,
        totalSteps: steps.length,
        attempt,
        synthetic: true,
      });

      try {
        res = await withTimeout(executeToolFn(step.tool, resolvedArgs, ...passthru), step.timeoutMs);
      } catch (err: any) {
        res = { result: err?.message || String(err), error: true };
      }

      const assertionError = !res.error ? runAssertions(step, res, params, state) : null;
      if (assertionError) res = { ...res, result: `${res.result}\n${assertionError}`, error: true };

      sendSSE?.('tool_result', {
        action: step.tool,
        result: res.result,
        error: res.error,
        composite: compositeName,
        stepNum: i + 1,
        totalSteps: steps.length,
        attempt,
      });

      if (!res.error || attempt === retry.attempts) break;
      if (retry.delayMs > 0) await sleep(retry.delayMs);
    }

    bindStepOutput(step, step.id || `step${stepLabel.replace(/\./g, '_')}`, res, state);
    lines.push(`[Step ${stepLabel}/${steps.length}: ${step.tool}]\n${res.result}`);

    if (res.error && Array.isArray(step.fallback) && step.fallback.length > 0) {
      lines.push(`(Running fallback for step ${stepLabel})`);
      const fallbackResult = await executeStepList(compositeName, step.fallback, params, state, executeToolFn, passthru, depth + 1, sendSSE, `${stepLabel}f`);
      lines.push(...fallbackResult.lines);
      if (!fallbackResult.error) continue;
    }

    if (res.error) {
      if (step.required === false || step.continueOnError) {
        lines.push(`(Composite continued after optional/continueOnError step ${stepLabel})`);
        continue;
      }
      lines.push(`(Composite stopped at step ${stepLabel} due to error)`);
      return { lines, error: true };
    }
  }
  return { lines, error: false };
}

export async function executeCompositeDetailed(
  name: string,
  callArgs: Record<string, any>,
  executeToolFn: ExecuteToolFn,
  ...passthru: any[]
): Promise<CompositeExecutionResult> {
  const composites = loadComposites();
  const def = composites.get(name);
  if (!def) return { result: `Composite "${name}" not found.`, error: true, steps: {} };

  const sessionId: string | undefined = passthru[2];
  const stackKey = sessionId || 'default';
  const stack = ACTIVE_COMPOSITE_STACKS.get(stackKey) || [];
  if (stack.includes(name)) return { result: `Composite recursion detected: ${[...stack, name].join(' -> ')}`, error: true, steps: {} };

  const sendSSE: ((event: string, data: any) => void) | undefined = passthru[1]?.sendSSE;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(callArgs || {})) {
    if (v !== undefined && v !== null) params[k] = String(v);
  }

  const missingRequired = Object.entries(def.parameters || {})
    .filter(([k, v]) => v.required !== false && (params[k] === undefined || params[k].trim() === ''))
    .map(([k]) => k);

  if (missingRequired.length > 0 && sessionId) {
    const resolved = await resolveParamsViaLLM(name, missingRequired, def.parameters || {}, sessionId);
    for (const [k, v] of Object.entries(resolved)) {
      if (v !== undefined && String(v).trim() !== '') params[k] = String(v);
    }
  }

  const stillMissing = Object.entries(def.parameters || {})
    .filter(([k, v]) => v.required !== false && (params[k] === undefined || params[k].trim() === ''))
    .map(([k]) => k);
  if (stillMissing.length > 0) {
    return { result: `Missing required parameter(s): ${stillMissing.join(', ')}`, error: true, steps: {} };
  }

  const state: Record<string, any> = { steps: {}, last: null };
  ACTIVE_COMPOSITE_STACKS.set(stackKey, [...stack, name]);
  try {
    const run = await executeStepList(name, def.steps, params, state, executeToolFn, passthru, 0, sendSSE);
    return { result: run.lines.join('\n\n'), error: run.error, steps: state.steps };
  } finally {
    if (stack.length > 0) ACTIVE_COMPOSITE_STACKS.set(stackKey, stack);
    else ACTIVE_COMPOSITE_STACKS.delete(stackKey);
  }
}

export async function executeComposite(
  name: string,
  callArgs: Record<string, any>,
  executeToolFn: ExecuteToolFn,
  ...passthru: any[]
): Promise<string> {
  return (await executeCompositeDetailed(name, callArgs, executeToolFn, ...passthru)).result;
}

/** Scan all step args for {{placeholder}} names. */
function extractPlaceholdersFromSteps(steps: CompositeStep[]): string[] {
  const found = new Set<string>();
  const scanSteps = (items: CompositeStep[]) => {
    for (const step of items) {
      for (const name of collectUnresolvedParamPlaceholders(step.args)) found.add(name);
      if (Array.isArray(step.fallback)) scanSteps(step.fallback);
    }
  };
  scanSteps(steps);
  return [...found];
}

export function getCompositeDefs(): any[] {
  const composites = loadComposites();
  return Array.from(composites.values()).map(def => {
    const explicitParams: Record<string, any> = def.parameters || {};
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

export async function handleCompositeTool(
  name: string,
  args: any,
  executeToolFn: ExecuteToolFn,
  ...passthru: any[]
): Promise<{ name: string; args: any; result: string; error: boolean } | null> {
  try {
    if (name === 'create_composite') {
      const cName = normalizeCompositeName(args.name);
      const nameError = validateCompositeName(cName);
      if (nameError) return { name, args, result: nameError, error: true };
      const def: CompositeDef = {
        name: cName,
        description: String(args.description || ''),
        parameters: args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters) ? args.parameters : {},
        steps: args.steps,
      };
      saveComposite(def);
      return { name, args, result: `Composite "${cName}" saved with ${args.steps.length} step(s). It will appear as a callable tool next message.`, error: false };
    }

    if (name === 'get_composite') {
      const cName = normalizeCompositeName(args.name);
      const nameError = validateCompositeName(cName);
      if (nameError) return { name, args, result: nameError, error: true };
      const existing = loadComposites().get(cName);
      if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
      return { name, args, result: JSON.stringify(existing, null, 2), error: false };
    }

    if (name === 'edit_composite') {
      const cName = normalizeCompositeName(args.name);
      const nameError = validateCompositeName(cName);
      if (nameError) return { name, args, result: nameError, error: true };
      const composites = loadComposites();
      const existing = composites.get(cName);
      if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
      const newName = args.new_name ? normalizeCompositeName(args.new_name) : cName;
      const newNameError = validateCompositeName(newName);
      if (newNameError) return { name, args, result: newNameError, error: true };
      const updated: CompositeDef = {
        name: newName,
        description: args.description !== undefined ? String(args.description) : existing.description,
        parameters: args.parameters !== undefined ? args.parameters : existing.parameters,
        steps: Array.isArray(args.steps) ? args.steps : existing.steps,
      };
      saveComposite(updated);
      if (newName !== cName) deleteComposite(cName);
      const renamed = newName !== cName ? ` (renamed from "${cName}")` : '';
      return { name, args, result: `Composite "${newName}" updated${renamed}.`, error: false };
    }

    if (name === 'delete_composite') {
      const cName = normalizeCompositeName(args.name);
      const nameError = validateCompositeName(cName);
      if (nameError) return { name, args, result: nameError, error: true };
      const removed = deleteComposite(cName);
      return { name, args, result: removed ? `Composite "${cName}" deleted.` : `Composite "${cName}" not found.`, error: !removed };
    }

    if (name === 'list_composites') {
      const composites = loadComposites();
      if (!composites.size) return { name, args, result: 'No composites defined yet.', error: false };
      const lines = Array.from(composites.values()).map(
        c => `- ${c.name} (${c.steps.length} steps) - ${c.description}`
      );
      return { name, args, result: lines.join('\n'), error: false };
    }

    if (loadComposites().has(name)) {
      const compositeResult = await executeCompositeDetailed(name, args, executeToolFn, ...passthru);
      return { name, args, result: compositeResult.result, error: compositeResult.error };
    }
  } catch (err: any) {
    return { name, args, result: `Composite error: ${err?.message || String(err)}`, error: true };
  }

  return null;
}

export function getCompositeManagementTools(): any[] {
  const stepProperties: Record<string, any> = {
    id: { type: 'string', description: 'Optional stable step id for output references, e.g. {{steps.step_id.result}}.' },
    tool: { type: 'string', description: 'Tool name to call.' },
    args: { type: 'object', description: 'Args to pass. Use {{param_name}} or {{steps.step_id.result}} for dynamic values.' },
    required: { type: 'boolean', description: 'When false, a failed step is diagnostic/optional and the composite continues.' },
    continueOnError: { type: 'boolean', description: 'Continue even if this step fails.' },
    retry: { description: 'Retry configuration. Number means total attempts; object may include {attempts, delayMs}.' },
    timeoutMs: { type: 'number', description: 'Per-attempt timeout in milliseconds.' },
    saveAs: { type: 'string', description: 'Bind this step result under steps.<saveAs> for later templates/assertions.' },
    when: { type: 'object', description: 'Optional condition using param/state/var plus exists, equals, notEquals, or contains.' },
    fallback: { type: 'array', description: 'Fallback steps to run if this step fails.', items: { type: 'object' } },
    assert: { description: 'Validation checkpoint(s), e.g. {result_contains}, {state_exists}, {path_exists}, or {equals:{left,right}}.' },
  };

  return [
    {
      type: 'function',
      function: {
        name: 'create_composite',
        description:
          'Create or overwrite a dynamic composite tool — a saved sequence of tool calls invocable as a single tool. ' +
          'IMPORTANT: Before calling this, first run risky/fragile steps manually to verify selectors, refs, and flow. ' +
          'Use {{param_name}} in step args for call-time arguments. Advanced steps support retry, timeoutMs, required:false, continueOnError, fallback, saveAs, when, and assert.',
        parameters: {
          type: 'object',
          required: ['name', 'description', 'steps'],
          properties: {
            name: { type: 'string', description: 'Tool name matching /^[A-Za-z_][A-Za-z0-9_]{0,63}$/. This becomes the callable tool name.' },
            description: { type: 'string', description: 'What this composite does — shown to the LLM as tool description.' },
            parameters: {
              type: 'object',
              description: 'Map of parameter names to {type, description, required?}. Use {{param_name}} in step args.',
            },
            steps: {
              type: 'array',
              description: 'Ordered list of composite step objects.',
              items: {
                type: 'object',
                required: ['tool', 'args'],
                properties: stepProperties,
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
        description: 'Read the full definition of a composite tool. Use this before editing.',
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
        description: 'Update an existing composite tool — replace its description, parameters, or steps. Call get_composite first.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Name of the composite to edit.' },
            new_name: { type: 'string', description: 'Rename the composite to this valid tool name (optional).' },
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
                properties: stepProperties,
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
