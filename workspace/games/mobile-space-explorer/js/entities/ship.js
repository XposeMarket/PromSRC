import * as THREE from 'three';

/** Ship faces +Z (forward). Yaw rotates around Y. */
export function createShip() {
  const group = new THREE.Group();
  group.name = 'playerShip';

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.55, 1.6, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x6eb5ff, metalness: 0.65, roughness: 0.35 }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 1.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xddeeff, metalness: 0.8, roughness: 0.2 }),
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 1.35;
  group.add(nose);

  const wingMat = new THREE.MeshStandardMaterial({ color: 0x2a5080, metalness: 0.5, roughness: 0.4 });
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.4), wingMat);
  wingL.position.set(-0.75, 0, -0.2);
  const wingR = wingL.clone();
  wingR.position.x = 0.75;
  group.add(wingL, wingR);

  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xff8844,
    emissive: 0xff4400,
    emissiveIntensity: 0.35,
  });
  const engineL = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.45, 10), engineMat);
  engineL.rotation.x = Math.PI / 2;
  engineL.position.set(-0.45, 0, -1.05);
  const engineR = engineL.clone();
  engineR.position.x = 0.45;
  group.add(engineL, engineR);

  const glowL = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glowL.position.set(-0.45, 0, -1.35);
  glowL.rotation.y = Math.PI;
  const glowR = glowL.clone();
  glowR.position.x = 0.45;
  group.add(glowL, glowR);

  const boostLight = new THREE.PointLight(0xff6622, 0, 12);
  boostLight.position.set(0, 0, -1.2);
  group.add(boostLight);

  group.userData.collisionRadius = 2.2;
  group.userData.boostParts = { engineL, engineR, glowL, glowR, boostLight };
  return group;
}

export function setBoostVisual(ship, active, dt) {
  const p = ship.userData.boostParts;
  if (!p) return;
  p.glowL.material.opacity = THREE.MathUtils.lerp(p.glowL.material.opacity, active ? 0.85 : 0, 1 - Math.pow(0.05, dt));
  p.glowR.material.opacity = p.glowL.material.opacity;
  p.engineL.material.emissiveIntensity = THREE.MathUtils.lerp(p.engineL.material.emissiveIntensity, active ? 1.4 : 0.35, 1 - Math.pow(0.08, dt));
  p.engineR.material.emissiveIntensity = p.engineL.material.emissiveIntensity;
  p.boostLight.intensity = THREE.MathUtils.lerp(p.boostLight.intensity, active ? 2.2 : 0, 1 - Math.pow(0.08, dt));
}

export function createShipState() {
  return {
    hull: 100,
    boost: 100,
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
    fireCooldown: 0,
  };
}