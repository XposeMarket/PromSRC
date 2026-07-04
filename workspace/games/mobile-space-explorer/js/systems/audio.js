/** Web Audio — unlock on first user gesture (START / touch). */
let ctx = null;
let burnerGain = null;
let burnerOsc = null;
let burnerNoise = null;

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function ensureBurnerNodes() {
  const ac = unlockAudio();
  if (burnerGain) return;
  burnerGain = ac.createGain();
  burnerGain.gain.value = 0;
  burnerGain.connect(ac.destination);

  burnerOsc = ac.createOscillator();
  burnerOsc.type = 'sawtooth';
  burnerOsc.frequency.value = 72;
  const oscGain = ac.createGain();
  oscGain.gain.value = 0.12;
  burnerOsc.connect(oscGain);
  oscGain.connect(burnerGain);

  const bufferSize = 2 * ac.sampleRate;
  const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  burnerNoise = ac.createBufferSource();
  burnerNoise.buffer = noiseBuffer;
  burnerNoise.loop = true;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.06;
  burnerNoise.connect(noiseGain);
  noiseGain.connect(burnerGain);

  burnerOsc.start();
  burnerNoise.start();
}

export function setBurnerActive(active, dt = 0.016) {
  ensureBurnerNodes();
  const target = active ? 0.55 : 0;
  const k = 1 - Math.pow(0.02, dt);
  burnerGain.gain.value = burnerGain.gain.value * (1 - k) + target * k;
  if (burnerOsc) {
    burnerOsc.frequency.value = active ? 95 + Math.sin(performance.now() * 0.012) * 18 : 60;
  }
}

export function playBlaster() {
  const ac = unlockAudio();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.09);
  gain.gain.setValueAtTime(0.22, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.11);

  const click = ac.createOscillator();
  const cg = ac.createGain();
  click.type = 'triangle';
  click.frequency.setValueAtTime(2400, t);
  cg.gain.setValueAtTime(0.08, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  click.connect(cg);
  cg.connect(ac.destination);
  click.start(t);
  click.stop(t + 0.05);
}

export function playBoardChime() {
  const ac = unlockAudio();
  const t = ac.currentTime;
  [440, 554, 659].forEach((freq, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t + i * 0.06);
    g.gain.linearRampToValueAtTime(0.12, t + i * 0.06 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.35);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t + i * 0.06);
    o.stop(t + i * 0.06 + 0.4);
  });
}