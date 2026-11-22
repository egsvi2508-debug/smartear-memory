// engine.ts — SmartEar's single audio engine (Tone.js, Web Audio clock).
//
// Everything sounds through one master chain: instruments → master volume →
// limiter (-1 dBFS, hearing safety) → speakers. Feedback sounds have their
// own quiet bus and are UNPITCHED (a soft click / a dull thud) so they never
// blur the ear's memory of the question.
//
// All playback is scheduled on the audio clock and returns a schedule
// [{midi, delayMs, durMs}] the UI uses to light keys and notes in sync.
// The function names mirror the original app's audio.js so the carried-over
// modules (memory games, rhythm, register…) keep working unchanged.

import * as Tone from "tone";
const signal = <T,>(value: T) => ({ value });

export type Timbre = "piano" | "epiano" | "organ" | "strings" | "guitar" | "synth" | "choir" | "bass" | OrchestralTimbre;
/** Synthesized orchestral colours (Timbre ID); not offered as the default instrument. */
export type OrchestralTimbre = "flute" | "clarinet" | "brass" | "violin" | "cello" | "marimba";
export const TIMBRES: { id: Timbre; name: string }[] = [
  { id: "piano", name: "Piano" },
  { id: "epiano", name: "Electric piano" },
  { id: "guitar", name: "Guitar" },
  { id: "strings", name: "Strings" },
  { id: "organ", name: "Organ" },
  { id: "choir", name: "Choir" },
  { id: "synth", name: "Synth" },
  { id: "bass", name: "Bass" },
];

export const pianoReady = signal(false);
export const audioUnlocked = signal(false);

let master: Tone.Volume | null = null;
let fxBus: Tone.Volume | null = null;
let limiter: Tone.Limiter | null = null;
let feedbackOn = true;
let masterDb = 0;

function chain(): Tone.Volume {
  if (!master) {
    limiter = new Tone.Limiter(-1).toDestination();
    master = new Tone.Volume(masterDb).connect(limiter);
    fxBus = new Tone.Volume(-6 + masterDb).connect(limiter);
  }
  return master;
}

export function setMasterVolume(db: number) {
  masterDb = db;
  if (master) master.volume.value = db;
  if (fxBus) fxBus.volume.value = -6 + db;
}
/** Game sounds (notes + right/wrong chimes), 0..1. */
export function setGameVolume(v: number) {
  const x = Math.max(0, Math.min(1, v));
  setMasterVolume(x <= 0.001 ? -Infinity : 20 * Math.log10(x));
}
export function setFeedbackSounds(on: boolean) {
  feedbackOn = on;
}

// ---------------------------------------------------------------------------
// Piano (Salamander Grand, CC-BY Alexander Holm) — a sample every minor 3rd.
// Fetched from the Tone.js CDN; the service worker caches it for offline use.
// ---------------------------------------------------------------------------
const SALAMANDER: Record<string, string> = {};
for (let oct = 0; oct <= 7; oct++) {
  const add = (n: string, f: string) => (SALAMANDER[`${n}${oct}`] = `${f}${oct}.mp3`);
  add("A", "A");
  if (oct >= 1) {
    add("C", "C");
    add("D#", "Ds");
    add("F#", "Fs");
  }
}
SALAMANDER["C8"] = "C8.mp3";

let piano: Tone.Sampler | null = null;
let pianoPromise: Promise<void> | null = null;

function createPiano(): Promise<void> {
  if (!pianoPromise) {
    pianoPromise = new Promise<void>((resolve) => {
      piano = new Tone.Sampler({
        urls: SALAMANDER,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        release: 1,
        onload: () => {
          pianoReady.value = true;
          resolve();
        },
        onerror: () => resolve(),
      }).connect(chain());
    });
  }
  return pianoPromise;
}

/** Start downloading the piano at boot (no gesture needed for fetching). */
export function preloadPiano() {
  return createPiano();
}

/** Must run inside a user gesture the first time (autoplay rules). */
export async function ensureAudio(): Promise<void> {
  await Tone.start();
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback"; // iOS: ignore the silent switch
  } catch {
    /* not supported */
  }
  Tone.getDestination().mute = false;
  audioUnlocked.value = true;
  chain();
  await Promise.race([createPiano(), new Promise((r) => setTimeout(r, 8000))]);
}
export const ensureAudioReady = ensureAudio;
export const isAudioLoaded = () => pianoReady.value;

