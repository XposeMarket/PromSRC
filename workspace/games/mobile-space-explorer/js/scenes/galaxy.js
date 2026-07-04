import * as THREE from 'three';
import { GALAXY, PLANETS } from '../config.js';
import { createMothership } from '../entities/mothership.js';

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function buildGalaxyScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020208);
  scene.fog = new THREE.FogExp2(0x020208, 0.00035);

  const amb = new THREE.AmbientLight(0x4466aa, 0.35);
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.1);
  sun.position.set(200, 300, 100);
  scene.add(amb, sun);

  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(GALAXY.starCount * 3);
  const colors = new Float32Array(GALAXY.starCount * 3);
  const rnd = seededRandom(42);
  for (let i = 0; i < GALAXY.starCount; i++) {
    const r = GALAXY.bounds * (0.3 + rnd() * 0.7);
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = (rnd() - 0.5) * r * 0.4;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const tint = 0.7 + rnd() * 0.3;
    colors[i * 3] = tint;
    colors[i * 3 + 1] = tint * (0.85 + rnd() * 0.15);
    colors[i * 3 + 2] = 1;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 1.8, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95 }),
  );
  scene.add(stars);

  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(GALAXY.bounds * 0.85, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x1a1040, transparent: true, opacity: 0.08, side: THREE.BackSide }),
  );
  scene.add(nebula);

  const planets = [];
  for (const p of PLANETS) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius, 32, 32),
      new THREE.MeshStandardMaterial({
        color: p.color,
        roughness: 0.85,
        metalness: 0.05,
        emissive: new THREE.Color(p.color).multiplyScalar(0.08),
      }),
    );
    mesh.position.set(...p.position);
    mesh.userData.planet = p;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(p.radius * 1.15, p.radius * 1.35, 48),
      new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    );
    ring.rotation.x = Math.PI / 2.2;
    mesh.add(ring);
    scene.add(mesh);
    planets.push(mesh);
  }

  const asteroids = [];
  const astGeo = new THREE.IcosahedronGeometry(1, 0);
  const astMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.95, flatShading: true });
  const ar = seededRandom(99);
  for (let i = 0; i < GALAXY.asteroidCount; i++) {
    const mesh = new THREE.Mesh(astGeo, astMat);
    const scale = 2 + ar() * 8;
    mesh.scale.setScalar(scale);
    mesh.position.set(
      (ar() - 0.5) * GALAXY.bounds * 1.6,
      (ar() - 0.5) * 200,
      (ar() - 0.5) * GALAXY.bounds * 1.6,
    );
    mesh.rotation.set(ar() * 6, ar() * 6, ar() * 6);
    mesh.userData.radius = scale * 1.1;
    mesh.userData.spin = (ar() - 0.5) * 0.8;
    scene.add(mesh);
    asteroids.push(mesh);
  }

  const props = new THREE.Group();
  props.name = 'galaxyProps';
  const pr = seededRandom(77);
  for (let i = 0; i < 55; i++) {
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(1 + pr() * 3, 0.4 + pr() * 2, 0.6 + pr() * 2),
      new THREE.MeshStandardMaterial({ color: 0x3a3530, metalness: 0.3, roughness: 0.9 }),
    );
    chunk.position.set((pr() - 0.5) * GALAXY.bounds * 1.4, (pr() - 0.5) * 160, (pr() - 0.5) * GALAXY.bounds * 1.4);
    chunk.rotation.set(pr() * 3, pr() * 3, pr() * 3);
    props.add(chunk);
  }
  for (let i = 0; i < 12; i++) {
    const sat = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.6, roughness: 0.4 }),
    );
    const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 2), new THREE.MeshStandardMaterial({ color: 0x224466, emissive: 0x112233, emissiveIntensity: 0.5 }));
    panelL.position.x = -2.2;
    const panelR = panelL.clone();
    panelR.position.x = 2.2;
    sat.add(body, panelL, panelR);
    sat.position.set((pr() - 0.5) * 500, 40 + pr() * 120, (pr() - 0.5) * 500);
    sat.userData.spin = 0.15 + pr() * 0.4;
    props.add(sat);
  }
  const comet = new THREE.Group();
  const cometCore = new THREE.Mesh(
    new THREE.SphereGeometry(6, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xaaddff, emissive: 0x4488cc, emissiveIntensity: 0.6 }),
  );
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(60 * 3);
  for (let i = 0; i < 60; i++) {
    trailPos[i * 3] = -i * 2.5;
    trailPos[i * 3 + 1] = (pr() - 0.5) * 0.8;
    trailPos[i * 3 + 2] = (pr() - 0.5) * 0.8;
  }
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color: 0x88ccff, size: 2.5, transparent: true, opacity: 0.7 }));
  comet.add(cometCore, trail);
  comet.position.set(-220, 60, 180);
  comet.userData.drift = { t: 0, speed: 0.12 };
  props.add(comet);
  const wreck = new THREE.Group();
  const wreckHull = new THREE.Mesh(
    new THREE.BoxGeometry(28, 6, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.5, roughness: 0.8 }),
  );
  wreckHull.rotation.z = 0.35;
  wreckHull.rotation.y = 1.1;
  const wreckWing = new THREE.Mesh(new THREE.BoxGeometry(18, 1, 6), new THREE.MeshStandardMaterial({ color: 0x444455 }));
  wreckWing.position.set(8, 2, 0);
  wreckWing.rotation.z = -0.6;
  wreck.add(wreckHull, wreckWing);
  wreck.position.set(90, -15, -120);
  props.add(wreck);
  scene.add(props);

  const mothership = createMothership();
  scene.add(mothership);

  return { scene, planets, asteroids, stars, mothership, props };
}

export function updateGalaxyAmbient(scene, time) {
  const dt = 0.016;
  scene.traverse((c) => {
    if (c.userData?.spin !== undefined) {
      c.rotation.y += c.userData.spin * dt;
    }
    if (c.userData?.drift) {
      c.userData.drift.t += dt * c.userData.drift.speed;
      c.position.x += Math.sin(c.userData.drift.t) * 0.08;
      c.position.z += Math.cos(c.userData.drift.t * 0.7) * 0.06;
    }
  });
}