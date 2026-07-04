import * as THREE from 'three';
import { BIOME_SIZE } from '../config.js';

const BIOME_DEFS = {
  lava: { ground: 0x3a1810, accent: 0xff4422, fog: 0x1a0805, trees: 0 },
  tundra: { ground: 0xc8dce8, accent: 0x88aacc, fog: 0x8899aa, trees: 12 },
  jungle: { ground: 0x1a4a22, accent: 0x2d8a3a, fog: 0x0a2810, trees: 45 },
  desert: { ground: 0xc9a227, accent: 0xe8d070, fog: 0x8a7020, trees: 4 },
};

export function buildBiomeScene(planet) {
  const def = BIOME_DEFS[planet.biome] || BIOME_DEFS.jungle;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(def.fog);
  scene.fog = new THREE.Fog(def.fog, 40, BIOME_SIZE * 0.95);

  scene.add(new THREE.HemisphereLight(0xffffff, def.ground, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(BIOME_SIZE, 64),
    new THREE.MeshStandardMaterial({ color: def.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  if (planet.biome === 'lava') {
    for (let i = 0; i < 8; i++) {
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(8 + Math.random() * 12, 16),
        new THREE.MeshStandardMaterial({ color: def.accent, emissive: def.accent, emissiveIntensity: 0.8 }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set((Math.random() - 0.5) * 120, 0.05, (Math.random() - 0.5) * 120);
      scene.add(pool);
    }
  }

  const treeCount = def.trees;
  for (let i = 0; i < treeCount; i++) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.6, 3 + Math.random() * 4, 6),
      new THREE.MeshStandardMaterial({ color: planet.biome === 'jungle' ? 0x4a3020 : 0x6a5a40 }),
    );
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(2 + Math.random() * 2, 5 + Math.random() * 3, 7),
      new THREE.MeshStandardMaterial({ color: def.accent }),
    );
    const g = new THREE.Group();
    trunk.position.y = 2;
    crown.position.y = 5.5;
    g.add(trunk, crown);
    const ang = Math.random() * Math.PI * 2;
    const rad = 15 + Math.random() * (BIOME_SIZE * 0.4);
    g.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
    scene.add(g);
  }

  if (planet.biome === 'desert') {
    for (let i = 0; i < 6; i++) {
      const dune = new THREE.Mesh(
        new THREE.SphereGeometry(12 + Math.random() * 10, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: def.accent }),
      );
      dune.position.set((Math.random() - 0.5) * 140, 0, (Math.random() - 0.5) * 140);
      scene.add(dune);
    }
  }

  if (planet.biome === 'tundra') {
    for (let i = 0; i < 18; i++) {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.2 + Math.random() * 1.5, 0),
        new THREE.MeshStandardMaterial({ color: 0xaaddff, emissive: 0x4488aa, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }),
      );
      const a = Math.random() * Math.PI * 2;
      const d = 25 + Math.random() * 70;
      crystal.position.set(Math.cos(a) * d, 0.8 + Math.random() * 0.5, Math.sin(a) * d);
      scene.add(crystal);
    }
  }

  if (planet.biome === 'jungle') {
    for (let i = 0; i < 10; i++) {
      const ruin = new THREE.Mesh(
        new THREE.BoxGeometry(3 + Math.random() * 4, 2 + Math.random() * 5, 2 + Math.random() * 3),
        new THREE.MeshStandardMaterial({ color: 0x5a5040, roughness: 0.95 }),
      );
      ruin.position.set((Math.random() - 0.5) * 100, 1, (Math.random() - 0.5) * 100);
      ruin.rotation.y = Math.random() * Math.PI;
      scene.add(ruin);
    }
  }

  const rocks = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const r = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.5 + Math.random() * 2, 0),
      new THREE.MeshStandardMaterial({ color: 0x555555, flatShading: true }),
    );
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * 80;
    r.position.set(Math.cos(a) * d, 0.5, Math.sin(a) * d);
    rocks.add(r);
  }
  scene.add(rocks);

  scene.userData.planet = planet;
  scene.userData.groundY = 0;
  return scene;
}