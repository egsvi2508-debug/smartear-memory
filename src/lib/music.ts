// music.ts: background music from real recorded tracks (CC0, see
// public/music/CREDITS.txt), shuffled one after another.
//
// It plays through its OWN AudioContext, apart from the game engine: the
// games call stopAllSound() all the time, which mutes the engine's output,
// and the music must keep going through that. Volume goes through a
// GainNode (iPhones ignore <audio>.volume).
//
// One steady, low level: the game's own notes never change the music's volume.
// Only the Music volume slider does.

import { PLAYLIST, type Track } from "./playlist";

const KEY_ON = "smem:music";
const KEY_VOL = "smem:musicVol2"; // new key: everyone starts at the new, lower default

let ac: AudioContext | null = null;
let gain: GainNode | null = null;
let audio: HTMLAudioElement | null = null;
let order: number[] = [];
let current = -1;
let playsLeft = 0;
let enabled = read(KEY_ON, "on") !== "off";
let volume = Math.max(0, Math.min(1, Number(read(KEY_VOL, "0.4")) || 0));
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

// Squared, so the low end of the slider is fine-grained (ears hear loudness that way).
const level = () => volume * volume;
function applyGain() {
  if (!ac || !gain) return;
  gain.gain.setTargetAtTime(level(), ac.currentTime, 0.05);
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
  // A track that fails to load is skipped; after a few failures in a row (offline), stop trying.
  let fails = 0;
  audio.addEventListener("playing", () => (fails = 0));
  audio.addEventListener("error", () => {
    if (++fails <= 4) setTimeout(nextTrack, 500 * fails);
  });
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
  if (current < 0 || audio!.error) nextTrack(); // first tap, or try again after loading failed
  else if (audio!.paused) audio!.play().catch(() => {});
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
  applyGain();
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
function musicState() {
  return { state: ac?.state ?? "none", playing: !!audio && !audio.paused, track: nowPlaying()?.title ?? null, gain: gain ? Math.round(gain.gain.value * 100) / 100 : null, enabled, volume };
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
