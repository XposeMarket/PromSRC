import * as THREE from 'three';
import { GALAXY, SHIP, BIOME_SIZE } from './config.js';
import { buildGalaxyScene, updateGalaxyAmbient } from './scenes/galaxy.js';
import { buildBiomeScene } from './scenes/biome.js';
import { createShip, createShipState, setBoostVisual } from './entities/ship.js';
import { createProjectileSystem } from './systems/projectiles.js';
import { spawnBiomeNpcs, updateNpcs, findNearestFriendlyNpc } from './entities/npcs.js';
import { preloadHumanoidGltf } from './entities/humanoid.js';
import { createOrbitCamera } from './systems/camera.js';
import { bindTouchInput, createInputState } from './input/touch.js';
import { bindDesktopInput, extendDesktopState } from './input/desktop.js';
import { updateMothership } from './entities/mothership.js';
import { buildMothershipInterior } from './scenes/mothershipInterior.js';
import { unlockAudio, setBurnerActive, playBlaster, playBoardChime } from './systems/audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 5000);
const clock = new THREE.Clock();

let mode = 'galaxy';
let transitioning = false;
let activePlanet = null;

const ship = createShip();
const shipState = createShipState();
ship.position.set(0, 0, 120);

const galaxyData = buildGalaxyScene();
let activeScene = galaxyData.scene;
activeScene.add(ship);
const galaxyProjectiles = createProjectileSystem(galaxyData.scene);
let biomeProjectiles = null;

let biomeScene = null;
let biomeNpcs = [];
let interiorScene = null;
let interiorData = null;
let interiorProjectiles = null;
let mothershipWorldPos = new THREE.Vector3();

const inputState = createInputState();
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
let input;
if (isCoarsePointer) {
  input = bindTouchInput(inputState);
} else {
  extendDesktopState(inputState);
  input = bindDesktopInput(inputState);
}

const orbitCam = createOrbitCamera(camera, ship);
const fadeEl = document.getElementById('fade');
const hullBar = document.getElementById('hullBar');
const boostBar = document.getElementById('boostBar');
const damageFlash = document.getElementById('damageFlash');
const modeLabel = document.getElementById('modeLabel');
const planetHint = document.getElementById('planetHint');
const chatPanel = document.getElementById('chatPanel');
const chatLines = document.getElementById('chatLines');
const chatBackdrop = document.getElementById('chatBackdrop');
function openChat(html) {
  chatLines.innerHTML = html;
  chatPanel.classList.remove('hidden');
  chatBackdrop?.classList.remove('hidden');
  inputState.chatOpen = true;
  inputState.talkLatch = true;
  inputState.buttons.talk = false;
  document.body.classList.add('chat-open');
}
function closeChat() {
  chatPanel.classList.add('hidden');
  chatBackdrop?.classList.add('hidden');
  inputState.chatOpen = false;
  inputState.talkLatch = true;
  inputState.buttons.talk = false;
  document.body.classList.remove('chat-open');
}
function talkJustPressed(buttons) {
  if (inputState.chatOpen || inputState.talkLatch) {
    if (!buttons.talk) inputState.talkLatch = false;
    return false;
  }
  const edge = buttons.talk && !inputState.talkWasDown;
  inputState.talkWasDown = !!buttons.talk;
  return edge;
}
document.getElementById('chatClose')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeChat();
});
document.getElementById('chatClose')?.addEventListener('touchend', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeChat();
});
chatBackdrop?.addEventListener('click', closeChat);
chatBackdrop?.addEventListener('touchend', (e) => {
  e.preventDefault();
  closeChat();
});

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function setHud() {
  hullBar.style.width = `${(shipState.hull / SHIP.maxHull) * 100}%`;
  boostBar.style.width = `${(shipState.boost / SHIP.maxBoost) * 100}%`;
  if (mode === 'galaxy') {
    modeLabel.textContent = 'GALAXY';
    const ms = galaxyData.mothership;
    if (ms) {
      ms.getWorldPosition(mothershipWorldPos);
      const nearMs = ship.position.distanceTo(mothershipWorldPos) < ms.userData.boardRadius + 8;
      planetHint.textContent = nearMs ? 'TALK or JUMP to board mothership' : 'Fly into a planet · find the drifting mothership';
    } else {
      planetHint.textContent = 'Fly into a planet to land';
    }
  } else if (mode === 'interior') {
    modeLabel.textContent = 'MOTHERSHIP';
    planetHint.textContent = 'FPS · walk to green airlock to exit';
  } else if (activePlanet) {
    modeLabel.textContent = activePlanet.name.toUpperCase();
    planetHint.textContent = `${activePlanet.biome} biome · FPS · walk to edge to leave`;
  }
}

