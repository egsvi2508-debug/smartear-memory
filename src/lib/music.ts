// music.ts: background sound, two layers, both made live in the browser:
//   beat     , an extremely basic drum beat, no melody, endless
//   ambience , the sound of the chosen scene (scenes.ts): beach waves, forest
//              birds, rain on a city, wind on snowy peaks, desert crickets,
//              deep space. Random moments over a soft bed, so it never repeats.
// Every scene has its own beat too; "Next rhythm" steps through all of them.
// Nothing pitched in the ambience (no bells, no pads): it must never get in
// the way of the notes the games ask you to hear.
// It runs on its OWN AudioContext: the games call stopAllSound() all the time,
// and the background must keep going through that. One steady level, set only
// by the Music volume slider; the games' notes never change it.

import { sceneId, sceneName, onSceneChange, type SceneId } from "./scenes";

export type MusicStyle = "ambience" | "rhythm" | "both";

const KEY_ON = "smem:music";
const KEY_VOL = "smem:musicVol2";
const KEY_STYLE = "smem:bgStyle";
const KEY_BEAT = "smem:beat";

function read(k: string, d: string): string {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
const base = () => (import.meta.env.BASE_URL || "./").replace(/\/?$/, "/");

let enabled = read(KEY_ON, "on") !== "off";
let volume = Math.max(0, Math.min(1, Number(read(KEY_VOL, "0.4")) || 0));
const savedStyle = read(KEY_STYLE, "both");
let style: MusicStyle = savedStyle === "beach" || savedStyle === "ambience" ? "ambience" : savedStyle === "rhythm" ? "rhythm" : "both";
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

// ---------------------------------------------------------------- the beats
// 16 steps per bar. x = hit. Kept extremely basic on purpose.
// s = the backbeat, played by `snare` (noise snare, wood block, brush, clap);
// t = low tom; swing pushes every second 16th late; crackle = vinyl dust.
type Snare = "snare" | "soft" | "wood" | "brush" | "clap";
type Beat = { name: string; bpm: number; k: string; s: string; h: string; t?: string; snare?: Snare; kick?: [number, number]; swing?: number; crackle?: boolean; scene?: SceneId };
const BEATS: Beat[] = [
  { name: "Basic", bpm: 90, k: "x.......x.......", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", scene: "beach" },
  { name: "Forest walk", bpm: 84, k: "x.......x.......", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", snare: "wood", swing: 0.08, scene: "forest" },
  { name: "Rainy lo-fi", bpm: 78, k: "x......x..x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", snare: "soft", swing: 0.16, crackle: true, scene: "city" },
  { name: "Snow steps", bpm: 70, k: "x.........x.....", s: "....x.......x...", h: "x...x...x...x...", snare: "brush", scene: "snow" },
  { name: "Desert drums", bpm: 92, k: "x.......x.......", s: "........x.......", h: "..x...x...x...x.", t: "...x..x....x.x..", scene: "desert" },
  { name: "Orbit", bpm: 104, k: "x...x...x...x...", s: "....x.......x...", h: "..x...x...x...x.", snare: "clap", kick: [110, 36], scene: "space" },
  { name: "Four on the floor", bpm: 96, k: "x...x...x...x...", s: "....x.......x...", h: "..x...x...x...x." },
  { name: "Slow", bpm: 76, k: "x.........x.....", s: "........x.......", h: "x...x...x...x..." },
  { name: "Boom bap", bpm: 88, k: "x......x..x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." },
  { name: "Kick and hat", bpm: 100, k: "x.......x.......", s: "................", h: "..x...x...x...x." },
];
const sceneBeat = () => Math.max(0, BEATS.findIndex((b) => b.scene === sceneId()));
let beat = Math.max(0, Math.min(BEATS.length - 1, Number(read(KEY_BEAT, String(sceneBeat()))) || 0));

// ---------------------------------------------------------------- audio graph
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let drums: GainNode | null = null;
let amb: GainNode | null = null;
let noise: AudioBuffer | null = null;
let dust: AudioBuffer | null = null; // sparse clicks: rain drops, vinyl crackle
const level = () => volume * volume; // squared: fine steps at the quiet end

function setup(): boolean {
  if (ac) return true;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return false;
  ac = new C();
  master = ac.createGain();
  master.gain.value = level();
  master.connect(ac.destination);
  drums = ac.createGain();
  drums.gain.value = 0.55;
  drums.connect(master);
  amb = ac.createGain();
  amb.gain.value = 1;
  amb.connect(master);
  // 4 s of white noise, shared by the drums and every scene
  noise = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 4 s of sparse, tiny clicks
  dust = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
  const c = dust.getChannelData(0);
  for (let n = 0; n < 320; n++) {
    const at = Math.floor(Math.random() * (c.length - 400));
    const a = 0.2 + Math.random() * 0.8;
    for (let i = 0; i < 240; i++) c[at + i] += (Math.random() * 2 - 1) * a * Math.exp(-i / 40);
  }
  return true;
}

// ---------------------------------------------------------------- drum voices
function kick(t: number, f: [number, number] = [140, 45]) {
  const o = ac!.createOscillator();
  const g = ac!.createGain();
  o.frequency.setValueAtTime(f[0], t);
  o.frequency.exponentialRampToValueAtTime(f[1], t + 0.12);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g).connect(drums!);
  o.start(t);
  o.stop(t + 0.4);
}
function hiss(t: number, hp: number, len: number, vol: number, type: BiquadFilterType = "highpass", attack = 0) {
  const s = ac!.createBufferSource();
  s.buffer = noise;
  const f = ac!.createBiquadFilter();
  f.type = type;
  f.frequency.value = hp;
  const g = ac!.createGain();
  if (attack) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
  } else g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(drums!);
  s.start(t, Math.random() * 3);
  s.stop(t + len + 0.02);
}
function wood(t: number) {
  const o = ac!.createOscillator();
  const g = ac!.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g).connect(drums!);
  o.start(t);
  o.stop(t + 0.1);
}
function tom(t: number) {
  const o = ac!.createOscillator();
  const g = ac!.createGain();
  o.frequency.setValueAtTime(125, t);
  o.frequency.exponentialRampToValueAtTime(82, t + 0.2);
  g.gain.setValueAtTime(0.75, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(g).connect(drums!);
  o.start(t);
  o.stop(t + 0.36);
}
function backbeat(t: number, kind: Snare) {
  if (kind === "wood") return wood(t);
  if (kind === "soft") return hiss(t, 1200, 0.2, 0.3);
  if (kind === "brush") return hiss(t, 2500, 0.24, 0.28, "bandpass", 0.02);
  if (kind === "clap") {
    for (const d of [0, 0.011, 0.022]) hiss(t + d, 1300, 0.03, 0.4, "bandpass");
    return hiss(t + 0.03, 1300, 0.14, 0.3, "bandpass");
  }
  hiss(t, 1500, 0.16, 0.45);
}

// Step scheduler: looks a little ahead so timing stays tight.
let stepTimer: ReturnType<typeof setInterval> | null = null;
let crackleSrc: AudioBufferSourceNode | null = null;
let nextAt = 0;
let step = 0;
function startRhythm() {
  if (stepTimer || !ac) return;
  nextAt = ac.currentTime + 0.1;
  step = 0;
  if (BEATS[beat].crackle) {
    crackleSrc = ac.createBufferSource();
    crackleSrc.buffer = dust;
    crackleSrc.loop = true;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2500;
    const g = ac.createGain();
    g.gain.value = 0.18;
    crackleSrc.connect(f).connect(g).connect(drums!);
    crackleSrc.start();
  }
  stepTimer = setInterval(() => {
    const b = BEATS[beat];
    const dt = 60 / b.bpm / 4;
    while (nextAt < ac!.currentTime + 0.15) {
      const t = nextAt + (step % 2 ? (b.swing || 0) * dt * 2 : 0);
      if (b.k[step] === "x") kick(t, b.kick);
      if (b.s[step] === "x") backbeat(t, b.snare || "snare");
      if (b.h[step] === "x") hiss(t, 8000, 0.045, b.snare === "brush" ? 0.12 : 0.22);
      if (b.t?.[step] === "x") tom(t);
      nextAt += dt;
      step = (step + 1) % 16;
    }
  }, 25);
}
function stopRhythm() {
  if (stepTimer) clearInterval(stepTimer);
  stepTimer = null;
  crackleSrc?.stop();
  crackleSrc = null;
}

// ---------------------------------------------------------------- ambience
// Each scene builds its sound out of a few pieces and returns how to stop it.
type Stop = () => void;
let stopAmb: Stop | null = null;
let ambScene: SceneId | null = null;

function kit() {
  const stops: Stop[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  return {
    rand,
    /** Endless filtered noise (wind, rain, sea wash, rumble). */
    bed(type: BiquadFilterType, freq: number, q: number, gain: number, buf = noise) {
      const s = ac!.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const f = ac!.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac!.createGain();
      g.gain.value = gain;
      s.connect(f).connect(g).connect(amb!);
      s.start(0, Math.random() * 3);
      stops.push(() => s.stop());
      return { f, g };
    },
    /** Glide a value to a new random spot every so often. */
    drift(p: AudioParam, lo: number, hi: number, every: number) {
      const go = () => {
        const t = ac!.currentTime;
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(rand(lo, hi), t + every / 1000);
      };
      go();
      const id = setInterval(go, every);
      stops.push(() => clearInterval(id));
    },
    /** Run fn at random moments, between a and b ms apart. */
    every(a: number, b: number, fn: () => void) {
      const loop = () => {
        timers.push(
          setTimeout(() => {
            fn();
            loop();
          }, rand(a, b)),
        );
      };
      loop();
    },
    /** A one-off noise swell (gust, whoosh, thunder). */
    swell(type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, up: number, down: number, pan = 0) {
      const t = ac!.currentTime;
      const s = ac!.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      const f = ac!.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + up + down);
      const g = ac!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + up);
      g.gain.linearRampToValueAtTime(0.0001, t + up + down);
      const p = "createStereoPanner" in ac! ? ac!.createStereoPanner() : null;
      if (p) {
        p.pan.setValueAtTime(-pan, t);
        p.pan.linearRampToValueAtTime(pan, t + up + down);
      }
      s.connect(f).connect(g);
      (p ? g.connect(p) : g).connect(amb!);
      s.start(t, Math.random() * 3);
      s.stop(t + up + down + 0.1);
    },
    /** A short sine blip (birds, crickets), far above the notes the games use. */
    chirp(t: number, f0: number, f1: number, len: number, vol: number, pan: number) {
      const o = ac!.createOscillator();
      const g = ac!.createGain();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, len / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const p = "createStereoPanner" in ac! ? ac!.createStereoPanner() : null;
      if (p) p.pan.value = pan;
      o.connect(g);
      (p ? g.connect(p) : g).connect(amb!);
      o.start(t);
      o.stop(t + len + 0.02);
    },
    stop() {
      timers.forEach(clearTimeout);
      stops.forEach((f) => f());
    },
  };
}

