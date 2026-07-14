const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const statusText = document.getElementById('status');
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');
const bestEl = document.getElementById('best');

const upBtn = document.getElementById('upBtn');
const downBtn = document.getElementById('downBtn');
const boostBtn = document.getElementById('boostBtn');

const STORAGE_KEY = 'neon-escape-best-v1';
let best = Number(localStorage.getItem(STORAGE_KEY) || 0);
bestEl.textContent = `Best: ${best}`;

const player = {
  x: 120,
  y: 0,
  w: 22,
  h: 22,
  vy: 0,
  lane: 1,
  laneY: [0, 0, 0],
  color: '#7af2ff',
  trail: []
};

const state = {
  running: false,
  paused: false,
  dead: false,
  score: 0,
  speed: 3,
  spawnRate: 1,
  t: 0,
  time: 0,
  nextLaneShift: 0
};

const lanes = 3;
let w = 0;
let h = 0;
let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

const stars = Array.from({ length: 280 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  s: Math.random() * 2 + 0.5,
  o: Math.random() * 0.8 + 0.2,
  tw: Math.random() * 0.08 + 0.02
}));

const obstacles = [];
const pickups = [];

function resize() {
  const rect = canvas.getBoundingClientRect();
  w = Math.floor(rect.width);
  h = Math.floor(rect.height);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  player.laneY = [h * 0.4, h * 0.6, h * 0.8];
  if (!state.running && !state.dead) {
    resetPositions();
  }
}

function resetPositions() {
  player.y = h * 0.6;
  player.lane = 1;
  player.x = 120;
  player.vy = 0;
}

function setStatus(text) {
  statusText.textContent = text;
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#090d23');
  g.addColorStop(0.55, '#050913');
  g.addColorStop(1, '#05060d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  stars.forEach(st => {
    st.y += state.speed * 0.15;
    if (st.y > 100) st.y = 0;
    const x = (st.x * w) / 100;
    const y = (st.y * h) / 100;
    ctx.fillStyle = `rgba(180, 217, 255, ${st.o})`;
    ctx.beginPath();
    ctx.arc(x, y, st.s, 0, Math.PI * 2);
    ctx.fill();
    st.tw += 0.001;
    st.s = Math.max(0.4, st.s + Math.sin(st.tw) * 0.08);
  });

  ctx.fillStyle = '#13214a';
  for (let i = -1; i < 5; i++) {
    ctx.fillRect(i * 120 + (state.t % 120), 0, 1.5, h);
  }
}

