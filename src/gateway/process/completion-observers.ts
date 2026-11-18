type Observer<T> = { complete(value: T): void; fail(error: unknown): void };
/** One promise reaction per observed run, not one retained reaction per timed-out wait. */
export class CompletionObservers<T> {
  private entries = new WeakMap<object, {
    observers: Set<Observer<T>>;
    outcome?: { ok: true; value: T } | { ok: false; error: unknown };
  }>();

  subscribe(key: object, completion: () => Promise<T>, complete: (value: T) => void, fail: (error: unknown) => void): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { observers: new Set() };
      this.entries.set(key, entry);
      const owned = entry;
      // Run completion includes workspace finalization. Never infer it from process state.
      void Promise.resolve().then(completion).then((value) => {
        owned.outcome = { ok: true, value };
        for (const observer of owned.observers) { try { observer.complete(value); } catch {} }
        owned.observers.clear();
      }, (error) => {
        owned.outcome = { ok: false, error };
        for (const observer of owned.observers) { try { observer.fail(error); } catch {} }
        owned.observers.clear();
      });
    }
    const observer = { complete, fail };
    if (entry.outcome) {
      if (entry.outcome.ok) complete(entry.outcome.value);
      else fail(entry.outcome.error);
    } else entry.observers.add(observer);
    const subscribedEntry = entry;
    return () => { subscribedEntry.observers.delete(observer); };
  }
}