// ---------------------------------------------------------------------------
// Other timbres — synthesized, no downloads, no licences.
// ---------------------------------------------------------------------------
interface Voice {
  trigger(midi: number, dur: number, time: number, vel: number): void;
  releaseAll(): void;
}

const voices = new Map<Timbre, Voice>();

function polyVoice(synth: Tone.PolySynth): Voice {
  return {
    trigger(midi, dur, time, vel) {
      synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), dur, time, vel);
    },
    releaseAll() {
      synth.releaseAll();
    },
  };
}

function buildVoice(t: Timbre): Voice {
  const out = chain();
  switch (t) {
    case "epiano": {
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 8,
        oscillator: { type: "sine" },
        envelope: { attack: 0.004, decay: 1.4, sustain: 0.12, release: 1.2 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.5 },
      });
      s.volume.value = -11;
      s.connect(out);
      return polyVoice(s);
    }
    case "organ": {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "custom", partials: [1, 0.55, 0.35, 0.2, 0.12, 0.06] },
        envelope: { attack: 0.012, decay: 0.08, sustain: 0.92, release: 0.14 },
      });
      s.volume.value = -17;
      s.connect(out);
      return polyVoice(s);
    }
    case "strings": {
      const f = new Tone.Filter(2400, "lowpass").connect(out);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 18 },
        envelope: { attack: 0.22, decay: 0.3, sustain: 0.8, release: 0.9 },
      });
      s.volume.value = -19;
      s.connect(f);
      return polyVoice(s);
    }
    case "synth": {
      const f = new Tone.Filter(3200, "lowpass").connect(out);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsquare", count: 2, spread: 12 },
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.4 },
      });
      s.volume.value = -20;
      s.connect(f);
      return polyVoice(s);
    }
    case "choir": {
      // A sung "ah": a soft sawtooth through two vowel formants.
      const mix = new Tone.Gain(0.9).connect(out);
      const f1 = new Tone.Filter({ type: "bandpass", frequency: 750, Q: 4 }).connect(mix);
      const f2 = new Tone.Filter({ type: "bandpass", frequency: 1180, Q: 5 }).connect(mix);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 3, spread: 25 },
        envelope: { attack: 0.18, decay: 0.2, sustain: 0.85, release: 0.7 },
      });
      s.volume.value = -6;
      s.connect(f1);
      s.connect(f2);
      return polyVoice(s);
    }
    case "bass": {
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "triangle" },
        filter: { Q: 1, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.004, decay: 0.6, sustain: 0.25, release: 0.4 },
        filterEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.2, release: 0.3, baseFrequency: 180, octaves: 2.6 },
      });
      s.volume.value = -6;
      s.connect(out);
      return polyVoice(s);
    }
    case "flute": {
      // Soft sine-ish tone, slow breathy attack, gentle vibrato.
      const vib = new Tone.Vibrato({ frequency: 5, depth: 0.06 }).connect(out);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "custom", partials: [1, 0.22, 0.08, 0.03] },
        envelope: { attack: 0.09, decay: 0.12, sustain: 0.85, release: 0.25 },
      });
      s.volume.value = -9;
      s.connect(vib);
      return polyVoice(s);
    }
    case "clarinet": {
      // Odd harmonics only: the hollow, woody clarinet colour.
      const f = new Tone.Filter(3200, "lowpass").connect(out);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "custom", partials: [1, 0, 0.55, 0, 0.32, 0, 0.18, 0, 0.1] },
        envelope: { attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.18 },
      });
      s.volume.value = -11;
      s.connect(f);
      return polyVoice(s);
    }
    case "brass": {
      // Sawtooth with a filter that opens on every note: the brassy "blat".
      const s = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1.5, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.25 },
        filterEnvelope: { attack: 0.07, decay: 0.3, sustain: 0.6, release: 0.3, baseFrequency: 280, octaves: 3.4 },
      });
      s.volume.value = -14;
      s.connect(out);
      return polyVoice(s);
    }
    case "violin":
    case "cello": {
      // Bowed string: bright saw ensemble, slow bow attack, vibrato.
      const cello = t === "cello";
      const f = new Tone.Filter(cello ? 1600 : 3600, "lowpass").connect(out);
      const vib = new Tone.Vibrato({ frequency: cello ? 4.6 : 5.6, depth: 0.08 }).connect(f);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "fatsawtooth", count: 2, spread: 8 },
        envelope: { attack: cello ? 0.16 : 0.12, decay: 0.2, sustain: 0.85, release: 0.35 },
      });
      s.volume.value = -18;
      s.connect(vib);
      return polyVoice(s);
    }
    case "marimba": {
      // Struck wooden bar: a fast FM ping that dies away.
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 4,
        modulationIndex: 1.6,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.5 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
      });
      s.volume.value = -6;
      s.connect(out);
      return polyVoice(s);
    }
    case "guitar": {
      // Karplus-Strong plucks (PluckSynth is monophonic → a small voice pool).
      const pool: Tone.PluckSynth[] = [];
      for (let i = 0; i < 8; i++) {
        const p = new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3800, resonance: 0.96, release: 1 });
        p.volume.value = -4;
        p.connect(out);
        pool.push(p);
      }
      let next = 0;
      return {
        trigger(midi, dur, time, vel) {
          const p = pool[next];
          next = (next + 1) % pool.length;
          p.volume.setValueAtTime(-4 + 20 * Math.log10(Math.max(0.05, vel)), time);
          p.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), dur, time);
        },
        releaseAll() {
          /* plucks decay naturally */
        },
      };
    }
    case "piano":
    default:
      return {
        trigger(midi, dur, time, vel) {
          // Whole notes by name (exact sample mapping); detuned notes by frequency.
          const pitch = Number.isInteger(midi) ? Tone.Frequency(midi, "midi").toNote() : Tone.Frequency(midi, "midi").toFrequency();
          if (piano && pianoReady.value) piano.triggerAttackRelease(pitch, dur, time, vel);
          else fallbackSynth().triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), dur, time, vel * 0.8);
        },
        releaseAll() {
          piano?.releaseAll();
        },
      };
  }
}

