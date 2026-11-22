// music.ts: background music from real recorded tracks (CC0, see
// public/music/CREDITS.txt), shuffled one after another.
//
// It plays through its OWN AudioContext, apart from the game engine: the
// games call stopAllSound() all the time, which mutes the engine's output,
// and the music must keep going through that. Volume goes through a
// GainNode (iPhones ignore <audio>.volume).
//
// Two levels: "full" where you read notes, "soft" (half as loud) where you
// listen. Whenever a game plays its own notes, the music dips for that long.

import { PLAYLIST, type Track } from "./playlist";

type Mode = "full" | "soft";

const KEY_ON = "smem:music";
const KEY_VOL = "smem:musicVol";
const DUCK = 0.15; // share of the volume left while a game's notes sound

let ac: AudioContext | null = null;
let gain: GainNode | null = null;
let audio: HTMLAudioElement | null = null;
let order: number[] = [];
let current = -1;
let playsLeft = 0;
let mode: Mode = "full";
let enabled = read(KEY_ON, "on") !== "off";
let volume = Math.max(0, Math.min(1, Number(read(KEY_VOL, "0.6")) || 0));
let duckUntil = 0;
let duckTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

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

function level(): number {
  const v = volume * (mode === "soft" ? 0.5 : 1);
  return performance.now() < duckUntil ? v * DUCK : v;
}
function applyGain(fast = false) {
  if (!ac || !gain) return;
  gain.gain.setTargetAtTime(level(), ac.currentTime, fast ? 0.03 : 0.25);
}

function shuffle() {
  order = PLAYLIST.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
}

function onEnded() {
  if (!audio) return;
  if (playsLeft > 1) {
    playsLeft--;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } else nextTrack();
}

function nextTrack() {
  if (!audio || !PLAYLIST.length) return;
  if (!order.length) shuffle();
  current = order.shift()!;
  playsLeft = PLAYLIST[current].loops;
  audio.src = base() + "music/" + PLAYLIST[current].file;
  audio.play().catch(() => {});
  listeners.forEach((f) => f());
}

function setup(): boolean {
  if (ac) return true;
  if (!PLAYLIST.length) return false;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return false;
  ac = new C();
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", () => setTimeout(nextTrack, 500));
  const src = ac.createMediaElementSource(audio);
  gain = ac.createGain();
  gain.gain.value = level();
  src.connect(gain);
  gain.connect(ac.destination);
  return true;
}

// ---------------------------------------------------------------- API
/** Call from inside a tap or key press (browsers only allow sound after one). */
export function unlockMusic() {
  if (!enabled || !setup()) return;
  if (ac!.state !== "running") ac!.resume().catch(() => {});
  if (current < 0) nextTrack();
  else if (audio!.paused) audio!.play().catch(() => {});
}

export function setMusicMode(m: Mode) {
  mode = m;
  applyGain();
}

/** The game is about to play notes for this long: step aside. */
export function duckMusic(ms: number) {
  duckUntil = Math.max(duckUntil, performance.now() + ms + 150);
  applyGain(true);
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => applyGain(), duckUntil - performance.now() + 20);
}

export function musicOn(): boolean {
  return enabled;
}
export function setMusicOn(on: boolean) {
  enabled = on;
  write(KEY_ON, on ? "on" : "off");
  if (on) unlockMusic();
  else audio?.pause();
  listeners.forEach((f) => f());
}

export function musicVolume(): number {
  return volume;
}
export function setMusicVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  write(KEY_VOL, String(volume));
  applyGain(true);
}

/** Skip to another track. */
export function skipTrack() {
  if (!enabled) return setMusicOn(true);
  if (!setup()) return;
  nextTrack();
}

export function nowPlaying(): Track | null {
  return current >= 0 ? PLAYLIST[current] : null;
}

export function onMusicChange(f: () => void) {
  listeners.add(f);
}

/** Dev/testing. */
export function musicState() {
  return { state: ac?.state ?? "none", playing: !!audio && !audio.paused, track: nowPlaying()?.title ?? null, gain: gain ? Math.round(gain.gain.value * 100) / 100 : null, mode, enabled, volume };
}

// Pause with the tab hidden.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!audio || !enabled) return;
    if (document.hidden) audio.pause();
    else audio.play().catch(() => {});
  });
}
// Dev builds only (removed from the published site): lets tests read the state.
if (import.meta.env && import.meta.env.DEV) (globalThis as unknown as { __music: typeof musicState }).__music = musicState;
