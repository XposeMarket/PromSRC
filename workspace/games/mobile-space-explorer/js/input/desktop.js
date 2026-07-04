export function bindDesktopInput(state) {
  window.addEventListener('keydown', (e) => {
    state.keys[e.code] = true;
    if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyE'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    state.keys[e.code] = false;
  });

  let mouseLook = false;
  const canvas = document.getElementById('game');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    mouseLook = true;
    state.mouse.lx = e.clientX;
    state.mouse.ly = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    mouseLook = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!mouseLook) return;
    state.lookDelta.dx += e.clientX - state.mouse.lx;
    state.lookDelta.dy += e.clientY - state.mouse.ly;
    state.mouse.lx = e.clientX;
    state.mouse.ly = e.clientY;
  });

  return {
    getMove() {
      let x = 0;
      let y = 0;
      if (state.keys.KeyD || state.keys.ArrowRight) x += 1;
      if (state.keys.KeyA || state.keys.ArrowLeft) x -= 1;
      if (state.keys.KeyW || state.keys.ArrowUp) y += 1;
      if (state.keys.KeyS || state.keys.ArrowDown) y -= 1;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      return { x, y };
    },
    consumeLook() {
      const d = { ...state.lookDelta };
      state.lookDelta.dx = 0;
      state.lookDelta.dy = 0;
      return d;
    },
    buttons: {
      get jump() {
        return !!state.keys.Space;
      },
      get boost() {
        return !!(state.keys.ShiftLeft || state.keys.ShiftRight);
      },
      get fire() {
        return !!state.keys.mouseFire;
      },
      get talk() {
        return !!state.keys.KeyE;
      },
    },
  };
}

export function extendDesktopState(state) {
  state.keys = state.keys || {};
  state.mouse = { lx: 0, ly: 0 };
  state.keys.mouseFire = false;
  const canvas = document.getElementById('game');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) state.keys.mouseFire = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0) state.keys.mouseFire = false;
  });
}