import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** Mixamo-style Xbot (three.js examples) — loaded once, cloned per NPC. */
const GLTF_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r181/examples/models/gltf/Xbot.glb';

let gltfTemplate = null;
let gltfLoadPromise = null;

export function preloadHumanoidGltf() {
  if (gltfLoadPromise) return gltfLoadPromise;
  gltfLoadPromise = (async () => {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(GLTF_URL);
      const root = gltf.scene;
      root.scale.setScalar(0.021);
      root.position.y = 0;
      root.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = true;
        }
      });
      gltfTemplate = root;
      gltfTemplate.userData.animations = gltf.animations || [];
      return true;
    } catch (err) {
      console.warn('[Galaxy Drift] GLTF humanoid unavailable, using procedural rigs.', err);
      gltfTemplate = null;
      return false;
    }
  })();
  return gltfLoadPromise;
}

function tintGltfClone(clone, c) {
  const tint = new THREE.Color(c.color);
  clone.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.color) m.color.lerp(tint, c.hostile ? 0.35 : 0.22);
      if (c.hostile && m.emissive) {
        m.emissive.setHex(0x331100);
        m.emissiveIntensity = 0.15;
      }
    }
  });
}

function buildProceduralHumanoid(c) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: c.hostile ? 0x3a3a44 : 0xd4a574,
    metalness: c.hostile ? 0.55 : 0.08,
    roughness: c.hostile ? 0.45 : 0.72,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: c.color,
    metalness: 0.15,
    roughness: 0.65,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.4, roughness: 0.5 });

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.32), cloth);
  pelvis.position.y = 0.95;
  g.add(pelvis);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.28), cloth);
  spine.position.y = 1.35;
  g.add(spine);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.38), c.hostile ? skin : cloth);
  chest.position.y = 1.75;
  g.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), skin);
  head.position.y = 2.15;
  g.add(head);

  if (c.hostile) {
    const helm = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.7, roughness: 0.35 }),
    );
    helm.position.y = 2.2;
    g.add(helm);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff4400, emissiveIntensity: 1.1 }),
    );
    visor.position.set(0, 2.12, 0.24);
    g.add(visor);
  } else {
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: c.color, transparent: true, opacity: 0.88, roughness: 0.8 }),
    );
    hood.position.y = 2.35;
    hood.rotation.x = Math.PI;
    g.add(hood);
  }

  const makeLimb = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };

  const upperArmL = makeLimb(0.22, 0.42, 0.22, skin, -0.48, 1.72, 0);
  const upperArmR = makeLimb(0.22, 0.42, 0.22, skin, 0.48, 1.72, 0);
  const lowerArmL = makeLimb(0.18, 0.38, 0.18, skin, -0.48, 1.32, 0.08);
  const lowerArmR = makeLimb(0.18, 0.38, 0.18, skin, 0.48, 1.32, 0.08);
  g.add(upperArmL, upperArmR, lowerArmL, lowerArmR);

  const thighL = makeLimb(0.26, 0.48, 0.26, dark, -0.2, 0.55, 0);
  const thighR = makeLimb(0.26, 0.48, 0.26, dark, 0.2, 0.55, 0);
  const shinL = makeLimb(0.22, 0.45, 0.22, dark, -0.2, 0.12, 0.05);
  const shinR = makeLimb(0.22, 0.45, 0.22, dark, 0.2, 0.12, 0.05);
  g.add(thighL, thighR, shinL, shinR);

  const bootL = makeLimb(0.28, 0.14, 0.38, dark, -0.2, -0.02, 0.06);
  const bootR = makeLimb(0.28, 0.14, 0.38, dark, 0.2, -0.02, 0.06);
  g.add(bootL, bootR);

  g.userData.limbs = { upperArmL, upperArmR, lowerArmL, lowerArmR, thighL, thighR };

  if (c.hostile) {
    const rifle = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.35), dark);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.45;
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x0088ff, emissiveIntensity: 0.6 }),
    );
    glow.position.z = 0.72;
    rifle.add(stock, barrel, glow);
    rifle.position.set(0.42, 1.35, 0.35);
    rifle.rotation.y = -0.3;
    g.add(rifle);
    g.userData.gun = rifle;
    const pauldron = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.2, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.65, roughness: 0.4 }),
    );
    pauldron.position.set(0.38, 1.85, 0);
    g.add(pauldron);
  } else {
    const staff = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.65, 8), new THREE.MeshStandardMaterial({ color: 0x6a5040 }));
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x88ffcc, emissive: 0x22aa66, emissiveIntensity: 0.5 }),
    );
    orb.position.y = 0.9;
    staff.add(pole, orb);
    staff.position.set(-0.55, 0.85, 0.15);
    g.add(staff);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.22), cloth);
    pack.position.set(0, 1.45, -0.22);
    g.add(pack);
  }

  return g;
}

export function buildHumanoidNpc(c) {
  const g = new THREE.Group();
  let body;

  if (gltfTemplate) {
    body = SkeletonUtils.clone(gltfTemplate);
    tintGltfClone(body, c);
    body.userData.isGltf = true;
    if (gltfTemplate.userData.animations?.length) {
      const mixer = new THREE.AnimationMixer(body);
      const clip = gltfTemplate.userData.animations.find((a) => /idle|walk/i.test(a.name)) || gltfTemplate.userData.animations[0];
      if (clip) {
        const action = mixer.clipAction(clip);
        action.play();
        body.userData.mixer = mixer;
      }
    }
  } else {
    body = buildProceduralHumanoid(c);
  }

  body.position.y = 0;
  g.add(body);
  g.userData.body = body;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.12, 28),
    new THREE.MeshBasicMaterial({
      color: c.hostile ? 0xff3333 : 0x44ff88,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  g.add(ring);
  g.userData.ring = ring;

  return g;
}

export function animateHumanoidNpc(n, data, dt, moving) {
  const body = n.userData.body;
  if (!body) return;
  data.anim = (data.anim || 0) + dt;

  if (body.userData.mixer) {
    body.userData.mixer.update(dt);
    return;
  }

  const limbs = body.userData.limbs;
  if (!limbs) {
    body.position.y = Math.sin(data.anim * 2) * 0.04;
    return;
  }

  const swing = moving ? Math.sin(data.anim * 10) * 0.35 : Math.sin(data.anim * 2) * 0.08;
  limbs.upperArmL.rotation.x = swing;
  limbs.upperArmR.rotation.x = -swing;
  limbs.lowerArmL.rotation.x = -0.2 - Math.abs(swing) * 0.3;
  limbs.lowerArmR.rotation.x = -0.2 - Math.abs(swing) * 0.3;
  limbs.thighL.rotation.x = -swing * 0.5;
  limbs.thighR.rotation.x = swing * 0.5;
  if (!data.hostile) body.position.y = Math.sin(data.anim * 1.5) * 0.06;
}