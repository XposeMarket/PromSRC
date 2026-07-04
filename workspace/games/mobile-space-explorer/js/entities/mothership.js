import * as THREE from 'three';

export function createMothership() {
  const group = new THREE.Group();
  group.name = 'mothership';

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(42, 12, 18),
    new THREE.MeshStandardMaterial({ color: 0x4a6088, metalness: 0.7, roughness: 0.35 }),
  );
  group.add(hull);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(14, 6, 10),
    new THREE.MeshStandardMaterial({ color: 0x88aacc, metalness: 0.5, roughness: 0.3, emissive: 0x223344, emissiveIntensity: 0.4 }),
  );
  bridge.position.set(0, 7, 2);
  group.add(bridge);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(22, 1.2, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x99bbee, metalness: 0.8, roughness: 0.25 }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  for (let i = 0; i < 6; i++) {
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 3, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.6, roughness: 0.5 }),
    );
    const a = (i / 6) * Math.PI * 2;
    pod.position.set(Math.cos(a) * 18, -2, Math.sin(a) * 8);
    group.add(pod);
  }

  const beacon = new THREE.PointLight(0x66ccff, 1.2, 80);
  beacon.position.set(0, 10, 0);
  group.add(beacon);

  group.position.set(120, 95, -280);
  group.userData.drift = { phase: 0, base: group.position.clone() };
  group.userData.boardRadius = 38;
  group.userData.interiorSpawn = new THREE.Vector3(0, 2, 8);

  return group;
}

export function updateMothership(ship, dt) {
  const d = ship.userData.drift;
  if (!d) return;
  d.phase += dt * 0.35;
  ship.position.x = d.base.x + Math.sin(d.phase) * 45;
  ship.position.y = d.base.y + Math.sin(d.phase * 0.7) * 12;
  ship.position.z = d.base.z + Math.cos(d.phase * 0.9) * 35;
  ship.rotation.y += dt * 0.08;
}