// While the piano downloads (or if it fails), a soft synth piano stands in.
let fallback: Tone.PolySynth | null = null;
function fallbackSynth(): Tone.PolySynth {
  if (!fallback) {
    fallback = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0.4, 0.2, 0.1, 0.05] },
      envelope: { attack: 0.004, decay: 1.2, sustain: 0.05, release: 0.8 },
    });
    fallback.volume.value = -12;
    fallback.connect(chain());
  }
  return fallback;
}

function voiceFor(t: Timbre = "piano"): Voice {
  let v = voices.get(t);
  if (!v) {
    v = buildVoice(t);
    voices.set(t, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Look-ahead scheduler: notes are handed to the audio clock only ~120 ms
// before they sound (25 ms timer), so "stop" can cancel everything that
// hasn't started yet — nothing from an old question leaks into a new one.
// ---------------------------------------------------------------------------
interface Pending {
  time: number;
  fire: (t: number) => void;
}
const HORIZON = 0.12;
let queue: Pending[] = [];
let pumpTimer: ReturnType<typeof setInterval> | null = null;

function pump() {
  const horizon = Tone.now() + HORIZON;
  while (queue.length && queue[0].time <= horizon) {
    const p = queue.shift()!;
    try {
      p.fire(p.time);
    } catch (e) {
      console.warn("[SmartEar] scheduled sound failed", e);
    }
  }
  if (!queue.length && pumpTimer) {
    clearInterval(pumpTimer);
    pumpTimer = null;
  }
}

/** Run `fire(time)` just before `time` (Tone clock seconds). */
export function schedule(time: number, fire: (t: number) => void) {
  if (time <= Tone.now() + HORIZON) {
    fire(time);
    return;
  }
  let i = queue.length;
  while (i > 0 && queue[i - 1].time > time) i--;
  queue.splice(i, 0, { time, fire });
  if (!pumpTimer) pumpTimer = setInterval(pump, 25);
}

/** Forget everything scheduled that hasn't sounded yet. */
export function cancelScheduled() {
  queue = [];
  if (pumpTimer) {
    clearInterval(pumpTimer);
    pumpTimer = null;
  }
}

/** The instrument bus (for extra sound sources such as drums and noise). */
export function masterOut(): Tone.Volume {
  return chain();
}

let insert: Tone.ToneAudioNode[] | null = null;
/** Put processing (EQ Ears) between the instruments and the limiter; null removes it. */
export function setMasterInsert(nodes: Tone.ToneAudioNode[] | null) {
  const m = chain();
  m.disconnect();
  if (insert) insert.forEach((n) => n.disconnect());
  insert = nodes && nodes.length ? nodes : null;
  if (insert) {
    m.connect(insert[0]);
    for (let i = 0; i < insert.length - 1; i++) insert[i].connect(insert[i + 1]);
    insert[insert.length - 1].connect(limiter!);
  } else m.connect(limiter!);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
export interface ScheduleItem {
  midi: number;
  delayMs: number;
  durMs: number;
}
export interface PlayOpts {
  mode?: "harmonic" | "melodic";
  noteDur?: number;
  gap?: number;
  humanize?: boolean;
  phrase?: boolean;
  velocity?: number | null;
  timbre?: Timbre;
  /** Seconds from now (default 0.05 lead-in). */
  at?: number;
}

let defaultTimbre: Timbre = "piano";
export function setDefaultTimbre(t: Timbre) {
  defaultTimbre = t;
}
export function getDefaultTimbre(): Timbre {
  return defaultTimbre;
}

/** Called with the length (ms) of every question sound, so background music can step aside. */
export const playListeners = new Set<(ms: number) => void>();
function notifyPlay(ms: number) {
  playListeners.forEach((f) => {
    try {
      f(ms);
    } catch {
      /* ignore */
    }
  });
}

export function playNotes(midis: number[], opts: PlayOpts = {}): ScheduleItem[] {
  const { mode = "harmonic", noteDur = 1.6, gap = 0.75, humanize = false, phrase = false, velocity = null } = opts;
  const timbre = opts.timbre ?? defaultTimbre;
  if (!audioUnlocked.value) return [];
  const voice = voiceFor(timbre);
  const lead = opts.at ?? 0.05;
  const now = Tone.now() + lead;
  let phraseVel: number[] | null = null;
  if (phrase && mode === "melodic" && midis.length > 1) {
    const lo = Math.min(...midis);
    const hi = Math.max(...midis);
    const span = Math.max(1, hi - lo);
    const n = midis.length;
    phraseVel = midis.map((m, i) => Math.min(0.95, 0.6 + ((m - lo) / span) * 0.16 + Math.sin((i / (n - 1)) * Math.PI) * 0.14));
  }
  let cursor = 0;
  const out = midis.map((m, i) => {
    if (i > 0 && mode === "melodic") cursor += gap;
    const jitter = humanize ? (Math.random() - 0.5) * 0.024 : 0;
    const delay = Math.max(0, cursor + jitter);
    const vel = velocity != null ? velocity : phraseVel ? phraseVel[i] : humanize ? 0.74 + Math.random() * 0.2 : 0.9;
    schedule(now + delay, (t) => voice.trigger(m, noteDur, t, vel));
    return { midi: m, delayMs: (lead + delay) * 1000, durMs: noteDur * 1000 };
  });
  notifyPlay(Math.max(0, ...out.map((x) => x.delayMs + x.durMs)));
  return out;
}

/** A sequence of chords, cleanly separated. Returns total length in ms. */
export function playChords(chords: number[][], { dur = 1, gap = 0.9, velocity = 0.8, timbre }: { dur?: number; gap?: number; velocity?: number; timbre?: Timbre } = {}): number {
  if (!audioUnlocked.value) return 0;
  const voice = voiceFor(timbre ?? defaultTimbre);
  const start = Tone.now() + 0.05;
  chords.forEach((c, i) => schedule(start + i * gap, (t) => c.forEach((m) => voice.trigger(m, dur, t, velocity))));
  return ((chords.length - 1) * gap + dur) * 1000 + 50;
}

/** Multi-voice score: each track is [{beat, durBeats, midi}]. */
export function playScore(tracks: { beat: number; durBeats: number; midi: number }[][], { bpm = 92, timbre }: { bpm?: number; timbre?: Timbre } = {}) {
  if (!audioUnlocked.value) return;
  const voice = voiceFor(timbre ?? defaultTimbre);
  const spb = 60 / bpm;
  const now = Tone.now() + 0.05;
  tracks.forEach((track) =>
    track.forEach(({ beat, durBeats, midi }) => schedule(now + beat * spb, (t) => voice.trigger(midi, Math.max(0.05, durBeats * spb * 0.95), t, 0.8))),
  );
}

export interface TimedNote {
  midi: number;
  /** Start, in beats (or seconds when bpm = 60). */
  beat: number;
  /** Length in beats. */
  dur: number;
  velocity?: number;
}

/** Notes with their own onsets and lengths (melodies with rhythm, chords
 *  under a tune). Returns the schedule for lighting keys/notes. */
export function playTimed(notes: TimedNote[], { bpm = 90, timbre, legato = 0.95, at = 0.05 }: { bpm?: number; timbre?: Timbre; legato?: number; at?: number } = {}): ScheduleItem[] {
  if (!audioUnlocked.value) return [];
  const voice = voiceFor(timbre ?? defaultTimbre);
  const spb = 60 / bpm;
  const now = Tone.now() + at;
  return notes.map((n) => {
    const dur = Math.max(0.05, n.dur * spb * legato);
    schedule(now + n.beat * spb, (t) => voice.trigger(n.midi, dur, t, n.velocity ?? 0.85));
    return { midi: n.midi, delayMs: (at + n.beat * spb) * 1000, durMs: dur * 1000 };
  });
}

/** A wash of filtered noise (Note ID: erases the memory of the last pitch). */
export function playNoiseWash(seconds = 1.8) {
  if (!audioUnlocked.value) return;
  const out = chain();
  const filter = new Tone.Filter({ type: "bandpass", frequency: 400, Q: 0.6 }).connect(out);
  const noise = new Tone.Noise("pink");
  const gain = new Tone.Gain(0).connect(filter);
  noise.connect(gain);
  const t0 = Tone.now() + 0.03;
  noise.start(t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.32, t0 + 0.25);
  gain.gain.setValueAtTime(0.32, t0 + seconds - 0.5);
  gain.gain.linearRampToValueAtTime(0, t0 + seconds);
  filter.frequency.setValueAtTime(250 + Math.random() * 300, t0);
  filter.frequency.exponentialRampToValueAtTime(1500 + Math.random() * 2500, t0 + seconds * 0.6);
  filter.frequency.exponentialRampToValueAtTime(300 + Math.random() * 400, t0 + seconds);
  noise.stop(t0 + seconds + 0.05);
  washNodes.push(noise, gain, filter);
  setTimeout(() => disposeWash([noise, gain, filter]), (seconds + 0.3) * 1000);
}
let washNodes: Tone.ToneAudioNode[] = [];
function disposeWash(nodes: Tone.ToneAudioNode[] = washNodes) {
  nodes.forEach((n) => {
    try {
      n.dispose();
    } catch {
      /* gone */
    }
  });
  washNodes = washNodes.filter((n) => !nodes.includes(n));
}

export function scheduleLength(s: ScheduleItem[]): number {
  return s.length ? Math.max(...s.map((x) => x.delayMs + x.durMs)) : 0;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Feedback sounds — unpitched, quiet, switchable.
// ---------------------------------------------------------------------------
let fxTick: Tone.NoiseSynth | null = null;
let fxThud: Tone.NoiseSynth | null = null;
function ensureFx() {
  chain();
  if (!fxTick) {
    const hp = new Tone.Filter(3500, "highpass").connect(fxBus!);
    fxTick = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 }, volume: -16 }).connect(hp);
    const lp = new Tone.Filter(260, "lowpass").connect(fxBus!);
    fxThud = new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.03 }, volume: -2 }).connect(lp);
  }
}
// The "right!" chime: a quick bright arpeggio. Its pitch is random every
// time, so it can never become a reference note (perfect-pitch work).
let fxBell: Tone.PolySynth | null = null;
function bell(steps: number[], gap: number, vel: number) {
  if (!feedbackOn || !audioUnlocked.value) return;
  chain();
  if (!fxBell) {
    fxBell = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.3 },
      volume: -11,
    }).connect(fxBus!);
  }
  const base = 79 + Math.floor(Math.random() * 7); // G5 .. C#6
  const t = Tone.now() + 0.01;
  steps.forEach((st, i) => fxBell!.triggerAttackRelease(Tone.Frequency(base + st, "midi").toFrequency(), 0.28, t + i * gap, vel * (1 - i * 0.08)));
}
/** A right answer: a little two-note "ding-ding" going up. */
export function playCorrectFx() {
  bell([0, 7], 0.075, 0.75);
}
/** A bigger win (a whole phrase right): a quick rising major arpeggio. */
export function playRewardFx() {
  bell([0, 4, 7, 12], 0.065, 0.85);
}
export function playWrongFx() {
  if (!feedbackOn || !audioUnlocked.value) return;
  ensureFx();
  fxThud!.triggerAttackRelease(0.1, Tone.now());
}
export const playWrongFxAlt = playWrongFx;
export function playDragTickFx() {
  if (!feedbackOn || !audioUnlocked.value) return;
  ensureFx();
  fxTick!.triggerAttackRelease(0.015, Tone.now(), 0.3);
}