function flashDamage() {
  damageFlash.classList.remove('hidden');
  damageFlash.classList.add('hit');
  setTimeout(() => damageFlash.classList.remove('hit'), 120);
}

function applyDamage(amount) {
  shipState.hull = Math.max(0, shipState.hull - amount);
  flashDamage();
  setHud();
}

function runFade(ms, onMid) {
  return new Promise((resolve) => {
    fadeEl.classList.remove('hidden');
    fadeEl.classList.add('show');
    requestAnimationFrame(() => fadeEl.classList.add('active'));
    setTimeout(() => {
      onMid?.();
      setTimeout(() => {
        fadeEl.classList.remove('active');
        setTimeout(() => {
          fadeEl.classList.add('hidden');
          fadeEl.classList.remove('show');
          resolve();
        }, 400);
      }, 350);
    }, ms);
  });
}

async function enterPlanet(planetMesh) {
  if (transitioning) return;
  transitioning = true;
  const planet = planetMesh.userData.planet;
  activePlanet = planet;

  await runFade(700, () => {
    if (biomeScene) {
      biomeScene.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
    biomeScene = buildBiomeScene(planet);
    biomeNpcs = spawnBiomeNpcs(biomeScene, planet);
    biomeProjectiles = createProjectileSystem(biomeScene);
    activeScene = biomeScene;
    activeScene.add(ship);
    ship.visible = false;
    ship.position.set(0, 2, 0);
    shipState.velocity.set(0, 0, 0);
    shipState.onGround = true;
    shipState.pitch = 0;
    shipState.yaw = 0;
    mode = 'biome';
    orbitCam.resetFps(0);
    setHud();
  });

  transitioning = false;
}

async function enterMothership() {
  if (transitioning || mode !== 'galaxy') return;
  transitioning = true;
  galaxyData.mothership.getWorldPosition(mothershipWorldPos);

  await runFade(650, () => {
    if (!interiorScene) {
      interiorData = buildMothershipInterior();
      interiorScene = interiorData.scene;
      interiorProjectiles = createProjectileSystem(interiorScene);
    }
    activeScene = interiorScene;
    if (!ship.parent) activeScene.add(ship);
    ship.visible = false;
    ship.position.set(0, 2, 12);
    shipState.velocity.set(0, 0, 0);
    shipState.onGround = true;
    shipState.pitch = 0;
    shipState.yaw = 0;
    mode = 'interior';
    activePlanet = null;
    orbitCam.resetFps(0);
    playBoardChime();
    setHud();
  });

  transitioning = false;
}

async function leaveMothership() {
  if (transitioning || mode !== 'interior') return;
  transitioning = true;

  await runFade(650, () => {
    activeScene = galaxyData.scene;
    if (!ship.parent) activeScene.add(ship);
    ship.visible = true;
    ship.position.copy(mothershipWorldPos).add(new THREE.Vector3(42, 5, 0));
    shipState.velocity.set(0, 0, 0);
    mode = 'galaxy';
    orbitCam.resetBehind(shipState.yaw);
    setHud();
  });

  transitioning = false;
}

async function leavePlanet() {
  if (transitioning || mode !== 'biome') return;
  transitioning = true;
  const p = activePlanet;

  await runFade(700, () => {
    activeScene = galaxyData.scene;
    if (!ship.parent) activeScene.add(ship);
    ship.visible = true;
    const pos = p ? new THREE.Vector3(...p.position) : new THREE.Vector3(0, 0, 0);
    ship.position.copy(pos).add(new THREE.Vector3(p?.radius * 1.8 || 40, 10, 0));
    shipState.velocity.set(0, 0, 0);
    mode = 'galaxy';
    activePlanet = null;
    biomeNpcs = [];
    orbitCam.resetBehind(shipState.yaw);
    setHud();
  });

  transitioning = false;
}

function tryPlanetLanding() {
  if (mode !== 'galaxy' || transitioning) return;
  for (const pm of galaxyData.planets) {
    const dist = ship.position.distanceTo(pm.position);
    const trigger = pm.userData.planet.radius * GALAXY.planetTriggerDist;
    if (dist < trigger) {
      enterPlanet(pm);
      break;
    }
  }
}

function updateShipGalaxy(dt, move, buttons) {
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  if (camForward.lengthSq() < 0.01) camForward.set(0, 0, -1);
  camForward.normalize();
  const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
  const camUp = new THREE.Vector3().crossVectors(camRight, camForward).normalize();

  const wish = new THREE.Vector3()
    .addScaledVector(camForward, move.y)
    .addScaledVector(camRight, move.x);
  if (wish.lengthSq() > 0.01) {
    wish.normalize();
    shipState.yaw = Math.atan2(wish.x, wish.z);
  }
  ship.rotation.order = 'YXZ';
  ship.rotation.y = shipState.yaw;
  ship.rotation.x = shipState.pitch;

  let speed = SHIP.galaxySpeed;
  const boosting = buttons.boost && shipState.boost > 2;
  if (boosting) {
    speed *= SHIP.boostMult;
    shipState.boost = Math.max(0, shipState.boost - SHIP.boostDrain * dt);
  } else {
    shipState.boost = Math.min(SHIP.maxBoost, shipState.boost + SHIP.boostRegen * dt);
  }
  setBoostVisual(ship, boosting, dt);
  setBurnerActive(boosting || shipState.velocity.lengthSq() > 120, dt);

  if (wish.lengthSq() > 0.01) {
    shipState.velocity.lerp(wish.clone().multiplyScalar(speed), 1 - Math.pow(0.02, dt));
  } else {
    shipState.velocity.multiplyScalar(Math.pow(0.15, dt));
  }

  if (buttons.jump) {
    shipState.velocity.addScaledVector(camUp, 52 * dt);
  }
  shipState.velocity.y *= Math.pow(0.995, dt);
  ship.position.addScaledVector(shipState.velocity, dt);

  const bound = GALAXY.bounds * 0.95;
  ship.position.x = THREE.MathUtils.clamp(ship.position.x, -bound, bound);
  ship.position.z = THREE.MathUtils.clamp(ship.position.z, -bound, bound);
  ship.position.y = THREE.MathUtils.clamp(ship.position.y, -120, 280);

  shipState.fireCooldown = Math.max(0, shipState.fireCooldown - dt);
  if (buttons.fire && shipState.fireCooldown <= 0) {
    shipState.fireCooldown = 0.14;
    const muzzle = ship.position.clone().add(new THREE.Vector3(0, 0, 1.6).applyQuaternion(ship.quaternion));
    const dir = camForward.clone();
    galaxyProjectiles.spawn(muzzle, dir, 130);
    playBlaster();
  }

  const ms = galaxyData.mothership;
  if (ms) {
    ms.getWorldPosition(mothershipWorldPos);
    const distMs = ship.position.distanceTo(mothershipWorldPos);
    if (distMs < ms.userData.boardRadius + 6 && (buttons.jump || talkJustPressed(buttons))) {
      enterMothership();
    }
  }

  for (const ast of galaxyData.asteroids) {
    const d = ship.position.distanceTo(ast.position);
    const hit = d < (ast.userData.radius || 4) + ship.userData.collisionRadius * 0.5;
    if (hit) {
      applyDamage(SHIP.asteroidDamage);
      const push = ship.position.clone().sub(ast.position).normalize().multiplyScalar(80);
      shipState.velocity.add(push);
      ast.position.add(push.clone().multiplyScalar(-0.02));
    }
  }

  galaxyProjectiles.update(dt, (bullet) => {
    for (let i = galaxyData.asteroids.length - 1; i >= 0; i--) {
      const ast = galaxyData.asteroids[i];
      if (bullet.position.distanceTo(ast.position) < (ast.userData.radius || 4) + 0.5) {
        galaxyData.scene.remove(ast);
        galaxyData.asteroids.splice(i, 1);
        galaxyData.scene.remove(bullet);
        const idx = galaxyProjectiles.bullets.indexOf(bullet);
        if (idx >= 0) galaxyProjectiles.bullets.splice(idx, 1);
        break;
      }
    }
  });

  tryPlanetLanding();
}

function updateShipBiome(dt, move, buttons) {
  const yaw = shipState.yaw;
  const pitch = shipState.pitch;
  const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  forward.y = 0;
  if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const wish = new THREE.Vector3()
    .addScaledVector(forward, move.y)
    .addScaledVector(right, move.x);
  const groundY = 2;
  const speed = buttons.boost && shipState.boost > 2 ? 34 : 18;
  boostingDrain(buttons, dt);

  if (wish.lengthSq() > 0.01) {
    wish.normalize();
    ship.position.x += wish.x * speed * dt;
    ship.position.z += wish.z * speed * dt;
  }

  ship.position.y = groundY;
  if (buttons.jump) ship.position.y = groundY + Math.sin(clock.elapsedTime * 8) * 0.4 + 0.6;

  const edge = BIOME_SIZE * 0.92;
  if (Math.hypot(ship.position.x, ship.position.z) > edge) leavePlanet();

  updateNpcs(biomeNpcs, ship.position, dt, (dmg) => applyDamage(dmg), (origin, aim) => {
    if (biomeProjectiles) biomeProjectiles.spawn(origin, aim, 55, 'enemy');
  });

  if (talkJustPressed(buttons)) {
    const friend = findNearestFriendlyNpc(biomeNpcs, ship.position);
    if (friend) {
      const line = friend.lines[Math.floor(Math.random() * friend.lines.length)];
      openChat(`<strong>${friend.name}</strong>: ${line}`);
    }
  }

  shipState.fireCooldown = Math.max(0, shipState.fireCooldown - dt);
  if (buttons.fire && biomeProjectiles && shipState.fireCooldown <= 0) {
    shipState.fireCooldown = 0.12;
    const eye = ship.position.clone().add(new THREE.Vector3(0, 1.65, 0).applyEuler(euler));
    const aim = new THREE.Vector3(0, 0, -1).applyEuler(euler).normalize();
    biomeProjectiles.spawn(eye, aim, 95);
    playBlaster();
  }

  if (biomeProjectiles) {
    biomeProjectiles.update(dt, null, ship.position, (dmg) => applyDamage(dmg));
    for (const b of [...biomeProjectiles.bullets]) {
      for (let j = biomeNpcs.length - 1; j >= 0; j--) {
        const n = biomeNpcs[j];
        const d = n.userData.npc;
        if (!d?.hostile) continue;
        if (b.position.distanceTo(n.position) < 2.2) {
          d.hp -= 22;
          biomeScene.remove(b);
          const bi = biomeProjectiles.bullets.indexOf(b);
          if (bi >= 0) biomeProjectiles.bullets.splice(bi, 1);
          if (d.hp <= 0) {
            biomeScene.remove(n);
            biomeNpcs.splice(j, 1);
          }
          break;
        }
      }
    }
  }
}

function updateShipInterior(dt, move, buttons) {
  const yaw = shipState.yaw;
  const pitch = shipState.pitch;
  const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  forward.y = 0;
  if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const wish = new THREE.Vector3()
    .addScaledVector(forward, move.y)
    .addScaledVector(right, move.x);
  const speed = 14;
  if (wish.lengthSq() > 0.01) {
    wish.normalize();
    ship.position.x += wish.x * speed * dt;
    ship.position.z += wish.z * speed * dt;
  }
  ship.position.y = 2;

  const edge = interiorData?.size ?? 36;
  if (ship.position.x > edge - 2) leaveMothership();

  if (talkJustPressed(buttons)) {
    const crew = interiorData?.crewNpc;
    if (crew && ship.position.distanceTo(crew.position) < 10) {
      const c = crew.userData.crew;
      const line = c.lines[Math.floor(Math.random() * c.lines.length)];
      openChat(`<strong>${c.name}</strong>: ${line}`);
    } else if (ship.position.distanceTo(new THREE.Vector3(0, 1.5, -20)) < 8) {
      openChat('<strong>Command AI</strong>: Sector map synced. Hangar bay has a spare fighter. Airlock east exits to vacuum.');
    } else {
      openChat('<strong>Ship PA</strong>: Walk to the officer mid-deck or main console aft for comms.');
    }
  }
}

function boostingDrain(buttons, dt) {
  if (buttons.boost && shipState.boost > 2) {
    shipState.boost = Math.max(0, shipState.boost - SHIP.boostDrain * dt);
    return true;
  }
  shipState.boost = Math.min(SHIP.maxBoost, shipState.boost + SHIP.boostRegen * dt);
  return false;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!document.getElementById('startOverlay').classList.contains('hidden')) {
    renderer.render(activeScene, camera);
    requestAnimationFrame(tick);
    return;
  }

  const move = input.getMove();
  const look = input.consumeLook();
  const buttons = input.buttons;

  orbitCam.update(mode, ship, look, dt, shipState);

  if (mode === 'galaxy') {
    updateGalaxyAmbient(galaxyData.scene, clock.elapsedTime);
    if (galaxyData.mothership) updateMothership(galaxyData.mothership, dt);
    updateShipGalaxy(dt, move, buttons);
  } else if (mode === 'interior') {
    updateShipInterior(dt, move, buttons);
  } else {
    updateShipBiome(dt, move, buttons);
  }

  setHud();
  renderer.render(activeScene, camera);
  requestAnimationFrame(tick);
}

