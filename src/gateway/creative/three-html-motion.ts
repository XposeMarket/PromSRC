export type ThreeMotionParts = {
  html: string;
  css: string;
  js: string;
};

export type ThreeMotionBaseOptions = {
  id?: string;
  start?: number;
  duration?: number;
  accent?: string;
  secondary?: string;
  background?: string;
  intensity?: number;
  speed?: number;
  trackIndex?: number;
};

function escapeAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeId(raw: unknown, fallback: string): string {
  return String(raw || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function color(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : fallback;
}

function baseCanvas(options: ThreeMotionBaseOptions, role: string): { id: string; html: string; css: string; start: number; duration: number; accent: string; secondary: string; background: string; intensity: number; speed: number; trackIndexAttr: string } {
  const id = sanitizeId(options.id, `prom-three-${role}`);
  const start = clampNumber(options.start, 0, 0, 300);
  const duration = clampNumber(options.duration, 6, 0.1, 300);
  const accent = color(options.accent, '#38bdf8');
  const secondary = color(options.secondary, '#f97316');
  const background = color(options.background, '#05070d');
  const intensity = clampNumber(options.intensity, 0.8, 0, 2);
  const speed = clampNumber(options.speed, 1, 0.05, 4);
  const trackIndex = Number.isFinite(Number(options.trackIndex)) ? Math.max(0, Math.round(Number(options.trackIndex))) : null;
  const trackIndexAttr = trackIndex === null ? '' : ` data-track-index="${trackIndex}"`;
  return {
    id,
    start,
    duration,
    accent,
    secondary,
    background,
    intensity,
    speed,
    trackIndexAttr,
    html: `<canvas id="${escapeAttr(id)}" class="prom-block prom-three-motion" data-role="${escapeAttr(role)}"${trackIndexAttr} data-renderer="three" data-start="${start}s" data-duration="${duration}s" data-three-scene="${escapeAttr(role)}" data-prometheus-webgl="true"></canvas>`,
    css: `.prom-three-motion{position:absolute;inset:0;width:100%;height:100%;display:block;background:${background};contain:layout paint size}`,
  };
}

function moduleScript(source: string): string {
  return `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`;
}

export function renderThreeParticleFieldParts(options: ThreeMotionBaseOptions = {}): ThreeMotionParts {
  const base = baseCanvas(options, 'three-particle-field');
  const count = Math.round(clampNumber((options as any).count, 900, 80, 6000));
  const radius = clampNumber((options as any).radius, 7, 1, 30);
  return {
    html: base.html,
    css: `${base.css}.prom-three-motion[data-three-scene="three-particle-field"]{background:radial-gradient(circle at 50% 42%,${base.accent}18,transparent 30%),${base.background}}`,
    js: moduleScript(`
import * as THREE from '/api/canvas/vendor/three/build/three.module.js';
const canvas = document.getElementById(${JSON.stringify(base.id)});
if (canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(${JSON.stringify(base.background)}, 8, 22);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const positions = new Float32Array(${count} * 3);
  const colors = new Float32Array(${count} * 3);
  const c1 = new THREE.Color(${JSON.stringify(base.accent)});
  const c2 = new THREE.Color(${JSON.stringify(base.secondary)});
  for (let i = 0; i < ${count}; i += 1) {
    const a = i * 12.9898;
    const b = i * 78.233;
    const r = ${radius} * (0.24 + ((Math.sin(a) * 43758.5453) % 1 + 1) % 1);
    const theta = i * 2.399963;
    const y = (((Math.sin(b) * 24634.6345) % 1 + 1) % 1 - 0.5) * ${radius} * 1.35;
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * r;
    const mixed = c1.clone().lerp(c2, i / ${count});
    colors[i * 3] = mixed.r; colors[i * 3 + 1] = mixed.g; colors[i * 3 + 2] = mixed.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.92 });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  const ring = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.TorusGeometry(3.4, 0.025, 8, 160)), new THREE.LineBasicMaterial({ color: ${JSON.stringify(base.accent)}, transparent: true, opacity: 0.36 }));
  scene.add(ring);
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || 1080));
    const h = Math.max(1, Math.round(r.height || 1920));
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function renderAt(seconds) {
    resize();
    const local = Math.max(0, seconds - ${base.start}) * ${base.speed};
    points.rotation.y = local * 0.18;
    points.rotation.x = Math.sin(local * 0.24) * 0.16;
    ring.rotation.x = Math.PI / 2 + Math.sin(local * 0.32) * 0.18;
    ring.rotation.z = local * 0.34;
    camera.position.x = Math.sin(local * 0.18) * 1.2;
    camera.position.y = Math.cos(local * 0.14) * 0.55;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    canvas.dataset.prometheusThreeStatus = 'rendered';
  }
  window.addEventListener('prometheus-html-motion-seek', (event) => renderAt(Number(event.detail && event.detail.timeSeconds) || 0));
  renderAt(Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__) || 0);
}`),
  };
}

export function renderThreeLogoRevealParts(options: ThreeMotionBaseOptions & { text?: string } = {}): ThreeMotionParts {
  const base = baseCanvas(options, 'three-logo-reveal');
  const text = String(options.text || 'PROMETHEUS').replace(/[^\w .-]+/g, '').slice(0, 28) || 'PROMETHEUS';
  return {
    html: base.html,
    css: `${base.css}.prom-three-motion[data-three-scene="three-logo-reveal"]{background:linear-gradient(180deg,${base.background},#02030a)}`,
    js: moduleScript(`
import * as THREE from '/api/canvas/vendor/three/build/three.module.js';
const canvas = document.getElementById(${JSON.stringify(base.id)});
if (canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 1.2, 9);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const group = new THREE.Group();
  scene.add(group);
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const key = new THREE.DirectionalLight(${JSON.stringify(base.accent)}, ${base.intensity} * 1.8);
  key.position.set(4, 5, 6);
  const rim = new THREE.PointLight(${JSON.stringify(base.secondary)}, ${base.intensity} * 35, 18);
  rim.position.set(-3, -1, 4);
  scene.add(ambient, key, rim);
  const material = new THREE.MeshStandardMaterial({ color: ${JSON.stringify(base.accent)}, metalness: 0.55, roughness: 0.25, emissive: ${JSON.stringify(base.accent)}, emissiveIntensity: 0.18 });
  const letters = ${JSON.stringify(text)}.slice(0, 14).split('');
  const step = 0.62;
  letters.forEach((letter, i) => {
    const w = letter === ' ' ? 0.18 : 0.44;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.72, 0.22), material);
    mesh.position.x = (i - (letters.length - 1) / 2) * step;
    mesh.position.y = Math.sin(i * 0.72) * 0.05;
    mesh.userData.offset = i * 0.035;
    group.add(mesh);
  });
  const back = new THREE.Mesh(new THREE.TorusKnotGeometry(1.65, 0.025, 180, 12), new THREE.MeshStandardMaterial({ color: ${JSON.stringify(base.secondary)}, emissive: ${JSON.stringify(base.secondary)}, emissiveIntensity: 0.35, transparent: true, opacity: 0.72 }));
  back.position.z = -0.55;
  group.add(back);
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || 1080));
    const h = Math.max(1, Math.round(r.height || 1920));
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3); }
  function renderAt(seconds) {
    resize();
    const local = Math.max(0, seconds - ${base.start}) * ${base.speed};
    const reveal = ease(local / Math.max(0.1, ${base.duration} * 0.42));
    group.rotation.y = -0.75 + reveal * 0.85 + Math.sin(local * 0.55) * 0.05;
    group.rotation.x = Math.sin(local * 0.32) * 0.08;
    group.scale.setScalar(0.72 + reveal * 0.42);
    group.children.forEach((child) => {
      if (!child.isMesh || child === back) return;
      const p = ease((local - child.userData.offset * 8) / 1.2);
      child.position.z = -2.6 + p * 2.6;
      child.material.opacity = p;
      child.material.transparent = true;
    });
    back.rotation.x = local * 0.28;
    back.rotation.y = local * 0.42;
    key.position.x = Math.sin(local * 1.1) * 5;
    renderer.render(scene, camera);
    canvas.dataset.prometheusThreeStatus = 'rendered';
  }
  window.addEventListener('prometheus-html-motion-seek', (event) => renderAt(Number(event.detail && event.detail.timeSeconds) || 0));
  renderAt(Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__) || 0);
}`),
  };
}

export function renderThreeDeviceStackParts(options: ThreeMotionBaseOptions = {}): ThreeMotionParts {
  const base = baseCanvas(options, 'three-device-stack');
  return {
    html: base.html,
    css: `${base.css}.prom-three-motion[data-three-scene="three-device-stack"]{background:radial-gradient(circle at 50% 50%,${base.accent}18,transparent 34%),${base.background}}`,
    js: moduleScript(`
import * as THREE from '/api/canvas/vendor/three/build/three.module.js';
const canvas = document.getElementById(${JSON.stringify(base.id)});
if (canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.4, 8.6);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.52));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 4, 5);
  scene.add(key);
  const group = new THREE.Group();
  scene.add(group);
  function makeDevice(x, y, z, w, h, color, angle) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), new THREE.MeshStandardMaterial({ color: '#101827', metalness: 0.35, roughness: 0.42 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.88, h * 0.82), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }));
    screen.position.z = 0.071;
    body.add(screen);
    body.position.set(x, y, z);
    body.rotation.set(-0.12, angle, 0.05);
    group.add(body);
    return body;
  }
  const devices = [
    makeDevice(-1.35, 0.18, 0, 1.45, 2.65, ${JSON.stringify(base.accent)}, -0.42),
    makeDevice(0.42, -0.06, -0.34, 2.45, 1.55, ${JSON.stringify(base.secondary)}, 0.08),
    makeDevice(1.68, 0.08, -0.76, 1.18, 2.28, '#ffffff', 0.36)
  ];
  const gridMat = new THREE.LineBasicMaterial({ color: ${JSON.stringify(base.accent)}, transparent: true, opacity: 0.22 });
  const grid = new THREE.GridHelper(8, 18, ${JSON.stringify(base.accent)}, ${JSON.stringify(base.accent)});
  grid.material = gridMat;
  grid.position.y = -1.65;
  grid.rotation.x = 0.08;
  scene.add(grid);
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || 1080));
    const h = Math.max(1, Math.round(r.height || 1920));
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function renderAt(seconds) {
    resize();
    const local = Math.max(0, seconds - ${base.start}) * ${base.speed};
    group.rotation.y = Math.sin(local * 0.36) * 0.22;
    group.position.y = Math.sin(local * 0.7) * 0.08;
    devices.forEach((device, i) => {
      device.position.y += Math.sin(local * 1.1 + i) * 0.003;
      device.rotation.z = Math.sin(local * 0.6 + i) * 0.035;
    });
    camera.position.x = Math.sin(local * 0.22) * 0.72;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    canvas.dataset.prometheusThreeStatus = 'rendered';
  }
  window.addEventListener('prometheus-html-motion-seek', (event) => renderAt(Number(event.detail && event.detail.timeSeconds) || 0));
  renderAt(Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__) || 0);
}`),
  };
}

export function renderThreeGltfTurntableParts(options: ThreeMotionBaseOptions & { modelAssetId?: string } = {}): ThreeMotionParts {
  const base = baseCanvas(options, 'three-gltf-turntable');
  const modelAssetId = sanitizeId(options.modelAssetId || 'model', 'model');
  return {
    html: `<canvas id="${escapeAttr(base.id)}" class="prom-block prom-three-motion" data-role="three-model"${base.trackIndexAttr} data-renderer="three" data-start="${base.start}s" data-duration="${base.duration}s" data-three-scene="three-gltf-turntable" data-prometheus-webgl="true" data-model-asset-id="${escapeAttr(modelAssetId)}" data-model-src="{{asset.${escapeAttr(modelAssetId)}}}"></canvas>`,
    css: `${base.css}.prom-three-motion[data-three-scene="three-gltf-turntable"]{background:radial-gradient(circle at 50% 46%,${base.accent}1f,transparent 38%),${base.background}}`,
    js: `<script type="importmap">{"imports":{"three":"/api/canvas/vendor/three/build/three.module.js"}}</script>` + moduleScript(`
import * as THREE from '/api/canvas/vendor/three/build/three.module.js';
import { GLTFLoader } from '/api/canvas/vendor/three/examples/jsm/loaders/GLTFLoader.js';
const canvas = document.getElementById(${JSON.stringify(base.id)});
if (canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.1, 6.5);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.72));
  const key = new THREE.DirectionalLight(${JSON.stringify(base.accent)}, ${base.intensity} * 2.2);
  key.position.set(4, 5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(${JSON.stringify(base.secondary)}, ${base.intensity} * 22, 16);
  rim.position.set(-3, 0.5, 3);
  scene.add(rim);
  const root = new THREE.Group();
  scene.add(root);
  const fallback = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 2), new THREE.MeshStandardMaterial({ color: ${JSON.stringify(base.accent)}, metalness: 0.48, roughness: 0.26, wireframe: false }));
  root.add(fallback);
  const loader = new GLTFLoader();
  const modelSrc = canvas.getAttribute('data-model-src') || '';
  if (modelSrc && !modelSrc.includes('{{')) {
    canvas.dataset.prometheusThreeStatus = 'loading';
    loader.load(modelSrc, (gltf) => {
      root.clear();
      const object = gltf.scene || gltf.scenes[0];
      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const scale = 2.7 / Math.max(size.x || 1, size.y || 1, size.z || 1);
      object.position.sub(center);
      object.scale.setScalar(scale);
      root.add(object);
      canvas.dataset.prometheusThreeStatus = 'loaded';
    }, undefined, () => {
      canvas.dataset.prometheusThreeStatus = 'fallback';
    });
  } else {
    canvas.dataset.prometheusThreeStatus = 'fallback';
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 96), new THREE.MeshBasicMaterial({ color: ${JSON.stringify(base.accent)}, transparent: true, opacity: 0.09 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.35;
  scene.add(floor);
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || 1080));
    const h = Math.max(1, Math.round(r.height || 1920));
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function renderAt(seconds) {
    resize();
    const local = Math.max(0, seconds - ${base.start}) * ${base.speed};
    root.rotation.y = local * 0.62;
    root.rotation.x = Math.sin(local * 0.3) * 0.06;
    camera.position.x = Math.sin(local * 0.22) * 0.72;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    if (!canvas.dataset.prometheusThreeStatus) canvas.dataset.prometheusThreeStatus = 'rendered';
  }
  window.addEventListener('prometheus-html-motion-seek', (event) => renderAt(Number(event.detail && event.detail.timeSeconds) || 0));
  renderAt(Number(window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__) || 0);
}`),
  };
}