// The beach: recorded waves (CC0, public/beach) at random moments over a sea wash.
let waves: AudioBuffer[] | null = null;
let loadingWaves = false;
let lastWave = -1;
async function loadWaves() {
  if (waves || loadingWaves || !ac) return;
  loadingWaves = true;
  try {
    waves = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (n) => ac!.decodeAudioData(await (await fetch(`${base()}beach/wave-${n}.mp3`)).arrayBuffer())));
  } catch {
    /* offline: the sea wash alone still plays */
  }
  loadingWaves = false;
}
function playWave() {
  if (!ac || !waves?.length || ambScene !== "beach") return;
  let i = Math.floor(Math.random() * waves.length);
  if (i === lastWave) i = (i + 1) % waves.length;
  lastWave = i;
  const s = ac.createBufferSource();
  s.buffer = waves[i];
  s.playbackRate.value = 0.9 + Math.random() * 0.15;
  const g = ac.createGain();
  g.gain.value = 0.55 + Math.random() * 0.45;
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  if (p) p.pan.value = Math.random() * 0.8 - 0.4;
  s.connect(g);
  (p ? g.connect(p) : g).connect(amb!);
  s.start();
}

const AMBIENCE: Record<SceneId, (k: ReturnType<typeof kit>) => void> = {
  beach(k) {
    loadWaves().then(playWave);
    const wash = k.bed("lowpass", 420, 0.7, 0.12);
    k.drift(wash.g.gain, 0.06, 0.2, 6000);
    k.every(2500, 7000, playWave);
  },
  forest(k) {
    const leaves = k.bed("bandpass", 1100, 0.5, 0.05);
    k.drift(leaves.g.gain, 0.02, 0.08, 5000);
    k.bed("lowpass", 300, 0.7, 0.05);
    // birds: little phrases of 2-6 chirps, high up, left or right
    k.every(1400, 5200, () => {
      const t = ac!.currentTime;
      const f = k.rand(2600, 4400);
      const pan = k.rand(-0.8, 0.8);
      const n = 2 + Math.floor(Math.random() * 5);
      const up = Math.random() < 0.5;
      for (let i = 0; i < n; i++) {
        const at = t + i * k.rand(0.09, 0.17);
        const ff = f * k.rand(0.92, 1.08);
        k.chirp(at, ff, up ? ff * 1.35 : ff * 0.75, k.rand(0.05, 0.09), 0.05, pan);
      }
    });
  },
  city(k) {
    k.bed("bandpass", 2600, 0.4, 0.13); // the rain
    const drops = k.bed("highpass", 1500, 0.7, 0.35, dust);
    k.drift(drops.g.gain, 0.2, 0.45, 4000);
    k.bed("lowpass", 160, 0.7, 0.06); // the city far away
    k.every(22000, 48000, () => k.swell("lowpass", 140, 60, 1, 0.45, 0.6, 4.5)); // thunder
  },
  snow(k) {
    const a = k.bed("bandpass", 450, 6, 0.06);
    const b = k.bed("bandpass", 800, 7, 0.04);
    k.drift(a.f.frequency, 260, 700, 4500);
    k.drift(b.f.frequency, 500, 1100, 3500);
    k.drift(a.g.gain, 0.02, 0.09, 4500);
    k.bed("lowpass", 250, 0.7, 0.05);
    k.every(7000, 16000, () => k.swell("bandpass", 600, 1500, 1.2, 0.09, 1.5, 2.8, k.rand(-0.7, 0.7))); // gusts
  },
  desert(k) {
    const wind = k.bed("lowpass", 420, 0.8, 0.06);
    k.drift(wind.g.gain, 0.03, 0.09, 5000);
    // two crickets, each with its own pace and side
    for (const [pace, pan, f] of [[800, -0.6, 4700], [1150, 0.5, 5200]] as const)
      k.every(pace * 0.85, pace * 1.15, () => {
        const t = ac!.currentTime;
        for (let i = 0; i < 4; i++) k.chirp(t + i * 0.045, f, f * 0.98, 0.03, 0.022, pan);
      });
  },
  space(k) {
    const rumble = k.bed("lowpass", 150, 0.8, 0.3);
    k.drift(rumble.g.gain, 0.18, 0.36, 7000);
    const wind = k.bed("bandpass", 600, 9, 0.03); // solar wind
    k.drift(wind.f.frequency, 250, 1800, 6000);
    k.every(9000, 20000, () => k.swell("bandpass", 300, 2600, 2, 0.08, 1.2, 1.6, k.rand(0.5, 0.9))); // a comet passing
  },
};

