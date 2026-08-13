import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

const canvas = document.querySelector('#scene');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#08111f');
scene.fog = new THREE.Fog('#08111f', 8, 22);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.4, 6.5);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.HemisphereLight('#b9d9ff', '#162033', 2.2);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight('#fff2d2', 4);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
scene.add(keyLight);

const rimLight = new THREE.PointLight('#55b9ff', 18, 12, 2);
rimLight.position.set(-3, 1, -2);
scene.add(rimLight);

const object = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1.35, 0.42, 128, 32, 2, 3),
  new THREE.MeshStandardMaterial({
    color: '#ff704d',
    emissive: '#44130b',
    emissiveIntensity: 0.35,
    metalness: 0.32,
    roughness: 0.24,
  }),
);
object.castShadow = true;
object.receiveShadow = true;
scene.add(object);

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.8, 2.1, 0.3, 64),
  new THREE.MeshStandardMaterial({ color: '#152b45', metalness: 0.72, roughness: 0.3 }),
);
pedestal.position.y = -1.65;
pedestal.receiveShadow = true;
scene.add(pedestal);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(16, 64),
  new THREE.MeshStandardMaterial({ color: '#0b1728', metalness: 0.05, roughness: 0.88 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.82;
floor.receiveShadow = true;
scene.add(floor);

const clock = new THREE.Clock();

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function render() {
  const elapsed = clock.getElapsedTime();
  object.rotation.x = elapsed * 0.42;
  object.rotation.y = elapsed * 0.7;
  object.rotation.z = Math.sin(elapsed * 0.5) * 0.18;
  object.position.y = Math.sin(elapsed * 1.4) * 0.12;
  rimLight.intensity = 15 + Math.sin(elapsed * 2) * 4;
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener('resize', resize);
render();