function drawLanes() {
  const cw = w / lanes;
  for (let i = 1; i < lanes; i++) {
    const x = Math.floor(i * cw);
    ctx.strokeStyle = 'rgba(80, 150, 220, 0.25)';
    ctx.setLineDash([8, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawPlayer() {
  const y = player.laneY[player.lane];
  player.y += (y - player.y) * 0.2;

  // ship body
  const x = player.x;
  const py = player.y;

  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.moveTo(x, py - player.h * 0.7);
  ctx.lineTo(x - 10, py + player.h * 0.8);
  ctx.lineTo(x + 10, py + player.h * 0.8);
  ctx.closePath();
  ctx.fill();

  // flame
  const power = state.boosting ? 1 : 0;
  if (power) {
    ctx.fillStyle = '#7ef6d8';
    ctx.fillRect(x - 7, py + player.h * 0.65, 14, 14 + state.speed * 2);
  }

  // trail
  player.trail.push({ x: x - 14, y: py, a: 1 });
  if (player.trail.length > 24) player.trail.shift();

  for (let i = 0; i < player.trail.length; i++) {
    const p = player.trail[i];
    p.a *= 0.97;
    ctx.fillStyle = `rgba(121, 237, 255, ${p.a})`;
    ctx.fillRect(p.x + Math.sin(i * 0.4) * 2, p.y, 6, 3);
  }
}

function spawnObstacle() {
  const lane = Math.floor(Math.random() * lanes);
  const gap = h / (lanes + 1);
  obstacles.push({
    x: w + 30,
    y: gap * (lane + 1) - 18,
    w: 38,
    h: 28,
    hue: 0,
    blink: Math.random() * 10 + 5,
    spin: Math.random() * 0.4,
    lane
  });
}

function spawnPickup() {
  const lane = Math.floor(Math.random() * lanes);
  const gap = h / (lanes + 1);
  pickups.push({
    x: w + 20,
    y: gap * (lane + 1) - 6,
    w: 12,
    h: 12,
    wobble: Math.random() * Math.PI * 2,
    lane
  });
}

function drawObstacle(o, idx) {
  o.x -= state.speed + 1.2;
  o.blink -= 0.03;
  o.spin += 0.02;
  o.hue = (o.hue + 1.2) % 360;

  const glow = Math.sin(performance.now() * 0.01 + o.spin) * 0.35 + 0.65;
  ctx.fillStyle = `hsla(${o.hue}, 95%, 55%, ${0.65 * glow})`;
  ctx.fillRect(o.x, o.y, o.w, o.h);

  ctx.strokeStyle = '#9cf3ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(o.x, o.y, o.w, o.h);

  if (o.x + o.w < -40 || o.x < -40) {
    obstacles.splice(idx, 1);
  }
}

function drawPickup(p, idx) {
  p.x -= state.speed + 1;
  p.wobble += 0.12;

  const px = p.x;
  const py = p.y + Math.sin(p.wobble) * 7;
  const b = Math.sin(p.wobble * 2) * 2 + 8;

  ctx.fillStyle = '#7aff8f';
  ctx.beginPath();
  ctx.arc(px + 6, py + 6, b, 0, Math.PI * 2);
  ctx.fill();

  if (p.x + p.w < -40) {
    pickups.splice(idx, 1);
  }
}

function rectCol(a, b) {
  return !(a.x > b.x + b.w || a.x + a.w < b.x || a.y > b.y + b.h || a.y + a.h < b.y);
}

function updateDifficulty() {
  const interval = Math.max(250, 1200 - state.score * 4);
  if (state.t - state.nextLaneShift > interval) {
    state.nextLaneShift = state.t + 120 + Math.random() * 260;
    state.spawnRate = Math.min(2.0, state.spawnRate + 0.02);
    state.speed = Math.min(9, state.speed + 0.1);
    speedEl.textContent = `Speed: ${state.speed.toFixed(1)}x`;
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (!state.running || state.paused || state.dead) {
    drawSky();
    if (!state.dead) {
      drawLanes();
      drawPlayer();
    }
    return;
  }

  state.t++;
  state.time += 1;
  state.score = Math.floor(state.time / 6);
  scoreEl.textContent = `Score: ${state.score}`;

  drawSky();
  drawLanes();

  if (Math.random() < 0.015 * state.spawnRate) spawnObstacle();
  if (Math.random() < 0.008 * (state.spawnRate - 0.1)) spawnPickup();

  for (let i = obstacles.length - 1; i >= 0; i--) {
    drawObstacle(obstacles[i], i);
    if (rectCol({
      x: player.x - 10,
      y: player.y - 10,
      w: 20,
      h: 20
    }, obstacles[i])) {
      gameOver();
      return;
    }
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    drawPickup(pickups[i], i);
    const pickRect = {
      x: pickups[i].x,
      y: pickups[i].y,
      w: 12,
      h: 12
    };
    if (rectCol({ x: player.x - 10, y: player.y - 10, w: 20, h: 20 }, pickRect)) {
      pickups.splice(i, 1);
      state.speed = Math.min(9, state.speed + 0.35);
      setStatus('Speed boost!');
      speedEl.textContent = `Speed: ${state.speed.toFixed(1)}x`;
    }
  }

  drawPlayer();
  updateDifficulty();
}

function gameOver() {
  state.dead = true;
  state.running = false;
  setStatus(`Game over! Final score: ${state.score}`);
  overlay.classList.remove('hidden');
  overlay.querySelector('h1').textContent = 'CRASHED';
  overlay.querySelector('p').textContent = `You lasted ${state.score} seconds. Press Start to try again.`;
  startBtn.textContent = 'Restart';

  if (state.score > best) {
    best = state.score;
    localStorage.setItem(STORAGE_KEY, String(best));
    bestEl.textContent = `Best: ${best}`;
  }
}

function start() {
  if (state.running) return;
  state.running = true;
  state.paused = false;
  state.dead = false;
  state.score = 0;
  state.time = 0;
  state.speed = 3;
  state.spawnRate = 1;
  state.t = 0;
  state.nextLaneShift = 0;
  obstacles.length = 0;
  pickups.length = 0;
  player.trail.length = 0;
  player.lane = 1;
  resetPositions();

  speedEl.textContent = `Speed: ${state.speed.toFixed(1)}x`;
  scoreEl.textContent = `Score: 0`;
  setStatus('Go!');

  overlay.classList.add('hidden');
  overlay.querySelector('h1').textContent = 'NEON ESCAPE';
  overlay.querySelector('p').textContent = 'Dodge the neon mines and collect data nodes to build speed. Survive as long as you can.';
}

function laneUp() {
  if (!state.running) return;
  if (player.lane > 0) player.lane--;
}

function laneDown() {
  if (!state.running) return;
  if (player.lane < 2) player.lane++;
}

function setBoost(active) {
  if (!state.running) return;
  state.boosting = active;
}

const keyMap = {
  ArrowUp: laneUp,
  ArrowDown: laneDown,
  w: laneUp,
  s: laneDown,
  W: laneUp,
  S: laneDown,
  ' ': () => (state.paused = !state.paused)
};

document.addEventListener('keydown', e => {
  const fn = keyMap[e.key];
  if (fn) {
    e.preventDefault();
    fn();
    return;
  }
  if (e.key === 'Shift') {
    setBoost(true);
  }
});

document.addEventListener('keyup', e => {
  if (e.key === 'Shift') {
    setBoost(false);
  }
});

let touchActive = false;

upBtn.addEventListener('click', laneUp);
downBtn.addEventListener('click', laneDown);
boostBtn.addEventListener('pointerdown', () => setBoost(true));
boostBtn.addEventListener('pointerup', () => setBoost(false));
boostBtn.addEventListener('pointerleave', () => setBoost(false));

startBtn.addEventListener('click', start);
canvas.addEventListener('click', e => {
  if (!state.running) {
    start();
  } else {
    const mx = e.clientX / canvas.clientWidth;
    if (mx < 0.5) {
      laneUp();
    } else {
      laneDown();
    }
  }
});

window.addEventListener('resize', resize);

// touch controls fallback swipe
let sx = 0;
let sy = 0;

canvas.addEventListener('touchstart', e => {
  touchActive = true;
  if (!e.touches[0]) return;
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
});

canvas.addEventListener('touchend', e => {
  if (!touchActive) return;
  touchActive = false;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - sx;
  const dy = t.clientY - sy;
  if (Math.abs(dy) > Math.abs(dx)) {
    if (dy < 0) laneUp();
    if (dy > 0) laneDown();
  } else {
    // side taps to boost
    if (Math.abs(dx) > 35) {
      setBoost(true);
      setTimeout(() => setBoost(false), 120);
    }
  }
});

window.addEventListener('blur', () => {
  state.paused = true;
});
window.addEventListener('focus', () => {
  if (state.running) state.paused = false;
});

window.__neonEscapeState = {
  reset: () => {
    start();
  },
  stop: () => {
    state.running = false;
  }
};

resize();
start();
requestAnimationFrame(loop);