// ---------------------------------------------------------------------------
// Rhythm clicks
// ---------------------------------------------------------------------------
let woodHi: Tone.NoiseSynth | null = null;
let woodLo: Tone.NoiseSynth | null = null;
let loFilter: Tone.Filter | null = null;

export async function ensureClickReady() {
  await Tone.start();
  Tone.getDestination().mute = false;
  audioUnlocked.value = true;
  const out = chain();
  if (!woodHi) {
    woodHi = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0003, decay: 0.028, sustain: 0, release: 0.01 }, volume: -8 }).connect(out);
    loFilter = new Tone.Filter(1800, "lowpass").connect(out);
    woodLo = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0003, decay: 0.045, sustain: 0, release: 0.015 }, volume: -13 }).connect(loFilter);
  }
}
export function stopAllClicks() {
  for (const n of [woodHi, woodLo, loFilter]) {
    try {
      n?.dispose();
    } catch {
      /* gone */
    }
  }
  woodHi = woodLo = null;
  loFilter = null;
}
export function tick(time: number, kind: "hi" | "lo" | "acc" = "hi") {
  if (!woodHi || !woodLo) return;
  if (kind === "lo") woodLo.triggerAttackRelease(0.045, time, 0.7);
  else woodHi.triggerAttackRelease(0.03, time, kind === "acc" ? 1 : 0.75);
}
export function audioNow(): number {
  return Tone.now();
}