// How loud each scene's sounds sit, so they all come out about as loud as the beach.
const TRIM: Record<SceneId, number> = { beach: 1, forest: 4, city: 2.2, snow: 3.2, desert: 10, space: 4 };

function startAmbience() {
  if (!ac || stopAmb) return;
  ambScene = sceneId();
  amb!.gain.setValueAtTime(TRIM[ambScene], ac.currentTime);
  const k = kit();
  AMBIENCE[ambScene](k);
  stopAmb = k.stop;
}
function stopAmbience() {
  stopAmb?.();
  stopAmb = null;
  ambScene = null;
}

function apply() {
  const on = enabled && ac && ac.state === "running" && !document.hidden;
  if (on && style !== "ambience") startRhythm();
  else stopRhythm();
  if (on && style !== "rhythm") {
    if (ambScene && ambScene !== sceneId()) stopAmbience();
    startAmbience();
  } else stopAmbience();
}

// A new scene brings its own sound and its own beat.
onSceneChange(() => {
  beat = sceneBeat();
  write(KEY_BEAT, String(beat));
  stopRhythm();
  stopAmbience();
  apply();
  changed();
});

// ---------------------------------------------------------------- API
/** Call from inside a tap or key press (browsers only allow sound after one). */
export function unlockMusic() {
  if (!enabled || !setup()) return;
  if (ac!.state !== "running") ac!.resume().then(apply, () => {});
  else apply();
}

