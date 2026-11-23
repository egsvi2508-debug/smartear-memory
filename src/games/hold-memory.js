// hold-memory.js, Pitch Hold: keep one tone in mind.
//
// One tone plays: "keep this tone in mind (without singing it!)". Then, all through the wait, a
// stream of other notes tries to knock it out of your head. Then find the
// tone again on a wide pitch strip: drag or step along it (every step
// sounds) and lock in when it matches what you kept.
//
// This is the retention side of memory: keeping a single trace alive over
// time and through interference, which the span games (how MANY) and Sound
// Pairs (WHERE) don't train.
//
// Levels make the wait longer (4 s → 14 s+) and the interference much
// heavier: from 4 other notes at level 1 to 56 at level 10 (about four a
// second), closer and closer to the tone, in chords from level 4, and from
// level 6 a decoy a semitone away just before you answer. The tone itself
// never sounds again until the answer. The strip carries no note names
// while you search, only after the answer.

import { pitchName } from "../lib/theory";
import { getNoteSystem } from "../lib/prefs";
import { ensureAudioReady, playNotes, playNotesExclusive, stopAllSound } from "../lib/engine";
import { openMemoryGame, el, randInt } from "./memory-kit.js";

export const meta = {
  id: "hold-memory",
  name: "Pitch Hold",
  blurb: "Hear one note, hold it in mind through the wait, then find it again.",
  selfGuided: true,
};

const READY_MS = 500;

// [hold seconds, other notes, how close they come (semitones), chance of a chord]
const LEVELS = [
  [4, 4, 7, 0],
  [5, 7, 6, 0],
  [6, 10, 5, 0],
  [7, 14, 5, 0.15],
  [8, 18, 4, 0.2],
  [9, 24, 4, 0.25],
  [10, 30, 3, 0.3],
  [11, 36, 3, 0.35],
  [12, 44, 2, 0.4],
  [14, 56, 2, 0.45],
];

function holdSpec(level) {
  const top = LEVELS.length;
  const [holdSec, notes, near, chords] = level <= top ? LEVELS[level - 1] : [14 + (level - top) * 2, 56 + (level - top) * 8, 2, 0.5];
  const span = level <= 2 ? 7 : level <= 5 ? 12 : level <= 8 ? 16 : 19;
  return { holdMs: holdSec * 1000, holdSec, span, notes, near, chords, decoy: level >= 6 };
}

/** The interference: when each other note sounds, its pitches, length and loudness. */
function distractorPlan(spec, rng, target) {
  const from = 700;
  const to = spec.holdMs - (spec.decoy ? 1300 : 450);
  const away = (m) => (m === target ? m + (rng() < 0.5 ? 1 : -1) : m);
  const plan = [];
  let prev = target + (rng() < 0.5 ? 2 : -2);
  for (let i = 0; i < spec.notes; i++) {
    const at = from + ((to - from) * (i + rng() * 0.85)) / spec.notes;
    let m;
    const r = rng();
    if (r < 0.45) m = prev + (rng() < 0.5 ? -1 : 1) * randInt(rng, 1, 2); // creeping by step
    else if (r < 0.85) m = target + (rng() < 0.5 ? -1 : 1) * randInt(rng, 1, spec.near); // close to the tone
    else m = target + randInt(rng, -9, 9); // a leap
    m = away(Math.max(target - 12, Math.min(target + 12, m)));
    prev = m;
    const midis = [m];
    if (rng() < spec.chords) {
      midis.push(away(m + (rng() < 0.5 ? -1 : 1) * randInt(rng, 2, 4)));
      if (spec.near <= 3 && rng() < 0.4) midis.push(away(m + (rng() < 0.5 ? -1 : 1) * randInt(rng, 5, 7)));
    }
    const gap = (to - from) / spec.notes / 1000;
    plan.push({ at, midis: [...new Set(midis)], dur: Math.max(0.2, Math.min(0.75, gap * 1.2)), vel: 0.55 + rng() * (spec.near <= 3 ? 0.4 : 0.3) });
  }
  // The decoy: a held note a semitone off, right before you answer.
  if (spec.decoy) plan.push({ at: spec.holdMs - 1100, midis: [target + (rng() < 0.5 ? 1 : -1)], dur: 0.9, vel: 0.9 });
  return plan;
}

