import * as THREE from 'three';

export function createProjectileSystem(scene) {
  const bullets = [];
  const geo = new THREE.SphereGeometry(0.35, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffee66 });

  function spawn(origin, direction, speed = 120, owner = 'player') {
    const mesh = new THREE.Mesh(geo, owner === 'enemy' ? new THREE.MeshBasicMaterial({ color: 0xff4422 }) : mat.clone());
    mesh.position.copy(origin);
    const vel = direction.clone().normalize().multiplyScalar(speed);
    mesh.userData = { vel, life: owner === 'enemy' ? 1.8 : 2.2, owner };
    scene.add(mesh);
    bullets.push(mesh);
    return mesh;
  }

  function update(dt, onHitAsteroid, playerPos, onHitPlayer) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const u = b.userData;
      b.position.addScaledVector(u.vel, dt);
      u.life -= dt;
      if (u.life <= 0) {
        scene.remove(b);
        bullets.splice(i, 1);
        continue;
      }
      if (u.owner === 'player' && onHitAsteroid) {
        onHitAsteroid(b);
      }
      if (u.owner === 'enemy' && playerPos && onHitPlayer && b.position.distanceTo(playerPos) < 2.5) {
        onHitPlayer(5);
        scene.remove(b);
        bullets.splice(i, 1);
      }
    }
  }

  return { spawn, update, bullets };
}