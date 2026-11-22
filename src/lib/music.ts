// music.ts: an original background track, synthesized live in the browser
// (nothing is sampled or licensed, so it is free to use in videos).
//
// It runs on its OWN AudioContext, apart from the game engine: the games
// call stopAllSound() all the time, which mutes the engine's output, and
// the music must keep going through that.
//
// Two levels:
//   "full" , drums, bass, chord stabs and an arpeggio (home, reading games)
//   "beat" , drums only, so no pitches compete with a listening game
// Whenever a game plays its own notes, the music dips for that long.

type Mode = "full" | "beat";

const BPM = 120;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
const KEY = "smem:music";

// vi–IV–I–V in A minor / C major: Am, F, C, G (two bars each in the B part)
const ROOTS = [45, 41, 48, 43]; // A2 F2 C3 G2
const CHORDS = [
  [57, 60, 64],
  [57, 60, 65],
  [55, 60, 64],
  [55, 59, 62],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2]; // chord-tone order for the lead

let ac: AudioContext | null = null;
let out: GainNode | null = null; // music volume (ducking moves this)
let noise: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0; // 16ths since start; 16 per bar, 16 bars per loop
let mode: Mode = "full";
let enabled = readEnabled();
let duckUntil = 0;
const listeners = new Set<(on: boolean) => void>();

const LEVEL = 0.32;
const DUCKED = 0.07;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function setup(): AudioContext | null {
  if (ac) return ac;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ac = new C();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ac.destination);
  out = ac.createGain();
  out.gain.value = LEVEL;
  out.connect(comp);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

// ---------------------------------------------------------------- voices
function env(t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ac!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out!);
  return g;
}

function kick(t: number) {
  const o = ac!.createOscillator();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(env(t, 0.9, 0.003, 0.28));
  o.start(t);
  o.stop(t + 0.32);
}

function noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, decay: number) {
  const s = ac!.createBufferSource();
  s.buffer = noise;
  const f = ac!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  s.connect(f);
  f.connect(env(t, peak, 0.002, decay));
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.05);
}
const snare = (t: number) => {
  noiseHit(t, "bandpass", 1900, 0.45, 0.16);
  const o = ac!.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(220, t);
  o.connect(env(t, 0.18, 0.002, 0.08));
  o.start(t);
  o.stop(t + 0.12);
};
const hat = (t: number, open = false) => noiseHit(t, "highpass", 8000, open ? 0.13 : 0.09, open ? 0.18 : 0.035);

function tone(t: number, midi: number, type: OscillatorType, peak: number, len: number, cutoff: number) {
  const o = ac!.createOscillator();
  o.type = type;
  o.frequency.value = hz(midi);
  const f = ac!.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.35), t + len);
  o.connect(f);
  f.connect(env(t, peak, 0.005, len));
  o.start(t);
  o.stop(t + len + 0.05);
}

// ---------------------------------------------------------------- the song
function playStep(s: number, t: number) {
  const inBar = s % 16;
  const bar = Math.floor(s / 16) % 16; // 16-bar loop: A (8 bars) then B (8 bars)
  const part = bar < 8 ? "A" : "B";
  const chordIx = part === "A" ? bar % 4 : Math.floor((bar - 8) / 2) % 4;
  const fill = bar % 8 === 7 && inBar >= 12;

  // drums
  if (inBar % 4 === 0) kick(t);
  if (part === "B" && inBar === 10) kick(t);
  if (inBar === 4 || inBar === 12) snare(t);
  if (fill && inBar !== 12) snare(t);
  if (inBar % 2 === 0) hat(t, inBar === 14 && bar % 2 === 1);
  else if (part === "B") hat(t);

  if (mode === "beat") return;

  // bass: root on the beat, octave on the off-16ths
  const root = ROOTS[chordIx];
  if ([0, 3, 6, 8, 10, 11, 14].includes(inBar)) tone(t, [3, 11].includes(inBar) ? root + 12 : root, "sawtooth", 0.22, STEP * 1.6, 900);

  // chord stabs on the off-beats
  if (inBar % 4 === 2) CHORDS[chordIx].forEach((m) => tone(t, m, "square", 0.045, STEP * 1.8, 2400));

  // arpeggio lead in the B part
  if (part === "B") {
    const c = CHORDS[chordIx];
    const n = c[ARP[inBar % 8]] + 12;
    tone(t, n, "triangle", 0.07, STEP * 0.9, 5000);
  }
}

function tick() {
  if (!ac || !out) return;
  // ducking: dip while a game's own notes are sounding
  const want = performance.now() < duckUntil ? DUCKED : LEVEL;
  if (Math.abs(out.gain.value - want) > 0.01) out.gain.setTargetAtTime(want, ac.currentTime, want < LEVEL ? 0.03 : 0.25);
  while (nextTime < ac.currentTime + 0.12) {
    playStep(step, nextTime);
    step++;
    nextTime += STEP;
  }
}

function start() {
  if (!ac || timer) return;
  nextTime = ac.currentTime + 0.08;
  step = 0;
  timer = setInterval(tick, 25);
  tick();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------- API
/** Call from inside a tap or key press (browsers only allow sound after one). */
export function unlockMusic() {
  if (!enabled) return;
  const c = setup();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  start();
}

export function setMusicMode(m: Mode) {
  mode = m;
}

/** The game is about to play notes for this long: step aside. */
export function duckMusic(ms: number) {
  duckUntil = Math.max(duckUntil, performance.now() + ms + 150);
  if (ac && out && enabled) out.gain.setTargetAtTime(DUCKED, ac.currentTime, 0.02);
}

export function musicOn(): boolean {
  return enabled;
}

export function setMusicOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (on) unlockMusic();
  else {
    stop();
    ac?.suspend().catch(() => {});
  }
  listeners.forEach((f) => f(on));
}

export function onMusicChange(f: (on: boolean) => void) {
  listeners.add(f);
}

// Pause with the tab hidden (the timer is throttled there anyway).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ac || !enabled) return;
    if (document.hidden) {
      stop();
      ac.suspend().catch(() => {});
    } else {
      ac.resume().catch(() => {});
      start();
    }
  });
}

/** Dev/testing: is it playing, and where in the song. */
export function musicState() {
  return { state: ac?.state ?? "none", step, gain: out ? Math.round(out.gain.value * 100) / 100 : null, mode, enabled };
}

/** Dev/testing: render the song offline to raw samples (for a preview file). */
export async function renderMusic(seconds: number, m: Mode = "full"): Promise<Float32Array> {
  const saved = { ac, out, noise, mode };
  const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  ac = off as unknown as AudioContext;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(off.destination);
  out = off.createGain();
  out.gain.value = LEVEL * 2.2; // louder than in the game, for listening on its own
  out.connect(comp);
  noise = off.createBuffer(1, 44100, 44100);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  mode = m;
  for (let s = 0, t = 0.05; t < seconds; s++, t += STEP) playStep(s, t);
  const buf = await off.startRendering();
  ({ ac, out, noise, mode } = saved);
  return buf.getChannelData(0);
}
