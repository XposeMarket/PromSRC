import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

const canvas = document.querySelector('#scene');
const beatName = document.querySelector('#beat-name');
const progress = document.querySelector('#progress');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050914');
scene.fog = new THREE.FogExp2('#071222', 0.025);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 160);
camera.position.set(16, 8, 20);

const palette = {
  night: new THREE.Color('#071222'),
  cyan: new THREE.Color('#6de4ff'),
  warm: new THREE.Color('#ffb86b'),
  stone: new THREE.Color('#1a2b3d'),
};

// The timeline is intentionally data-driven: each timed beat is a camera keyframe.
// Seconds are relative to a looping 18-second transmission.
const CINEMATIC_BEATS = [
  { time: 0, name: 'Distant approach', position: [16, 8, 20], target: [0, 2.4, 0], exposure: 0.88 },
  { time: 4.5, name: 'The beacon wakes', position: [8, 4.8, 12], target: [0, 3.5, 0], exposure: 1.16 },
  { time: 9.5, name: 'Orbit of the signal', position: [-8, 5.5, 7], target: [0, 2.8, 0], exposure: 1.08 },
  { time: 14, name: 'Last pulse', position: [-3, 3.7, 15], target: [0, 3.2, 0], exposure: 1.2 },
  { time: 18, name: 'Distant approach', position: [16, 8, 20], target: [0, 2.4, 0], exposure: 0.88 },
];
const TIMELINE_DURATION = CINEMATIC_BEATS.at(-1).time;

const ambient = new THREE.HemisphereLight('#456b91', '#02040b', 1.2);
scene.add(ambient);

const moon = new THREE.DirectionalLight('#a9d7ff', 3.2);
moon.position.set(-12, 18, 8);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -30;
moon.shadow.camera.right = 30;
moon.shadow.camera.top = 30;
moon.shadow.camera.bottom = -30;
scene.add(moon);

const beaconLight = new THREE.PointLight(palette.cyan, 0, 18, 1.8);
beaconLight.position.set(0, 5.2, 0);
beaconLight.castShadow = true;
scene.add(beaconLight);

const warmWindow = new THREE.PointLight(palette.warm, 3.2, 9, 2);
warmWindow.position.set(0, 2.5, 1.1);
scene.add(warmWindow);

const world = new THREE.Group();
scene.add(world);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(38, 96),
  new THREE.MeshStandardMaterial({ color: '#091422', roughness: 0.94, metalness: 0.08 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
world.add(ground);

const horizon = new THREE.Mesh(
  new THREE.RingGeometry(18, 38, 96),
  new THREE.MeshBasicMaterial({ color: '#0b2840', transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
);
horizon.rotation.x = -Math.PI / 2;
horizon.position.y = 0.015;
world.add(horizon);

function addRock(position, scale, color = palette.stone) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  rock.position.set(...position);
  rock.scale.set(scale[0], scale[1], scale[2]);
  rock.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.3);
  rock.castShadow = true;
  rock.receiveShadow = true;
  world.add(rock);
  return rock;
}

[
  [[-6, 0.7, -4], [3.2, 0.8, 2.2]], [[7, 0.45, -5], [2.1, 0.5, 1.4]],
  [[-10, 0.35, 4], [1.8, 0.4, 1.1]], [[10, 0.55, 5], [3.8, 0.55, 2.4]],
  [[-5, 0.25, 8], [1.5, 0.3, 1]], [[5, 0.32, 9], [2, 0.32, 1.3]],
].forEach(([position, scale]) => addRock(position, scale));

const observatory = new THREE.Group();
observatory.position.y = 0.1;
world.add(observatory);

const base = new THREE.Mesh(
  new THREE.CylinderGeometry(3.6, 4.2, 1.15, 10),
  new THREE.MeshStandardMaterial({ color: '#17283a', roughness: 0.76, metalness: 0.22 }),
);
base.position.y = 0.58;
base.castShadow = true;
base.receiveShadow = true;
observatory.add(base);

const dome = new THREE.Mesh(
  new THREE.SphereGeometry(3.35, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#253a4b', roughness: 0.62, metalness: 0.35 }),
);
dome.position.y = 1.12;
dome.castShadow = true;
observatory.add(dome);

const domeBand = new THREE.Mesh(
  new THREE.TorusGeometry(3.34, 0.09, 8, 64),
  new THREE.MeshStandardMaterial({ color: '#466176', metalness: 0.7, roughness: 0.4 }),
);
domeBand.rotation.x = Math.PI / 2;
domeBand.position.y = 1.16;
observatory.add(domeBand);

const slit = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 2.8, 0.3),
  new THREE.MeshBasicMaterial({ color: '#6fe8ff', transparent: true, opacity: 0.78 }),
);
slit.position.set(0, 2.38, 3.03);
observatory.add(slit);

const beacon = new THREE.Group();
beacon.position.y = 4.8;
observatory.add(beacon);
const beaconCore = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.82, 2),
  new THREE.MeshStandardMaterial({ color: '#b8f4ff', emissive: '#2cdcff', emissiveIntensity: 3.5, roughness: 0.14, metalness: 0.3 }),
);
beaconCore.castShadow = true;
beacon.add(beaconCore);

