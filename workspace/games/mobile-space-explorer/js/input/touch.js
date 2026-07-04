export function bindTouchInput(state) {
  const moveZone = document.getElementById('moveStick');
  const moveKnob = document.getElementById('moveKnob');
  const lookPad = document.getElementById('lookPad');
  const touchLayer = document.getElementById('touchLayer');

  const move = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { active: false, id: null, lx: 0, ly: 0 };

  function stickFromPointer(e, rect) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = rect.width * 0.38;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    moveKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    move.x = dx / max;
    move.y = -dy / max;
  }

  moveZone.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    move.active = true;
    move.id = e.pointerId;
    moveZone.setPointerCapture(e.pointerId);
    stickFromPointer(e, moveZone.getBoundingClientRect());
  });
  moveZone.addEventListener('pointermove', (e) => {
    if (!move.active || e.pointerId !== move.id) return;
    stickFromPointer(e, moveZone.getBoundingClientRect());
  });
  const endMove = (e) => {
    if (e.pointerId !== move.id) return;
    move.active = false;
    move.id = null;
    move.x = 0;
    move.y = 0;
    moveKnob.style.transform = 'translate(-50%, -50%)';
  };
  moveZone.addEventListener('pointerup', endMove);
  moveZone.addEventListener('pointercancel', endMove);

  lookPad.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.action-btn')) return;
    look.active = true;
    look.id = e.pointerId;
    look.lx = e.clientX;
    look.ly = e.clientY;
  });
  lookPad.addEventListener('pointermove', (e) => {
    if (!look.active || e.pointerId !== look.id) return;
    const dx = e.clientX - look.lx;
    const dy = e.clientY - look.ly;
    look.lx = e.clientX;
    look.ly = e.clientY;
    state.lookDelta.dx += dx;
    state.lookDelta.dy += dy;
  });
  const endLook = (e) => {
    if (e.pointerId !== look.id) return;
    look.active = false;
    look.id = null;
  };
  lookPad.addEventListener('pointerup', endLook);
  lookPad.addEventListener('pointercancel', endLook);

  const bindBtn = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.buttons[key] = true;
      if (key === 'fire') state.firePulse = true;
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.buttons[key] = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  };
  bindBtn('btnJump', 'jump');
  bindBtn('btnBoost', 'boost');
  bindBtn('btnFire', 'fire');
  bindBtn('btnTalk', 'talk');

  touchLayer.classList.add('active');

  return {
    getMove() {
      return { x: move.x, y: move.y };
    },
    consumeLook() {
      const d = { ...state.lookDelta };
      state.lookDelta.dx = 0;
      state.lookDelta.dy = 0;
      return d;
    },
    buttons: state.buttons,
  };
}

export function createInputState() {
  return {
    lookDelta: { dx: 0, dy: 0 },
    buttons: { jump: false, boost: false, fire: false, talk: false },
    firePulse: false,
    keys: {},
    chatOpen: false,
    talkLatch: false,
    talkWasDown: false,
  };
}