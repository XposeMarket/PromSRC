export type HtmlMotionAdapterSnippet = {
  id: string;
  name: string;
  category: 'css' | 'waapi' | 'gsap' | 'lottie' | 'three' | 'canvas' | 'html-in-canvas' | 'media';
  description: string;
  bestFor: string;
  html?: string;
  css?: string;
  js: string;
};

const SEEK_HELPER = `function readPrometheusTime(event){
  var detail = event && event.detail || {};
  var ms = Number(detail.timeMs);
  if (!Number.isFinite(ms)) ms = Number(window.__PROMETHEUS_HTML_MOTION_TIME_MS__) || 0;
  return { timeMs: ms, timeSeconds: ms / 1000 };
}`;

export const HTML_MOTION_ADAPTER_SNIPPETS: HtmlMotionAdapterSnippet[] = [
  {
    id: 'css-paused-keyframes',
    name: 'CSS paused keyframes',
    category: 'css',
    description: 'Pause CSS keyframes and let Prometheus set currentTime through the Web Animations API.',
    bestFor: 'Simple opacity, transform, wipe, and caption keyframe effects.',
    css: `.thing{animation:thing-in 1200ms both paused}@keyframes thing-in{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}`,
    js: `<script>(function(){
${SEEK_HELPER}
var root = document.querySelector('[data-role="stage"]') || document;
function seek(event){
  var t = readPrometheusTime(event);
  var animations = root.getAnimations ? root.getAnimations({subtree:true}) : [];
  animations.forEach(function(animation){
    try { animation.pause(); animation.currentTime = Math.max(0, t.timeMs); } catch {}
  });
}
window.addEventListener('prometheus-html-motion-seek', seek);
seek();
})();</script>`,
  },
  {
    id: 'waapi-seek',
    name: 'WAAPI seek adapter',
    category: 'waapi',
    description: 'Create a Web Animations API animation, pause it, and set currentTime from Prometheus time.',
    bestFor: 'Programmatic browser-native animation without GSAP.',
    js: `<script>(function(){
${SEEK_HELPER}
var el = document.querySelector('[data-waapi-target]');
if (!el) return;
var startMs = 0;
var animation = el.animate([
  { opacity: 0, transform: 'scale(.96)' },
  { opacity: 1, transform: 'scale(1)' }
], { duration: 900, fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)' });
animation.pause();
function seek(event){
  var t = readPrometheusTime(event);
  animation.currentTime = Math.max(0, t.timeMs - startMs);
}
window.addEventListener('prometheus-html-motion-seek', seek);
seek();
})();</script>`,
  },
  {
    id: 'gsap-paused-timeline',
    name: 'GSAP paused timeline',
    category: 'gsap',
    description: 'Build one paused GSAP timeline and drive it from Prometheus time.',
    bestFor: 'Complex easing, staggers, and choreographed motion when GSAP is available locally.',
    js: `<script>(function(){
${SEEK_HELPER}
if (!window.gsap) return;
var tl = window.gsap.timeline({ paused: true });
tl.fromTo('[data-gsap-card]', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .7, ease: 'power3.out' }, 0);
window.__timelines = window.__timelines || {};
window.__timelines.prometheusMain = tl;
function seek(event){
  var t = readPrometheusTime(event);
  tl.time(t.timeSeconds, false);
}
window.addEventListener('prometheus-html-motion-seek', seek);
seek();
})();</script>`,
  },
  {
    id: 'lottie-frame-seek',
    name: 'Lottie frame seek',
    category: 'lottie',
    description: 'Pause Lottie and seek to a deterministic frame from Prometheus time.',
    bestFor: 'Imported local Lottie JSON animations.',
    js: `<script>(function(){
${SEEK_HELPER}
if (!window.lottie) return;
var fps = 30;
var anim = window.lottie.loadAnimation({
  container: document.querySelector('[data-lottie]'),
  renderer: 'svg',
  loop: false,
  autoplay: false,
  path: '{{asset.lottie}}'
});
function seek(event){
  var t = readPrometheusTime(event);
  anim.goToAndStop(Math.round(t.timeSeconds * fps), true);
}
window.addEventListener('prometheus-html-motion-seek', seek);
anim.addEventListener('DOMLoaded', function(){ seek(); });
})();</script>`,
  },
  {
    id: 'three-render-time',
    name: 'Three.js render from time',
    category: 'three',
    description: 'Render a Three.js scene from Prometheus time instead of requestAnimationFrame.',
    bestFor: '3D product objects, abstract fields, and shader-like scenes.',
    js: `<script>(function(){
${SEEK_HELPER}
if (!window.THREE) return;
var canvas = document.querySelector('[data-three-canvas]');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
camera.position.z = 4;
var mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
scene.add(mesh);
function render(event){
  var t = readPrometheusTime(event);
  var rect = canvas.getBoundingClientRect();
  var w = Math.max(1, Math.round(rect.width));
  var h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  mesh.rotation.x = t.timeSeconds * .7;
  mesh.rotation.y = t.timeSeconds * 1.1;
  renderer.render(scene, camera);
}
window.addEventListener('prometheus-html-motion-seek', render);
render();
})();</script>`,
  },
  {
    id: 'canvas-redraw',
    name: 'Canvas redraw from time',
    category: 'canvas',
    description: 'Clear and redraw a 2D canvas exactly from the requested Prometheus timestamp.',
    bestFor: 'Particles, waveforms, ASCII layers, charts, and procedural effects.',
    js: `<script>(function(){
${SEEK_HELPER}
var canvas = document.querySelector('[data-canvas-effect]');
if (!canvas) return;
var ctx = canvas.getContext('2d');
function draw(event){
  var t = readPrometheusTime(event);
  var rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(canvas.width * (.5 + Math.sin(t.timeSeconds) * .25), canvas.height * .5, 42, 0, Math.PI * 2);
  ctx.fill();
}
window.addEventListener('prometheus-html-motion-seek', draw);
draw();
})();</script>`,
  },
  {
    id: 'media-seek',
    name: 'Video/audio media seek',
    category: 'media',
    description: 'Pause media and seek source time from data-start plus data-trim-start.',
    bestFor: 'Video footage, narration, music, audiograms, and source-backed overlays.',
    js: `<script>(function(){
${SEEK_HELPER}
function parseTime(raw){
  var value = String(raw || '').trim();
  if (!value) return 0;
  var n = Number(value.replace(/ms$/i, '').replace(/s$/i, ''));
  if (!Number.isFinite(n)) return 0;
  if (/s$/i.test(value)) return n * 1000;
  return n;
}
function seek(event){
  var t = readPrometheusTime(event);
  document.querySelectorAll('video,audio').forEach(function(node){
    var start = parseTime(node.getAttribute('data-start'));
    var trim = parseTime(node.getAttribute('data-trim-start') || node.getAttribute('data-offset'));
    var target = Math.max(0, (t.timeMs - start + trim) / 1000);
    try {
      node.pause();
      if (Math.abs((Number(node.currentTime) || 0) - target) > .04) node.currentTime = target;
    } catch {}
  });
}
window.addEventListener('prometheus-html-motion-seek', seek);
seek();
})();</script>`,
  },
  {
    id: 'html-in-canvas-dom-texture',
    name: 'HTML-in-Canvas DOM texture',
    category: 'html-in-canvas',
    description: 'Experimental WICG HTML-in-Canvas adapter: draw a real DOM subtree into canvas when drawElementImage is available, otherwise leave the DOM fallback visible.',
    bestFor: 'Shader-like transitions, DOM caption cards as canvas textures, 3D/product surfaces, and future browser-native DOM-to-canvas export experiments.',
    html: `<canvas data-html-in-canvas-stage layoutsubtree>
  <article data-html-canvas-source>
    <h2>HTML texture</h2>
    <p>Real DOM when supported, normal HTML fallback otherwise.</p>
  </article>
</canvas>`,
    css: `[data-html-in-canvas-stage]{position:absolute;inset:0;width:100%;height:100%;display:block}
[data-html-canvas-source]{position:absolute;left:80px;top:80px;width:560px;padding:34px;border-radius:24px;background:#fff;color:#111827;font:700 24px/1.25 Inter,system-ui,sans-serif;box-shadow:0 22px 70px rgba(2,6,23,.25)}
[data-html-in-canvas-stage][data-prometheus-html-in-canvas-supported="true"] [data-html-canvas-source]{opacity:0;pointer-events:none}`,
    js: `<script>(function(){
${SEEK_HELPER}
var canvas = document.querySelector('[data-html-in-canvas-stage]');
if (!canvas) return;
var ctx = canvas.getContext('2d');
var source = canvas.querySelector('[data-html-canvas-source]');
var supported = !!(ctx && source && typeof ctx.drawElementImage === 'function');
canvas.setAttribute('data-prometheus-html-in-canvas-supported', supported ? 'true' : 'false');
function resize(){
  var rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
}
async function draw(event){
  resize();
  if (!supported) return;
  var t = readPrometheusTime(event);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.filter = 'blur(' + (Math.sin(t.timeSeconds * 2) * 4 + 4).toFixed(2) + 'px)';
  try {
    await ctx.drawElementImage(source, 80 + Math.sin(t.timeSeconds) * 24, 80);
  } catch {
    canvas.setAttribute('data-prometheus-html-in-canvas-supported', 'false');
  }
  ctx.restore();
}
window.addEventListener('prometheus-html-motion-seek', draw);
draw();
})();</script>`,
  },
];

export function listHtmlMotionAdapterSnippets(filters: { category?: string; query?: string } = {}) {
  const category = String(filters.category || '').trim().toLowerCase();
  const query = String(filters.query || '').trim().toLowerCase();
  return HTML_MOTION_ADAPTER_SNIPPETS.filter((snippet) => {
    if (category && snippet.category !== category) return false;
    if (!query) return true;
    return [snippet.id, snippet.name, snippet.category, snippet.description, snippet.bestFor]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}
