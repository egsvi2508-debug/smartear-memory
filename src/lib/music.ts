// music.ts: background sound, two layers, both made live in the browser:
//   rhythm , an extremely basic drum beat (kick, snare, hi-hat), no melody, endless
//   beach  , waves on a beach: recorded waves (CC0, public/beach) at random
//            moments over a soft sea wash, so it never repeats
// It runs on its OWN AudioContext: the games call stopAllSound() all the time,
// and the background must keep going through that. One steady level, set only
// by the Music volume slider; the games' notes never change it.

export type MusicStyle = "beach" | "rhythm" | "both";

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
let style: MusicStyle = savedStyle === "beach" || savedStyle === "rhythm" ? savedStyle : "both";
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

// ---------------------------------------------------------------- the beats
// 16 steps per bar. x = hit. Kept extremely basic on purpose.
const BEATS = [
  { name: "Basic", bpm: 90, k: "x.......x.......", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." },
  { name: "Four on the floor", bpm: 96, k: "x...x...x...x...", s: "....x.......x...", h: "..x...x...x...x." },
  { name: "Slow", bpm: 76, k: "x.........x.....", s: "........x.......", h: "x...x...x...x..." },
  { name: "Boom bap", bpm: 88, k: "x......x..x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." },
  { name: "Kick and hat", bpm: 100, k: "x.......x.......", s: "................", h: "..x...x...x...x." },
];
let beat = Math.max(0, Math.min(BEATS.length - 1, Number(read(KEY_BEAT, "0")) || 0));

// ---------------------------------------------------------------- audio graph
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let drums: GainNode | null = null;
let sea: GainNode | null = null;
let noise: AudioBuffer | null = null;
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
  sea = ac.createGain();
  sea.gain.value = 1;
  sea.connect(master);
  // 4 s of white noise, shared by the snare, the hi-hat and the sea wash
  noise = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

function kick(t: number) {
  const o = ac!.createOscillator();
  const g = ac!.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g).connect(drums!);
  o.start(t);
  o.stop(t + 0.4);
}
function hiss(t: number, hp: number, len: number, vol: number) {
  const s = ac!.createBufferSource();
  s.buffer = noise;
  const f = ac!.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = ac!.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(drums!);
  s.start(t, Math.random() * 3);
  s.stop(t + len + 0.02);
}

// Step scheduler: looks a little ahead so timing stays tight.
let stepTimer: ReturnType<typeof setInterval> | null = null;
let nextAt = 0;
let step = 0;
function startRhythm() {
  if (stepTimer || !ac) return;
  nextAt = ac.currentTime + 0.1;
  step = 0;
  stepTimer = setInterval(() => {
    const b = BEATS[beat];
    const dt = 60 / b.bpm / 4;
    while (nextAt < ac!.currentTime + 0.15) {
      if (b.k[step] === "x") kick(nextAt);
      if (b.s[step] === "x") hiss(nextAt, 1500, 0.16, 0.45);
      if (b.h[step] === "x") hiss(nextAt, 8000, 0.045, 0.22);
      nextAt += dt;
      step = (step + 1) % 16;
    }
  }, 25);
}
function stopRhythm() {
  if (stepTimer) clearInterval(stepTimer);
  stepTimer = null;
}

// ---------------------------------------------------------------- the beach
let waves: AudioBuffer[] | null = null;
let loadingWaves = false;
let washSrc: AudioBufferSourceNode | null = null;
let washGain: GainNode | null = null;
let waveTimer: ReturnType<typeof setTimeout> | null = null;
let lastWave = -1;

async function loadWaves() {
  if (waves || loadingWaves || !ac) return;
  loadingWaves = true;
  try {
    const got = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map(async (n) => ac!.decodeAudioData(await (await fetch(`${base()}beach/wave-${n}.mp3`)).arrayBuffer())),
    );
    waves = got;
  } catch {
    /* offline: the sea wash alone still plays */
  }
  loadingWaves = false;
}

function playWave() {
  if (!ac || !waves?.length) return;
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
  (p ? g.connect(p) : g).connect(sea!);
  s.start();
}
function scheduleWaves() {
  waveTimer = setTimeout(() => {
    playWave();
    scheduleWaves();
  }, 2500 + Math.random() * 4500);
}

function startBeach() {
  if (washSrc || !ac) return;
  loadWaves().then(() => washSrc && playWave());
  // the wash: low, soft noise that slowly swells and falls like the sea
  washSrc = ac.createBufferSource();
  washSrc.buffer = noise;
  washSrc.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  washGain = ac.createGain();
  washGain.gain.value = 0.12;
  washSrc.connect(lp).connect(washGain).connect(sea!);
  washSrc.start();
  const swell = () => {
    if (!washGain || !ac) return;
    const t = ac.currentTime;
    washGain.gain.cancelScheduledValues(t);
    washGain.gain.setValueAtTime(washGain.gain.value, t);
    washGain.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.14, t + 3 + Math.random() * 4);
  };
  swell();
  const swellTimer = setInterval(() => (washSrc ? swell() : clearInterval(swellTimer)), 6000);
  scheduleWaves();
}
function stopBeach() {
  washSrc?.stop();
  washSrc = null;
  washGain = null;
  if (waveTimer) clearTimeout(waveTimer);
  waveTimer = null;
}

function apply() {
  const on = enabled && ac && ac.state === "running" && !document.hidden;
  if (on && style !== "beach") startRhythm();
  else stopRhythm();
  if (on && style !== "rhythm") startBeach();
  else stopBeach();
}

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

/** Next rhythm (turns the rhythm on if only the beach was playing). */
export function skipTrack() {
  beat = (beat + 1) % BEATS.length;
  write(KEY_BEAT, String(beat));
  if (style === "beach") style = "both";
  if (!enabled) setMusicOn(true);
  else unlockMusic();
  changed();
}

/** What is playing, for the settings panel. */
export function nowPlaying(): string {
  const b = BEATS[beat];
  const r = `${b.name} · ${b.bpm} BPM`;
  return style === "beach" ? "Beach waves" : style === "rhythm" ? r : `Beach waves + ${r}`;
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
    beach: !!washSrc,
    waves: waves?.length ?? 0,
    gain: master ? Math.round(master.gain.value * 100) / 100 : null,
    style,
    enabled,
  });
