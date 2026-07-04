import * as THREE from 'three';
import { buildHumanoidNpc } from '../entities/humanoid.js';

export function buildMothershipInterior() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1220);
  scene.fog = new THREE.Fog(0x0a1220, 40, 120);

  scene.add(new THREE.AmbientLight(0x446688, 0.5));
  const key = new THREE.DirectionalLight(0xcceeff, 0.9);
  key.position.set(10, 20, 5);
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x1a2838, metalness: 0.4, roughness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3a50, metalness: 0.5, roughness: 0.6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(80, 16, 2), wallMat);
  back.position.set(0, 8, -38);
  scene.add(back);

  const window = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 10),
    new THREE.MeshBasicMaterial({ color: 0x112233, transparent: true, opacity: 0.85 }),
  );
  window.position.set(0, 10, -36.9);
  scene.add(window);

  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        Array.from({ length: 300 }, () => (Math.random() - 0.5) * 200),
        3,
      ),
    ),
    new THREE.PointsMaterial({ size: 1.2, color: 0xaaccff }),
  );
  stars.position.set(0, 12, -50);
  scene.add(stars);

  const console = new THREE.Mesh(
    new THREE.BoxGeometry(12, 3, 4),
    new THREE.MeshStandardMaterial({ color: 0x3d5a80, emissive: 0x224466, emissiveIntensity: 0.5 }),
  );
  console.position.set(0, 1.5, -20);
  scene.add(console);

  const airlock = new THREE.Mesh(
    new THREE.BoxGeometry(8, 10, 2),
    new THREE.MeshStandardMaterial({ color: 0x556677, emissive: 0x00ff88, emissiveIntensity: 0.15 }),
  );
  airlock.position.set(32, 5, 0);
  airlock.userData.airlock = true;
  scene.add(airlock);

  const sideWallL = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 70), wallMat);
  sideWallL.position.set(-38, 7, 0);
  const sideWallR = sideWallL.clone();
  sideWallR.position.x = 38;
  scene.add(sideWallL, sideWallR);

  for (let i = 0; i < 5; i++) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(3 + Math.random() * 2, 2.5, 3),
      new THREE.MeshStandardMaterial({ color: 0x3a4a55, metalness: 0.3, roughness: 0.8 }),
    );
    crate.position.set(-20 + i * 9, 1.25, 18 + (i % 2) * 6);
    scene.add(crate);
  }

  const hangarBay = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a3040, emissive: 0x224466, emissiveIntensity: 0.25 }),
  );
  hangarBay.rotation.x = -Math.PI / 2;
  hangarBay.position.set(-22, 0.02, -8);
  scene.add(hangarBay);

  const parkedShip = new THREE.Mesh(
    new THREE.ConeGeometry(2, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x6688aa, metalness: 0.6, roughness: 0.4 }),
  );
  parkedShip.rotation.x = Math.PI / 2;
  parkedShip.position.set(-22, 1.2, -8);
  scene.add(parkedShip);

  const terminals = [];
  for (let i = 0; i < 3; i++) {
    const term = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2.5, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a4055, emissive: 0x00aaff, emissiveIntensity: 0.4 + i * 0.1 }),
    );
    term.position.set(-8 + i * 10, 1.25, -32);
    scene.add(term);
    terminals.push(term);
  }

  const bar = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0x4a3828 }));
  bar.position.set(12, 0.6, 22);
  scene.add(bar);
  for (let i = 0; i < 4; i++) {
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    stool.position.set(8 + i * 3, 0.6, 26);
    scene.add(stool);
  }

  const crewNpc = buildHumanoidNpc({
    name: 'Officer Lane',
    hostile: false,
    color: 0x4a6a9a,
    lines: ['Welcome aboard the carrier.', 'Command AI tracks all sector traffic.', 'Green airlock returns you to deep space.'],
  });
  crewNpc.position.set(0, 0, 12);
  crewNpc.userData.crew = { name: 'Officer Lane', lines: ['Welcome aboard the carrier.', 'Command AI tracks all sector traffic.', 'Green airlock returns you to deep space.'] };
  scene.add(crewNpc);

  const pipes = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 12 + Math.random() * 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.7, roughness: 0.35 }),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-30 + i * 8, 12 + (i % 2) * 2, -5);
    pipes.add(pipe);
  }
  scene.add(pipes);

  const rail = new THREE.PointLight(0x66aaff, 0.6, 25);
  rail.position.set(-15, 4, 0);
  scene.add(rail);
  const warm = new THREE.PointLight(0xffaa66, 0.5, 20);
  warm.position.set(12, 3, 22);
  scene.add(warm);

  return { scene, size: 36, crewNpc, console };
}