function startGame() {
  const overlay = document.getElementById('startOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  unlockAudio();
  preloadHumanoidGltf();
  overlay.classList.add('hidden');
  canvas.focus();
  clock.start();
  setHud();
  tick();
}
const btnStart = document.getElementById('btnStart');
if (btnStart) {
  btnStart.addEventListener('click', (e) => {
    e.preventDefault();
    startGame();
  });
  btnStart.addEventListener('touchend', (e) => {
    e.preventDefault();
    startGame();
  });
}

if (typeof window !== 'undefined') {
  window.__galaxyDrift = {
    warpToPlanet(id) {
      const pm = galaxyData.planets.find((p) => p.userData.planet.id === id);
      if (pm) {
        const p = pm.userData.planet;
        ship.position.copy(pm.position).add(new THREE.Vector3(p.radius * 0.55, 0, 0));
        enterPlanet(pm);
      }
    },
    leaveGalaxyToSpace() {
      leavePlanet();
    },
    testAsteroidBump() {
      if (mode !== 'galaxy' || !galaxyData.asteroids[0]) return { ok: false };
      const before = shipState.hull;
      ship.position.copy(galaxyData.asteroids[0].position);
      updateShipGalaxy(0.016, { x: 0, y: 0 }, {});
      setHud();
      return { ok: true, before, after: shipState.hull };
    },
    get mode() {
      return mode;
    },
  };
}

renderer.render(activeScene, camera);