// ---------------------------------------------------------------------------
// Beat Lab voices
// ---------------------------------------------------------------------------
export const BEAT_SOUNDS = ["click", "thump", "beep", "snap"] as const;
type BeatVoices = Record<(typeof BEAT_SOUNDS)[number], Tone.NoiseSynth | Tone.MembraneSynth | Tone.Synth>;
let beatVoices: BeatVoices | null = null;
export async function ensureBeatVoicesReady() {
  await Tone.start();
  Tone.getDestination().mute = false;
  audioUnlocked.value = true;
  const out = chain();
  if (!beatVoices) {
    beatVoices = {
      click: new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0003, decay: 0.03, sustain: 0, release: 0.01 }, volume: -6 }).connect(out),
      thump: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 }, volume: -4 }).connect(out),
      beep: new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 }, volume: -10 }).connect(out),
      snap: new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.0002, decay: 0.012, sustain: 0, release: 0.005 }, volume: -3 }).connect(out),
    };
  }
}
export function disposeBeatVoices() {
  if (!beatVoices) return;
  Object.values(beatVoices).forEach((v) => {
    try {
      v.dispose();
    } catch {
      /* gone */
    }
  });
  beatVoices = null;
}
export function playBeatSound(name: string, time: number) {
  const v = beatVoices?.[name as keyof BeatVoices];
  if (!v) return;
  if (name === "thump") (v as Tone.MembraneSynth).triggerAttackRelease("C2", 0.12, time);
  else if (name === "beep") (v as Tone.Synth).triggerAttackRelease("A4", 0.08, time);
  else (v as Tone.NoiseSynth).triggerAttackRelease(0.03, time);
}