export function musicOn(): boolean {
  return enabled;
}
export function setMusicOn(on: boolean) {
  enabled = on;
  write(KEY_ON, on ? "on" : "off");
  if (on) unlockMusic();
  else apply();
  changed();
}

export function musicVolume(): number {
  return volume;
}
export function setMusicVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  write(KEY_VOL, String(volume));
  if (ac && master) master.gain.setTargetAtTime(level(), ac.currentTime, 0.05);
}

export function musicStyle(): MusicStyle {
  return style;
}
export function setMusicStyle(s: MusicStyle) {
  style = s;
  write(KEY_STYLE, s);
  if (enabled) unlockMusic();
  changed();
}

/** Next rhythm (turns the beat on if only the ambience was playing). */
export function skipTrack() {
  beat = (beat + 1) % BEATS.length;
  write(KEY_BEAT, String(beat));
  if (style === "ambience") style = "both";
  stopRhythm();
  if (!enabled) setMusicOn(true);
  else unlockMusic();
  changed();
}

/** What is playing, for the settings panel. */
export function nowPlaying(): string {
  const b = BEATS[beat];
  const r = `${b.name} · ${b.bpm} BPM`;
  const a = `${sceneName()} sounds`;
  return style === "ambience" ? a : style === "rhythm" ? r : `${a} + ${r}`;
}

export function onMusicChange(f: () => void) {
  listeners.add(f);
}

// Quiet while the tab is hidden.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", apply);

// Dev builds only (removed from the published site): lets tests read the state.
if (import.meta.env && import.meta.env.DEV)
  (globalThis as unknown as { __music: unknown }).__music = () => ({
    state: ac?.state ?? "none",
    rhythm: !!stepTimer,
    beat: BEATS[beat].name,
    ambience: ambScene,
    waves: waves?.length ?? 0,
    gain: master ? Math.round(master.gain.value * 100) / 100 : null,
    style,
    enabled,
  });
