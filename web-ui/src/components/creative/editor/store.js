/**
 * Tiny reactive store — replaces Zustand for vanilla JS contexts.
 * Usage:
 *   const store = createStore({ time: 0, selection: [] });
 *   const unsub = store.derive(s => s.time, t => console.log('time =', t));
 *   store.setState({ time: 100 });
 *   unsub();
 */
export function createStore(initialState) {
  let state = Object.assign({}, initialState);
  const subs = new Set();

  const store = {
    getState() { return state; },

    setState(patch) {
      const result = typeof patch === 'function' ? patch(state) : patch;
      const next = Object.assign({}, state, result);
      state = next;
      for (const fn of subs) fn(state);
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    select(selector) {
      return selector(state);
    },

    // Fires onChange only when the selected slice changes (reference equality).
    derive(selector, onChange) {
      let prev = selector(state);
      return store.subscribe(s => {
        const next = selector(s);
        if (next !== prev) { prev = next; onChange(next, prev); }
      });
    },

    // Subscribe to multiple selectors — fires when any changes.
    deriveMulti(selectors, onChange) {
      let prevs = selectors.map(sel => sel(state));
      return store.subscribe(s => {
        const nexts = selectors.map(sel => sel(s));
        if (nexts.some((v, i) => v !== prevs[i])) {
          prevs = nexts;
          onChange(nexts, s);
        }
      });
    },
  };

  return store;
}

/** Build the canonical editor store state shape. */
export function createEditorState() {
  return {
    // Playback
    timeMs: 0,
    playing: false,
    durationMs: 0,

    // Selection
    selectedIds: /** @type {string[]} */ ([]),

    // Viewport
    zoom: 1.0,
    panX: 0,
    panY: 0,

    // Timeline
    timelineZoom: 1.0,   // px-per-ms scale multiplier
    timelineScrollX: 0,
    timelineScrollY: 0,

    // UI state
    activePanel: 'assets',  // 'assets' | 'properties'
    tool: 'select',          // 'select' | 'text' | 'shape' | ...

    // Media library (populated by assets panel)
    mediaAssets: /** @type {any[]} */ ([]),

    // History cursor (for undo/redo integration)
    historyIndex: 0,
  };
}