// ---------------------------------------------------------------------------
// Exclusive playback (Duels): a new play cancels the previous one.
// ---------------------------------------------------------------------------
let exclusiveGen = 0;
let exclusiveTimers: ReturnType<typeof setTimeout>[] = [];
export function stopExclusive() {
  exclusiveGen += 1;
  exclusiveTimers.forEach(clearTimeout);
  exclusiveTimers = [];
  voices.forEach((v) => v.releaseAll());
}
export function playNotesExclusive(midis: number[], { mode = "harmonic", noteDur = 1.6, gap = 0.75, velocity = 0.9 }: PlayOpts = {}) {
  stopExclusive();
  notifyPlay(((mode === "harmonic" ? 0 : (midis.length - 1) * gap) + noteDur) * 1000);
  const gen = exclusiveGen;
  const voice = voiceFor(defaultTimbre);
  midis.forEach((m, i) => {
    const delayMs = mode === "harmonic" ? 0 : i * gap * 1000;
    exclusiveTimers.push(
      setTimeout(() => {
        if (gen !== exclusiveGen) return;
        voice.trigger(m, noteDur, Tone.now() + 0.02, velocity ?? 0.9);
      }, delayMs),
    );
  });
}

// ---------------------------------------------------------------------------
// Shepard-tone chords: each chord tone over 5 octaves with a raised-cosine
// loudness taper, so no bass or top note can be heard, only the quality.
// ---------------------------------------------------------------------------
const SHEP_SPAN = 5;
const SHEP_PLATEAU = 0.4;
export function shepardAmplitude(octaveIdx: number, span = SHEP_SPAN, plateau = SHEP_PLATEAU): number {
  if (span <= 1) return 1;
  const x = octaveIdx / (span - 1);
  if (x > plateau && x < 1 - plateau) return 1;
  const edge = x <= plateau ? x / plateau : (1 - x) / plateau;
  return 0.5 - 0.5 * Math.cos(Math.PI * edge);
}
let shepGen = 0;
let shepNodes: { osc: Tone.Oscillator; gain: Tone.Gain }[] = [];
function disposeShep() {
  shepNodes.forEach(({ osc, gain }) => {
    try {
      osc.dispose();
      gain.dispose();
    } catch {
      /* gone */
    }
  });
  shepNodes = [];
}
export function stopShepardChord() {
  shepGen += 1;
  disposeShep();
}
export async function playShepardChord({ rootMidi, intervals, durationSeconds = 1.8 }: { rootMidi: number; intervals: number[]; durationSeconds?: number }) {
  await Tone.start();
  stopShepardChord();
  const myGen = shepGen;
  const center = (SHEP_SPAN - 1) / 2;
  const partials: { freq: number; amp: number }[] = [];
  for (const iv of intervals)
    for (let o = 0; o < SHEP_SPAN; o++) {
      const midi = rootMidi + iv + 12 * (o - center);
      partials.push({ freq: 440 * Math.pow(2, (midi - 69) / 12), amp: shepardAmplitude(o) });
    }
  const bus = new Tone.Gain(1.1 / partials.length).connect(chain());
  const attack = 0.04;
  const release = 0.35;
  const now = Tone.now() + 0.05;
  shepNodes = partials.map(({ freq, amp }) => {
    const osc = new Tone.Oscillator(freq, "sine");
    const g = new Tone.Gain(0);
    osc.connect(g);
    g.connect(bus);
    osc.start(now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampTo(amp, attack, now);
    g.gain.setValueAtTime(amp, now + durationSeconds - release);
    g.gain.linearRampTo(0, release, now + durationSeconds - release);
    osc.stop(now + durationSeconds + 0.05);
    return { osc, gain: g };
  });
  setTimeout(() => {
    if (myGen === shepGen) disposeShep();
    try {
      bus.dispose();
    } catch {
      /* gone */
    }
  }, (durationSeconds + 0.15) * 1000);
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Kill switch: silence everything immediately (ending a session, leaving a
// screen). Muting the destination also gates notes already committed to the
// audio clock; ensureAudio() un-mutes for the next sound.
// ---------------------------------------------------------------------------
export function stopAllSound() {
  cancelScheduled();
  disposeWash();
  stopListeners.forEach((f) => {
    try {
      f();
    } catch {
      /* ignore */
    }
  });
  stopExclusive();
  stopShepardChord();
  stopAllClicks();
  disposeBeatVoices();
  voices.forEach((v) => v.releaseAll());
  fallback?.releaseAll();
  Tone.getDestination().mute = true;
}

const stopListeners = new Set<() => void>();
/** Extra sound sources (drums, drones) register here to be silenced by stopAllSound. */
export function onStopAll(f: () => void): () => void {
  stopListeners.add(f);
  return () => stopListeners.delete(f);
}

/** Un-mute without needing a gesture (after stopAllSound, inside a session). */
export function unmute() {
  if (audioUnlocked.value) Tone.getDestination().mute = false;
}

export { Tone };
