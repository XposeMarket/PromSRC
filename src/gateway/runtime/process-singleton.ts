/**
 * Process-wide module state that survives duplicate module instances.
 *
 * Under tsx source mode, a dynamic `import()` of a module that was already
 * loaded with a static import/require() evaluates a SECOND instance of that
 * module, and later require() calls return the second instance too. Plain
 * module-level `let` state (hook registries, draining flags, listener guards)
 * then silently forks. The gateway's warm handoff aborted for this reason
 * ("listener ownership hooks are not registered"): the stall watchdog loaded a
 * lifecycle copy whose hooks server-v2 never registered.
 *
 * State that must be process-wide lives on globalThis under a registered
 * symbol, so every instance of the module shares one object.
 */
export interface ProcessSingletonInfo {
  /** Number of module instances that requested this singleton (1 = normal). */
  instances: number;
}

const INSTANCE_COUNTS = Symbol.for('prometheus.processSingleton.instances');

export function processSingleton<T extends object>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<symbol, unknown>;
  const symbol = Symbol.for(`prometheus.processSingleton.${key}`);
  if (!store[symbol]) store[symbol] = init();
  return store[symbol] as T;
}

/**
 * Call once at module top level. Returns how many instances of the calling
 * module have been evaluated in this process, so a module can warn when it was
 * loaded twice instead of hiding the duplicate load.
 */
export function registerModuleInstance(key: string): ProcessSingletonInfo {
  const store = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  const counts = store[INSTANCE_COUNTS] ?? (store[INSTANCE_COUNTS] = new Map<string, number>());
  const instances = (counts.get(key) ?? 0) + 1;
  counts.set(key, instances);
  return { instances };
}