const beaconRings = [];
for (let index = 0; index < 3; index += 1) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.15 + index * 0.32, 0.025, 8, 64),
    new THREE.MeshBasicMaterial({ color: '#77eaff', transparent: true, opacity: 0.32 - index * 0.06 }),
  );
  ring.rotation.set(index * 0.75, index * 0.42, index * 0.55);
  beacon.add(ring);
  beaconRings.push(ring);
}

const antenna = new THREE.Mesh(
  new THREE.CylinderGeometry(0.045, 0.09, 5.5, 8),
  new THREE.MeshStandardMaterial({ color: '#7691a2', metalness: 0.8, roughness: 0.3 }),
);
antenna.position.y = 3;
antenna.rotation.z = -0.17;
antenna.castShadow = true;
observatory.add(antenna);

const antennaTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 16, 8),
  new THREE.MeshBasicMaterial({ color: '#fff0bc' }),
);
antennaTip.position.set(0.47, 5.68, 0);
observatory.add(antennaTip);

const signalBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 1.8, 22, 32, 1, true),
  new THREE.MeshBasicMaterial({ color: '#4adfff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
);
signalBeam.position.y = 11;
signalBeam.rotation.z = Math.PI / 2;
signalBeam.rotation.y = -0.2;
observatory.add(signalBeam);

const stars = new THREE.BufferGeometry();
const starPositions = new Float32Array(720 * 3);
for (let i = 0; i < 720; i += 1) {
  const radius = 28 + Math.random() * 62;
  const theta = Math.random() * Math.PI * 2;
  const height = 7 + Math.random() * 45;
  starPositions[i * 3] = Math.cos(theta) * radius;
  starPositions[i * 3 + 1] = height;
  starPositions[i * 3 + 2] = Math.sin(theta) * radius - 12;
}
stars.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starField = new THREE.Points(stars, new THREE.PointsMaterial({ color: '#b7e9ff', size: 0.11, transparent: true, opacity: 0.8, sizeAttenuation: true }));
scene.add(starField);

const fireflies = [];
for (let i = 0; i < 34; i += 1) {
  const mote = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.045, 8, 8), new THREE.MeshBasicMaterial({ color: '#8deaff', transparent: true, opacity: 0.7 }));
  mote.position.set((Math.random() - 0.5) * 24, 0.6 + Math.random() * 5, (Math.random() - 0.5) * 22);
  mote.userData.phase = Math.random() * Math.PI * 2;
  mote.userData.radius = 0.8 + Math.random() * 1.6;
  scene.add(mote);
  fireflies.push(mote);
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

const lookTarget = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const startTarget = new THREE.Vector3();
const endTarget = new THREE.Vector3();
const startPosition = new THREE.Vector3();
const endPosition = new THREE.Vector3();

function applyCinematicTime(time) {
  let segment = 0;
  for (let index = 0; index < CINEMATIC_BEATS.length - 1; index += 1) {
    if (time >= CINEMATIC_BEATS[index].time && time <= CINEMATIC_BEATS[index + 1].time) {
      segment = index;
      break;
    }
  }
  const from = CINEMATIC_BEATS[segment];
  const to = CINEMATIC_BEATS[segment + 1];
  const segmentProgress = smoothstep((time - from.time) / (to.time - from.time));
  startPosition.fromArray(from.position);
  endPosition.fromArray(to.position);
  camera.position.lerpVectors(startPosition, endPosition, segmentProgress);
  startTarget.fromArray(from.target);
  endTarget.fromArray(to.target);
  desiredTarget.lerpVectors(startTarget, endTarget, segmentProgress);
  lookTarget.lerp(desiredTarget, 0.16);
  camera.lookAt(lookTarget);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(from.exposure, to.exposure, segmentProgress);
  beatName.textContent = segmentProgress > 0.66 ? to.name : from.name;
  progress.style.width = `${(time / TIMELINE_DURATION) * 100}%`;
}

const clock = new THREE.Clock();
function render() {
  const elapsed = clock.getElapsedTime();
  const time = elapsed % TIMELINE_DURATION;
  const pulse = (Math.sin(elapsed * 2.2) + 1) * 0.5;
  const sharpPulse = Math.pow((Math.sin(elapsed * 2.2) + 1) * 0.5, 8);

  applyCinematicTime(time);
  beacon.rotation.y = elapsed * 0.24;
  beaconCore.rotation.x = elapsed * 0.32;
  beaconCore.rotation.z = elapsed * 0.18;
  beaconCore.scale.setScalar(0.92 + sharpPulse * 0.12);
  beaconRings.forEach((ring, index) => {
    ring.rotation.x += (0.003 + index * 0.001) * (index % 2 ? -1 : 1);
    ring.rotation.z += 0.002 * (index + 1);
  });
  beaconLight.intensity = 2.6 + sharpPulse * 8.5;
  warmWindow.intensity = 2.6 + pulse * 1.4;
  signalBeam.material.opacity = 0.025 + sharpPulse * 0.15;
  signalBeam.scale.x = 0.88 + sharpPulse * 0.24;
  fireflies.forEach((mote, index) => {
    const phase = mote.userData.phase + elapsed * (0.35 + index * 0.009);
    mote.position.y += Math.sin(phase) * 0.0015;
    mote.position.x += Math.cos(phase * 0.7) * 0.001;
    mote.material.opacity = 0.28 + ((Math.sin(phase) + 1) * 0.5) * 0.72;
  });
  starField.rotation.y = elapsed * 0.002;

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

applyCinematicTime(0);
render();
