import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThinkingOrb } from 'thinking-orbs';

const TRANSITION_MS = 180;
const DEFAULT_STATE = 'thinking';

const STATE_ALIASES = {
  // The published orb calls its Thinking animation "breathing" (and exposes
  // that name in its aria label), so keep the app-facing state intuitive.
  thinking: 'breathing',
  listening: 'listening',
  solving: 'solving',
};

const STATE_LABELS = {
  breathing: 'Thinking…',
  listening: 'Listening…',
  solving: 'Solving…',
};

function normalizeState(state) {
  const requested = String(state || DEFAULT_STATE).trim().toLowerCase();
  return STATE_ALIASES[requested] || STATE_ALIASES[DEFAULT_STATE];
}

function OrbTransition({ state, size = 64, theme = 'auto', speed = 1 }) {
  const nextState = normalizeState(state);
  const nextId = useRef(1);
  const [layers, setLayers] = useState(() => [{ id: 0, state: nextState }]);

  useEffect(() => {
    setLayers((current) => {
      const previous = current[current.length - 1];
      if (previous?.state === nextState) return current;
      return [
        previous || { id: nextId.current++, state: nextState },
        { id: nextId.current++, state: nextState },
      ];
    });

    const timer = window.setTimeout(() => {
      setLayers((current) => current.slice(-1));
    }, TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [nextState]);

  const activeIndex = layers.length - 1;
  return (
    <span
      className="pm-thinking-orb-transition"
      data-state={nextState}
      aria-label={STATE_LABELS[nextState] || STATE_LABELS.breathing}
      style={{ '--pm-thinking-orb-size': `${size}px` }}
    >
      {layers.map((layer, index) => (
        <ThinkingOrb
          key={layer.id}
          state={layer.state}
          size={size}
          theme={theme}
          speed={speed}
          aria-label={STATE_LABELS[layer.state] || STATE_LABELS.breathing}
          className={`pm-thinking-orb-layer ${index === activeIndex ? 'is-current' : 'is-leaving'}`}
        />
      ))}
    </span>
  );
}

export function mountThinkingOrb(container, options = {}) {
  if (!container) return null;

  let state = String(options.state || DEFAULT_STATE).trim().toLowerCase() || DEFAULT_STATE;
  const size = options.size === 20 ? 20 : 64;
  const theme = options.theme || 'auto';
  const speed = Number(options.speed) > 0 ? Number(options.speed) : 1;
  const root = createRoot(container);

  const render = () => {
    root.render(<OrbTransition state={state} size={size} theme={theme} speed={speed} />);
  };
  render();

  return {
    setState(nextState) {
      const requested = String(nextState || DEFAULT_STATE).trim().toLowerCase() || DEFAULT_STATE;
      if (requested === state) return;
      state = requested;
      render();
    },
    setAudioLevel(level) {
      const value = Math.max(0, Math.min(1, Number(level) || 0));
      container.style.setProperty('--pm-thinking-orb-audio', value.toFixed(3));
    },
    destroy() {
      root.unmount();
      container.replaceChildren();
      container.style.removeProperty('--pm-thinking-orb-audio');
    },
  };
}