const LETTERS = [["C", 0], ["C", 1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
function name(m) {
  const [letter, alter] = LETTERS[((m % 12) + 12) % 12];
  return pitchName({ letter, alter }, Math.floor(m / 12) - 1, getNoteSystem());
}

const TIPS = [
  "Keep the tone alive in your head the whole way through the wait, without humming or singing it.",
  "Before you search, “hear” it once more in your head. Then move slowly, one step at a time.",
  "Stop the moment it matches. Going past and back again blurs the memory.",
  "Give the tone a colour: bright or dark, high or low? A label holds better than a hum.",
];
const DISTRACTOR_TIP = "Memory for pitch drifts toward the notes around it, and the last one (the decoy) pulls hardest. Keep hearing yours inside (without singing it) and don't follow them.";
function tipFor(i) {
  // Every other tip is about the interference.
  return i % 2 === 1 ? DISTRACTOR_TIP : TIPS[i % TIPS.length];
}

function createRunner(ctx) {
  const { run, rng } = ctx;

  // Stage: the breathing orb, then the strip.
  const say = el("div", "ph-say", "");
  const orb = el("div", "ph-orb");
  const orbCore = el("div", "ph-orb-core");
  const orbText = el("div", "ph-orb-text", "");
  orb.append(orbCore, orbText);
  const strip = el("div", "ph-strip");
  const track = el("div", "ph-track");
  const thumb = el("div", "ph-thumb");
  strip.append(track);
  ctx.stage.append(say, orb, strip);

  const row = el("div", "mk-row center ph-controls");
  row.dataset.show = "recall";
  const down = el("button", "mk-btn ghost ph-step", "◀");
  down.setAttribute("aria-label", "One step lower");
  const hear = el("button", "mk-btn ghost", "Hear");
  const up = el("button", "mk-btn ghost ph-step", "▶");
  up.setAttribute("aria-label", "One step higher");
  const lock = el("button", "mk-btn primary", "Lock in");
  row.append(down, hear, up, lock);
  const hint = el("div", "mk-hint");
  hint.dataset.show = "recall";
  hint.innerHTML = '<span>Drag along the strip, every step sounds</span><span class="mk-keys-only"> · <kbd>←</kbd><kbd>→</kbd> step · <kbd>Space</kbd> hear · <kbd>Enter</kbd> lock</span>';
  ctx.controls.append(row, hint);

  let spec = null;
  let target = 60;
  let lo = 55;
  let pos = 0; // current strip position (midi)
  let roundIndex = 0;
  let dragging = false;

  // Exclusive: each step on the strip cuts the last one, so the pitch you
  // stop on is heard clean rather than smeared with its neighbours.
  async function play(m, dur = 0.9, velocity = 1) {
    try {
      await ensureAudioReady();
      if (ctx.isDestroyed()) return;
      playNotesExclusive([m], { mode: "harmonic", noteDur: dur, velocity });
    } catch {
      /* best-effort */
    }
  }

  function buildTrack() {
    track.innerHTML = "";
    for (let i = 0; i <= spec.span; i++) {
      const t = el("div", "ph-tick");
      t.style.left = `${(i / spec.span) * 100}%`;
      track.appendChild(t);
    }
    track.appendChild(thumb);
  }
  function placeThumb() {
    thumb.style.left = `${((pos - lo) / spec.span) * 100}%`;
  }
  function setPos(m, sound = true) {
    const clamped = Math.max(lo, Math.min(lo + spec.span, m));
    if (clamped === pos && !sound) return;
    const changed = clamped !== pos;
    pos = clamped;
    placeThumb();
    if (sound && changed) play(pos, 0.7);
  }
  function posFromX(x) {
    const r = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
    return lo + Math.round(f * spec.span);
  }

  strip.addEventListener("pointerdown", (e) => {
    if (ctx.phase !== "recall") return;
    e.preventDefault();
    dragging = true;
    try {
      strip.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const m = posFromX(e.clientX);
    if (m === pos) play(pos, 0.7);
    else setPos(m);
  });
  strip.addEventListener("pointermove", (e) => {
    if (!dragging || ctx.phase !== "recall") return;
    setPos(posFromX(e.clientX));
  });
  const stopDrag = () => (dragging = false);
  strip.addEventListener("pointerup", stopDrag);
  strip.addEventListener("pointercancel", stopDrag);

  down.addEventListener("click", () => setPos(pos - 1));
  up.addEventListener("click", () => setPos(pos + 1));
  hear.addEventListener("click", () => play(pos, 0.9));
  lock.addEventListener("click", () => grade());

  function startRound() {
    roundIndex++;
    spec = holdSpec(run.level);
    target = randInt(rng, 57, 72);
    const offsetInWindow = randInt(rng, 1, spec.span - 1);
    lo = target - offsetInWindow;
    // Start somewhere clearly away from the answer.
    const minAway = Math.min(3, Math.floor(spec.span / 3));
    const options = [];
    for (let m = lo; m <= lo + spec.span; m++) if (Math.abs(m - target) >= minAway) options.push(m);
    pos = options[Math.floor(rng() * options.length)];
    buildTrack();
    placeThumb();
    track.querySelectorAll(".ph-mark").forEach((m) => m.remove());
    strip.classList.remove("show", "ph-revealed");
    orb.className = "ph-orb";
    orbText.textContent = "";
    say.textContent = "";
    ctx.timer.reset(false);
    ctx.setPhase("ready");
    ctx.splash(`Level ${run.level}`, `${spec.holdSec} s · ${spec.notes} other notes${spec.decoy ? " · a decoy" : ""}`);
    ctx.status("Get ready…");
    ctx.pips([]);
    ctx.later(listen, READY_MS);
  }

  function listen() {
    ctx.setPhase("listen");
    orb.className = "ph-orb sounding";
    orbText.textContent = "Listen";
    say.textContent = "Keep this tone in mind (without singing it!)";
    ctx.status("Keep this tone in mind, without singing it");
    play(target, 1.6);
    ctx.later(hold, 1700);
  }

  function hold() {
    orb.className = "ph-orb holding";
    orb.style.setProperty("--hold", `${spec.holdMs}ms`);
    orbText.textContent = "Hold";
    say.textContent = "Keep your tone in mind (without singing it!)";
    ctx.status("Other notes will try to pull you away: keep yours, silently");
    ctx.timer.start(spec.holdMs);
    for (const d of distractorPlan(spec, rng, target)) {
      ctx.later(() => {
        orb.classList.remove("blip");
        void orb.offsetWidth;
        orb.classList.add("blip");
        playNotes(d.midis, { mode: "harmonic", noteDur: d.dur, velocity: d.vel });
      }, d.at);
    }
    ctx.later(find, spec.holdMs);
  }

  function find() {
    ctx.setPhase("recall");
    orb.className = "ph-orb small";
    orbText.textContent = "";
    ctx.timer.reset(false);
    strip.classList.add("show");
    say.textContent = "Now find your tone";
    ctx.status("Find the tone you kept in mind");
  }

  function mark(m, cls, text) {
    const k = el("div", "ph-mark " + cls);
    k.style.left = `${((m - lo) / spec.span) * 100}%`;
    k.appendChild(el("span", "", text));
    track.appendChild(k);
  }

  function grade() {
    if (ctx.phase !== "recall") return;
    dragging = false;
    say.textContent = "";
    const diff = pos - target;
    const success = diff === 0;
    strip.classList.add("ph-revealed");
    if (success) mark(target, "good", name(target));
    else {
      mark(target, "target", name(target));
      mark(pos, "bad", name(pos));
    }
    const a = Math.abs(diff);
    let tip;
    if (success) tip = spec.holdSec >= 6 ? `Kept for ${spec.holdSec} seconds through ${spec.notes} other notes. ${tipFor(roundIndex)}` : `Right on it. ${tipFor(roundIndex)}`;
    else tip = `You were ${a} semitone${a > 1 ? "s" : ""} too ${diff > 0 ? "high" : "low"}. ${tipFor(roundIndex + 1)}`;
    ctx.finishRound({
      success,
      base: 20 + run.level * 4,
      partial: a === 1 ? 6 : 0,
      units: [success ? 1 : 0, 1],
      title: success ? undefined : a === 1 ? "One semitone off" : `${a} semitones off`,
      tip,
      legend: null,
      actions: [
        { label: "Hear the note", key: "t", onClick: () => (stopAllSound(), play(target, 1.2)) },
        ...(success ? [] : [{ label: "Hear yours", key: "y", onClick: () => (stopAllSound(), play(pos, 1.2)) }]),
      ],
    });
  }

  return {
    startRound,
    onKey(e) {
      if (ctx.phase !== "recall") return false;
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowDown") return setPos(pos - 1), true;
      if (k === "ArrowRight" || k === "ArrowUp") return setPos(pos + 1), true;
      if (k === " ") return play(pos, 0.9), true;
      if (k === "Enter") return grade(), true;
      return false;
    },
    destroy() {},
  };
}

const GAME = {
  id: "hold-memory",
  title: "Pitch Hold",
  memoryType: "Keep one tone in mind",
  tagline: "Keep one note in your head through a stream of others, then find it.",
  storageKey: "smartear_hold_memory_v1",
  docId: "hold-memory-progress",
  unitLabel: "Tones kept",
  accuracyLabel: "Tones kept",
  modes: {
    classic: { blurb: "3 lives. Longer waits, more and closer distracting notes." },
    daily: { blurb: "Same notes for everyone today." },
    training: { blurb: "No lives: the level follows you." },
  },
  howTo: [
    ["Listen", "One tone plays. Keep this tone in mind (without singing it!)."],
    ["Hold", "Other notes stream past, closer and denser each level, with a decoy at the end. Keep yours, silently."],
    ["Find", "Drag along the strip (every step sounds) and lock in your tone."],
  ],
  keysHint: "<kbd>←</kbd><kbd>→</kbd> step · <kbd>Space</kbd> hear · <kbd>Enter</kbd> lock in",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
