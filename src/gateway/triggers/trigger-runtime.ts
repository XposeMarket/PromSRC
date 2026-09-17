import path from 'path';
import { getResolvedConfigDir } from '../../config/config';
import { TriggerEngine } from './trigger-engine';
import { JsonTriggerStore } from './trigger-store';
import {
  PrometheusTriggerExecutor,
  type PrometheusTriggerExecutorDeps,
} from './prometheus-trigger-executor';
import type { TriggerDispatchSummary, TriggerEvent, TriggerRule } from './trigger-types';

export interface PrometheusTriggerRuntimeOptions {
  storePath?: string;
  now?: () => number;
}

export class PrometheusTriggerRuntime {
  readonly store: JsonTriggerStore;
  readonly executor: PrometheusTriggerExecutor;
  readonly engine: TriggerEngine;

  constructor(deps: PrometheusTriggerExecutorDeps, options: PrometheusTriggerRuntimeOptions = {}) {
    const now = options.now || Date.now;
    const storePath = options.storePath || path.join(getResolvedConfigDir(), 'triggers', 'rules.json');
    this.store = new JsonTriggerStore(storePath, now);
    this.executor = new PrometheusTriggerExecutor(deps);
    this.engine = new TriggerEngine({
      rules: () => this.store.listRules(),
      reservationStore: this.store,
      executor: this.executor,
      now,
    });
  }

  dispatch(event: TriggerEvent): Promise<TriggerDispatchSummary> {
    return this.engine.dispatch(event);
  }

  listRules(): TriggerRule[] {
    return this.store.listRules();
  }

  getRule(id: string): TriggerRule | null {
    return this.store.getRule(id);
  }

  upsertRule(rule: TriggerRule): TriggerRule {
    return this.store.upsertRule(rule);
  }

  deleteRule(id: string): boolean {
    return this.store.deleteRule(id);
  }
}

export function createPrometheusTriggerRuntime(
  deps: PrometheusTriggerExecutorDeps,
  options: PrometheusTriggerRuntimeOptions = {},
): PrometheusTriggerRuntime {
  return new PrometheusTriggerRuntime(deps, options);
}
