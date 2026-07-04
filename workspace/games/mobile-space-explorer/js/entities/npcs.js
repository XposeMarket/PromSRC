import * as THREE from 'three';
import { buildHumanoidNpc, animateHumanoidNpc } from './humanoid.js';

export function spawnBiomeNpcs(scene, planet) {
  const npcs = [];
  const configs = [
    { name: 'Scout Kira', hostile: false, color: 0x66ccff, x: 25, z: 15, lines: ['This biome breathes different air.', 'The galaxy is quieter from down here.', 'Watch the lava vents on Ember — they never sleep.'] },
    { name: 'Raider Vex', hostile: true, color: 0xff4444, x: -40, z: 30, ranged: true, lines: ['Hand over your cargo.', 'You should not have landed here.'] },
    { name: 'Elder Moss', hostile: false, color: 0x88ff99, x: 10, z: -50, lines: ['The roots remember every traveler.', 'Jade Hollow heals those who stay still.'] },
    { name: 'Dune Watcher', hostile: true, color: 0xffaa44, x: -20, z: -35, lines: ['...', 'Storm coming. Move.'] },
    { name: 'Forge Bot', hostile: false, color: 0xaaaaaa, x: -15, z: 20, lines: ['Lava biome runs hot. Hull plating helps.', 'I catalog meteor fragments.'] },
    { name: 'Ice Hermit', hostile: false, color: 0xccddff, x: 35, z: -25, lines: ['Frostundra never thaws at the poles.', 'Bring fuel if you stay.'] },
    { name: 'Sand Stalker', hostile: true, color: 0xcc6622, x: 30, z: 40, ranged: true, lines: ['Your tracks are obvious.', 'The dunes swallow ships whole.'] },
    { name: 'Vine Shaman', hostile: false, color: 0x22aa55, x: -30, z: -15, lines: ['Listen — the canopy whispers warnings.', 'Raiders fear the deep jungle.'] },
  ];

  const byBiome = {
    lava: [0, 1, 4],
    tundra: [0, 5, 1],
    jungle: [2, 7, 1],
    desert: [3, 6, 0],
  };
  const indices = byBiome[planet.biome] || [0, 1];
  const use = indices.map((i) => configs[i]).filter(Boolean);

  for (const c of use) {
    const body = buildHumanoidNpc(c);
    body.position.set(c.x, 0, c.z);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeLabelTexture(c.name),
        transparent: true,
      }),
    );
    label.position.y = 2.85;
    label.scale.set(8, 2, 1);
    body.add(label);
    body.userData.npc = { ...c, hp: c.hostile ? 55 : 999, attackCd: 0, anim: 0, rangedCd: 0 };
    body.userData.gun = body.userData.body?.userData?.gun;
    scene.add(body);
    npcs.push(body);
  }
  return npcs;
}

function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function updateNpcs(npcs, playerPos, dt, onHit, onRangedShot) {
  for (const n of npcs) {
    const data = n.userData.npc;
    if (!data) continue;
    if (n.userData.ring) {
      n.userData.ring.material.opacity = 0.35 + Math.sin((data.anim || 0) * 3) * 0.15;
    }
    if (!data.hostile) {
      animateHumanoidNpc(n, data, dt, false);
      continue;
    }
    data.attackCd -= dt;
    data.rangedCd = (data.rangedCd || 0) - dt;
    const dist = n.position.distanceTo(playerPos);
    let moving = false;
    if (dist < 55 && dist > 3) {
      const dir = playerPos.clone().sub(n.position).normalize();
      const speed = data.ranged && dist < 22 ? 8 : 14;
      n.position.add(dir.multiplyScalar(speed * dt));
      n.lookAt(playerPos.x, n.position.y + 1.2, playerPos.z);
      moving = true;
      const gun = n.userData.gun || n.userData.body?.userData?.gun;
      if (gun) gun.rotation.x = -0.2 + Math.sin((data.anim || 0) * 8) * 0.1;
    }
    animateHumanoidNpc(n, data, dt, moving);
    if (data.ranged && dist < 28 && dist > 8 && data.rangedCd <= 0 && onRangedShot) {
      data.rangedCd = 2.2;
      const origin = n.position.clone().add(new THREE.Vector3(0, 1.55, 0));
      const aim = playerPos.clone().sub(origin).normalize();
      onRangedShot(origin, aim);
    }
    if (dist < 6 && data.attackCd <= 0) {
      data.attackCd = 1.2;
      onHit(8);
    }
  }
}

export function findNearestFriendlyNpc(npcs, playerPos, maxDist = 12) {
  let best = null;
  let bestD = maxDist;
  for (const n of npcs) {
    const d = n.userData.npc;
    if (!d || d.hostile) continue;
    const dist = n.position.distanceTo(playerPos);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}