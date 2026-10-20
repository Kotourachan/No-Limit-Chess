// Synthesised sound effects (Web Audio). No audio files, so nothing to download or host.
// Usage: Sound.play('chip', delayMs?). Sounds are scheduled on the audio clock, so a delay is exact.
// Names: move, capture, alert, deal, flip, chip, dealer, check, fold, win, lose, tie.

let ctx = null, master = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('nlc-muted') === '1'; } catch (e) { /* storage can be blocked */ }

function ensure() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
  return ctx;
}

// Browsers only allow audio after a tap or key press, so the first one wakes the engine up.
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
}

// ---- building blocks (t = start time on the audio clock)
function tone(t, { f0, f1 = f0, dur = 0.1, type = 'sine', vol = 0.3, attack = 0.002 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, { dur = 0.08, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, vol = 0.3, attack = 0.003 }) {
  const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt); flt.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
const jit = (x, amt = 0.08) => x * (1 + (Math.random() - 0.5) * 2 * amt);

// ---- the sounds
const SOUNDS = {
  // a piece set down on a wooden board
  move(t) {
    tone(t, { f0: jit(190), f1: 95, dur: 0.09, type: 'triangle', vol: 0.45 });
    noise(t, { dur: 0.03, f0: 1800, q: 0.8, vol: 0.35 });
  },
  // a capture: heavier, with a second knock as the taken piece is swept away
  capture(t) {
    tone(t, { f0: 150, f1: 60, dur: 0.14, type: 'triangle', vol: 0.65 });
    noise(t, { dur: 0.05, f0: 1400, q: 0.7, vol: 0.5 });
    tone(t + 0.1, { f0: jit(210), f1: 110, dur: 0.08, type: 'triangle', vol: 0.3 });
    noise(t + 0.1, { dur: 0.03, f0: 2200, q: 0.8, vol: 0.2 });
  },
  // the CAPTURE banner: a rising sweep and a thud
  alert(t) {
    tone(t, { f0: 90, f1: 55, dur: 0.35, type: 'sine', vol: 0.7 });
    noise(t, { dur: 0.3, type: 'bandpass', f0: 300, f1: 2600, q: 1.2, vol: 0.28, attack: 0.12 });
    tone(t + 0.18, { f0: 520, f1: 780, dur: 0.22, type: 'square', vol: 0.07 });
  },
  // a card slid across felt
  deal(t) {
    noise(t, { dur: 0.1, type: 'bandpass', f0: 1300, f1: 4200, q: 0.9, vol: 0.38, attack: 0.01 });
    noise(t + 0.085, { dur: 0.025, f0: 2600, q: 1, vol: 0.2 });
  },
  flip(t) {
    noise(t, { dur: 0.06, type: 'bandpass', f0: 2200, f1: 3800, q: 1.1, vol: 0.3, attack: 0.008 });
    noise(t + 0.05, { dur: 0.025, f0: 3000, q: 1, vol: 0.18 });
  },
  // one clay chip landing on others
  chip(t) {
    const f = jit(2300, 0.12);
    tone(t, { f0: f, f1: f * 0.92, dur: 0.07, type: 'sine', vol: 0.22 });
    tone(t, { f0: f * 1.55, f1: f * 1.4, dur: 0.045, type: 'sine', vol: 0.12 });
    noise(t, { dur: 0.03, type: 'highpass', f0: 3500, q: 0.7, vol: 0.2 });
  },
  dealer(t) {
    tone(t, { f0: 330, f1: 160, dur: 0.07, type: 'triangle', vol: 0.35 });
    noise(t, { dur: 0.025, f0: 2500, q: 0.8, vol: 0.25 });
    tone(t + 0.07, { f0: 420, f1: 220, dur: 0.06, type: 'triangle', vol: 0.22 });
  },
  // two knuckle taps on the table
  check(t) {
    for (const dt of [0, 0.13]) {
      tone(t + dt, { f0: 170, f1: 105, dur: 0.07, type: 'triangle', vol: 0.5 });
      noise(t + dt, { dur: 0.02, f0: 1200, q: 0.7, vol: 0.25 });
    }
  },
  // cards tossed away
  fold(t) {
    noise(t, { dur: 0.22, type: 'bandpass', f0: 3800, f1: 900, q: 0.8, vol: 0.34, attack: 0.02 });
    noise(t + 0.16, { dur: 0.03, f0: 1500, q: 0.8, vol: 0.18 });
  },
  win(t) {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(t + i * 0.1, { f0: f, dur: 0.35, type: 'triangle', vol: 0.22 }));
  },
  lose(t) {
    [392, 311.13].forEach((f, i) => tone(t + i * 0.16, { f0: f, f1: f * 0.97, dur: 0.4, type: 'triangle', vol: 0.2 }));
  },
  tie(t) {
    tone(t, { f0: 440, dur: 0.3, type: 'triangle', vol: 0.2 });
    tone(t + 0.12, { f0: 440, dur: 0.3, type: 'triangle', vol: 0.12 });
  },
};

export function play(name, delayMs = 0) {
  if (muted) return;
  const fn = SOUNDS[name];
  const c = ensure();
  if (!fn || !c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try { fn(c.currentTime + 0.02 + Math.max(0, delayMs) / 1000); } catch (e) { /* never let audio break the game */ }
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('nlc-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!muted) { unlock(); play('chip'); }
}
