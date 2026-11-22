// memory.js — two "same melody, or did one note change?" games:
//
//   Comparison (id "memory"): the melody plays twice in the SAME key. The
//   difficulty is length and interval size: from 5 notes moving by step to
//   14 notes with leaps up to an octave, faster, and the changed note gets
//   subtler (a 4th away early on; a semitone or tone later, keeping the
//   melody's shape and staying in the scale).
//
//   Relative Memory (id "relative-memory"): the replay is transposed to a
//   new key first (Cuddy, Cohen & Miller 1979, cited in Krumhansl 1983:
//   recognition of a transposed melody gets worse the more distant the new
//   key, so later levels weight the far keys). "The same" means "the same
//   melody, just moved"; only a swapped note counts as a change. Swaps are
//   diatonic → diatonic, chromatic → diatonic or chromatic → chromatic
//   (chromatic tones have the least stable memory, Krumhansl).
//
// Melodies are random walks on the scale in any direction (not a fixed
// rise-and-fall), turning back after big leaps; leaps get bigger and more
// frequent with the level, so big intervals only come in the hard levels.
// Some notes are chromatic passing tones. The first melody stays written on
// the staff as the anchor; if you hear a change, tap the note.

import { MAJOR_SCALE, keySpelling, noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { ensureAudioReady, playNotes, stopAllSound } from "./audio.js";
import { createStaffBoard, spelledOf, spellMidi } from "./staff-board.js";
import { openMemoryGame, el, pick, weightedPick } from "./memory-kit.js";

export const meta = {
  id: "memory",
  name: "Comparison",
  blurb: "Hear a melody, then hear it again: same melody, or did one note change?",
  selfGuided: true,
};

const READY_MS = 800;
const ALTER_CHANCE = 0.55;
const MAJOR_SCALE_SET = new Set(MAJOR_SCALE);

// Transposition intervals grouped by distance around the circle of fifths
// (1 = dominant/subdominant, the closest; 6 = the tritone, the farthest).
const TRANSPOSITIONS_BY_DISTANCE = { 1: [7, 5], 2: [2, 10], 3: [9, 3], 4: [4, 8], 5: [11, 1], 6: [6] };
const IV_NAMES = { 1: "a semitone", 2: "a whole step", 3: "a minor 3rd", 4: "a major 3rd", 5: "a 4th", 6: "a tritone" };

/** Largest leap (in scale steps: 2 = a 3rd … 7 = an octave) per level band. */
const leapFor = (level, bands) => bands[Math.min(bands.length - 1, Math.floor((level - 1) / 2))];

/** Comparison, same key: longer and leapier melodies, subtler changes. */
export function sameKeySpec(level) {
  return {
    len: Math.min(14, 4 + level),
    maxStep: leapFor(level, [2, 3, 4, 5, 7]),
    leapChance: Math.min(0.6, 0.12 + level * 0.05),
    chromatic: level <= 2 ? 0 : level <= 4 ? 0.1 : level <= 7 ? 0.2 : 0.3,
    // How far the changed note moves (semitones), and whether it should keep the shape.
    change: level <= 2 ? [3, 5] : level <= 4 ? [2, 4] : level <= 6 ? [1, 3] : [1, 2],
    keepShape: level >= 7,
    gap: Math.max(0.32, 0.6 - level * 0.02),
  };
}

/** Relative memory: shorter melodies, the key change does the work. */
export function relativeSpec(level) {
  return {
    len: Math.min(12, 5 + Math.floor((level - 1) / 2)),
    maxStep: leapFor(level, [2, 2, 3, 4, 5]),
    leapChance: Math.min(0.5, 0.1 + level * 0.04),
    maxDistance: level <= 2 ? 1 : level <= 4 ? 2 : level <= 6 ? 4 : 6,
    types:
      level <= 2
        ? [{ value: "dd", weight: 1 }]
        : level <= 4
          ? [
              { value: "dd", weight: 0.5 },
              { value: "nd", weight: 0.5 },
            ]
          : [
              { value: "dd", weight: 0.4 },
              { value: "nd", weight: 0.4 },
              { value: "nn", weight: 0.2 },
            ],
    gap: Math.max(0.42, 0.62 - level * 0.015),
    chromatic: level <= 2 ? 0.12 : 0.35,
  };
}

function pickTransposition(rng, maxDistance) {
  const items = [];
  for (let d = 1; d <= maxDistance; d++) items.push({ value: d, weight: d });
  const distance = weightedPick(rng, items);
  const semis = pick(rng, TRANSPOSITIONS_BY_DISTANCE[distance]);
  // Keep the replay in a similar register: more than a tritone up is the
  // same key reached by going down instead.
  return { shift: semis > 6 ? semis - 12 : semis, distance };
}

function nearestOctave(pc, targetMidi) {
  let m = targetMidi - (targetMidi % 12) + pc;
  if (m < targetMidi - 6) m += 12;
  if (m > targetMidi + 6) m -= 12;
  return m;
}
function degreeToMidi(baseMidi, stepIndex) {
  const octave = Math.floor(stepIndex / 7);
  const degree = ((stepIndex % 7) + 7) % 7;
  return baseMidi + octave * 12 + MAJOR_SCALE[degree];
}
function isDiatonic(tonicPc, midi) {
  return MAJOR_SCALE_SET.has((((midi - tonicPc) % 12) + 12) % 12);
}
/** Nearest note to midi of the wanted class (diatonic or not), searching
 *  outward by semitone, never excludeMidi. */
function findNote(tonicPc, midi, { wantDiatonic, excludeMidi }) {
  for (let delta = 1; delta <= 6; delta++) {
    for (const d of [delta, -delta]) {
      const cand = midi + d;
      if (excludeMidi !== undefined && cand === excludeMidi) continue;
      if (isDiatonic(tonicPc, cand) === wantDiatonic) return cand;
    }
  }
  return midi;
}

/** Lowest to highest note of a melody, in scale steps: a 10th + 1, so it
 *  always fits on the treble staff with at most one ledger line. */
const WINDOW = 10;

/** A random melody on the scale (degrees from the tonic): steps and leaps
 *  in any direction, leaps up to `maxStep`, usually turning back after a
 *  big one, never spanning more than WINDOW steps. */
export function randomDegrees(rng, len, maxStep, leapChance) {
  const degs = [pick(rng, [0, 2, 4])];
  let lo = degs[0];
  let hi = degs[0];
  for (let i = 1; i < len; i++) {
    const prev = degs[i - 1];
    let size = maxStep > 1 && rng() < leapChance ? 2 + Math.floor(rng() * (maxStep - 1)) : 1;
    if (rng() < 0.06) size = 0; // now and then a repeated note
    let dir = rng() < 0.5 ? -1 : 1;
    const last = i >= 2 ? degs[i - 1] - degs[i - 2] : 0;
    if (Math.abs(last) >= 3 && rng() < 0.7) dir = -Math.sign(last); // leaps get filled back in
    const fits = (x) => Math.max(hi, x) - Math.min(lo, x) <= WINDOW;
    let next = prev + dir * size;
    if (!fits(next)) next = prev - dir * size;
    if (!fits(next)) next = prev + (prev > (lo + hi) / 2 ? -1 : 1);
    degs.push(next);
    lo = Math.min(lo, next);
    hi = Math.max(hi, next);
  }
  return degs;
}

/** Move a melody (and its key) so it sits on the treble staff, C4 to A5. */
function onStaff(rng, tonicPc, midis) {
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  const sMin = 60 - lo;
  const sMax = 81 - hi;
  const s = sMin <= sMax ? sMin + Math.floor(rng() * (sMax - sMin + 1)) : Math.round((sMin + sMax) / 2);
  return { tonicPc: (((tonicPc + s) % 12) + 12) % 12, midis: midis.map((m) => m + s) };
}

export function buildSequence(rng, spec, needChromatic = false) {
  const tonicPc = Math.floor(rng() * 12);
  const baseMidi = nearestOctave(tonicPc, 64);
  for (let attempt = 0; attempt < 30; attempt++) {
    const midis = randomDegrees(rng, spec.len, spec.maxStep, spec.leapChance).map((d) => degreeToMidi(baseMidi, d));
    for (let i = 1; i < midis.length - 1; i++) {
      if (rng() < spec.chromatic) midis[i] = findNote(tonicPc, midis[i], { wantDiatonic: false });
    }
    const hasD = midis.some((m) => isDiatonic(tonicPc, m));
    const hasN = midis.some((m) => !isDiatonic(tonicPc, m));
    if (hasD && (hasN || !needChromatic)) return onStaff(rng, tonicPc, midis);
  }
  const midis = randomDegrees(rng, spec.len, spec.maxStep, spec.leapChance).map((d) => degreeToMidi(baseMidi, d));
  if (needChromatic) midis[1] = findNote(tonicPc, midis[1], { wantDiatonic: false });
  return onStaff(rng, tonicPc, midis);
}

/** Same key: one note moves `spec.change` semitones (or nothing changes).
 *  Later levels prefer a change that keeps the melody's up/down shape and
 *  stays in the scale, the hardest kind to notice. */
export function buildSameKey(rng, seq, spec) {
  const midis = [...seq.midis];
  if (rng() >= ALTER_CHANCE) return { midis, altered: false, alteredIndex: null, shift: 0 };
  const sgn = (x) => Math.sign(x);
  const options = [];
  for (let i = 0; i < midis.length; i++) {
    for (let d = spec.change[0]; d <= spec.change[1]; d++) {
      for (const m of [midis[i] + d, midis[i] - d]) {
        const prev = midis[i - 1];
        const next = midis[i + 1];
        if (m === prev || m === next) continue;
        const shape = (prev === undefined || sgn(m - prev) === sgn(midis[i] - prev)) && (next === undefined || sgn(next - m) === sgn(next - midis[i]));
        const inKey = isDiatonic(seq.tonicPc, m);
        let w = 1;
        if (spec.keepShape) w *= shape ? 4 : 1;
        if (spec.change[1] <= 3) w *= inKey ? 3 : 1;
        options.push({ value: { i, m, shape }, weight: w });
      }
    }
  }
  const { i, m, shape } = weightedPick(rng, options);
  midis[i] = m;
  return { midis, altered: true, alteredIndex: i, shift: 0, newMidi: m, keptShape: shape };
}

function buildComparison(rng, seq, spec) {
  const { shift, distance } = pickTransposition(rng, spec.maxDistance);
  const tTonic = (((seq.tonicPc + shift) % 12) + 12) % 12;
  const transposed = seq.midis.map((m) => m + shift);
  if (rng() >= ALTER_CHANCE) return { midis: transposed, altered: false, alteredIndex: null, shift, distance };

  let type = weightedPick(rng, spec.types);
  const wantOrigDiatonic = type === "dd";
  let candidates = transposed.map((m, i) => ({ m, i })).filter(({ m }) => isDiatonic(tTonic, m) === wantOrigDiatonic);
  if (!candidates.length) {
    candidates = transposed.map((m, i) => ({ m, i }));
    type = "dd";
  }
  const { m: orig, i: idx } = pick(rng, candidates);
  const newMidi = findNote(tTonic, orig, { wantDiatonic: type !== "nn", excludeMidi: orig });
  const midis = [...transposed];
  midis[idx] = newMidi;
  return { midis, altered: true, alteredIndex: idx, shift, distance, type, newMidi };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function makeRunner(transposed) {
  return (ctx) => createRunner(ctx, transposed);
}

function createRunner(ctx, transposed) {
  const { run, rng } = ctx;
  const board = createStaffBoard(ctx.stage, {
    layout: "treble",
    columns: 5,
    colWidth: 32,
    colMax: 46,
    minWidth: 236,
    head: "black",
    stems: true,
    guides: true,
    maxScale: 1.9,
    onHover: (pos) => {
      if (ctx.phase === "select") board.setActiveColumn(pos ? pos.col : null);
    },
    onSelect: (col) => grade(true, col),
  });

  // Judge controls
  const judgeRow = el("div", "mk-judge");
  judgeRow.dataset.show = "judge";
  const sameBtn = el("button", "mk-btn big same");
  sameBtn.append(el("span", "mk-judge-t", "Same"), el("span", "mk-judge-s", transposed ? "just moved to a new key" : "every note the same"), el("kbd", "mk-kbd-hint", "S"));
  const diffBtn = el("button", "mk-btn big changed");
  diffBtn.append(el("span", "mk-judge-t", "Changed"), el("span", "mk-judge-s", "one note was different"), el("kbd", "mk-kbd-hint", "C"));
  judgeRow.append(sameBtn, diffBtn);

  const selectRow = el("div", "mk-row center");
  selectRow.dataset.show = "select";
  const backBtn = el("button", "mk-btn ghost", "← Back");
  selectRow.append(el("div", "mk-select-hint", "Tap the note that changed"), backBtn);
  ctx.controls.append(judgeRow, selectRow);

  let spec = null;
  let seq = null;
  let comp = null;
  let spelled = [];
  let alterOf = {};
  let selCursor = 0;

  function spellAll(midis) {
    return midis.map((m, i) => ({ ...spellMidi(m, alterOf), col: i }));
  }
  function label(n) {
    return noteLabel(spelledOf(n), getNoteSystem());
  }

  function drawOriginal(cls = "ink", overrides = {}) {
    board.setNotes(spelled.map((n, i) => ({ ...n, cls: overrides[i] || cls })));
  }

  function play(midis, onNote) {
    const schedule = playNotes(midis, { mode: "melodic", noteDur: spec.gap * 2.3, gap: spec.gap, humanize: true, phrase: true });
    midis.forEach((_, i) => ctx.later(() => onNote(i), schedule[i] ? schedule[i].delayMs : i * spec.gap * 1000));
    const last = schedule[schedule.length - 1];
    return last ? last.delayMs + spec.gap * 1000 : midis.length * spec.gap * 1000;
  }

  function startRound() {
    spec = transposed ? relativeSpec(run.level) : sameKeySpec(run.level);
    seq = buildSequence(rng, spec, transposed && spec.types.some((t) => t.value !== "dd"));
    comp = transposed ? buildComparison(rng, seq, spec) : buildSameKey(rng, seq, spec);
    alterOf = {};
    keySpelling(seq.tonicPc, "major").forEach(({ letter, alter }) => (alterOf[letter] = alter));
    spelled = spellAll(seq.midis);
    board.configure({ columns: spec.len });
    board.setInteractive(false);
    board.setActiveColumn(null);
    drawOriginal();
    ctx.timer.reset(false);
    ctx.setPhase("ready");
    ctx.splash(`Level ${run.level}`, `${spec.len} notes`);
    ctx.status("Get ready…");
    ctx.pips(new Array(spec.len).fill(""));
    ctx.later(listenOriginal, READY_MS);
  }

  async function listenOriginal() {
    ctx.setPhase("listen");
    ctx.status("① The melody");
    try {
      // Never let a stuck audio unlock freeze the round.
      await Promise.race([ensureAudioReady(), new Promise((r) => setTimeout(r, 2500))]);
    } catch (err) {
      console.warn("[SmartEar] comparison-memory audio error:", err);
    }
    if (ctx.isDestroyed() || ctx.phase !== "listen") return;
    const ms = play(seq.midis, (i) => {
      drawOriginal("ink", { [i]: "play" });
      ctx.pips(spelled.map((_, j) => (j <= i ? "on" : "")));
    });
    ctx.later(() => {
      drawOriginal();
      ctx.status(transposed ? "② Now in a new key…" : "② Once more…");
      ctx.pips(new Array(spec.len).fill(""));
    }, ms);
    ctx.later(listenReplay, ms + 900);
  }

  function listenReplay() {
    if (ctx.phase !== "listen") return;
    const ms = play(comp.midis, (i) => {
      board.setActiveColumn(i);
      ctx.pips(spelled.map((_, j) => (j <= i ? "on" : "")));
    });
    ctx.later(startJudge, ms + 200);
  }

  function startJudge() {
    board.setActiveColumn(null);
    ctx.pips(new Array(spec.len).fill(""));
    ctx.setPhase("judge");
    ctx.status("Same melody — or did a note change?");
  }

  function startSelect() {
    if (ctx.phase !== "judge") return;
    ctx.setPhase("select");
    selCursor = 0;
    board.setInteractive("select");
    ctx.status("Which note changed?");
  }
  function backToJudge() {
    if (ctx.phase !== "select") return;
    board.setInteractive(false);
    board.setActiveColumn(null);
    startJudge();
  }

  function grade(saidChanged, col = null) {
    if (ctx.phase !== "judge" && ctx.phase !== "select") return;
    board.setInteractive(false);
    board.setActiveColumn(null);
    const correct = saidChanged ? comp.altered && col === comp.alteredIndex : !comp.altered;
    const overrides = {};
    if (comp.altered) overrides[comp.alteredIndex] = correct ? "good" : "missed";
    if (saidChanged && col !== null && col !== comp.alteredIndex) overrides[col] = "bad";
    board.setNotes(spelled.map((n, i) => ({ ...n, cls: overrides[i] || "dim" })), { animate: undefined });

    const tip = transposed ? relativeTip(correct, saidChanged, col) : sameKeyTip(correct, saidChanged, col);
    const legend = [];
    if (comp.altered) legend.push(correct ? ["good", "The note that changed"] : ["missed", "The note that changed"]);
    if (saidChanged && !correct && col !== comp.alteredIndex) legend.push(["bad", "Your pick"]);
    ctx.pips(spelled.map((_, j) => (comp.altered && j === comp.alteredIndex ? (correct ? "good" : "missed") : saidChanged && j === col && !correct ? "bad" : "")));
    ctx.finishRound({
      success: correct,
      base: comp.altered ? 10 + spec.len * 4 : 8 + spec.len * 3,
      partial: 0,
      units: [correct ? 1 : 0, 1],
      title: correct ? (saidChanged ? "Found it" : "Same — well heard") : saidChanged && comp.altered ? "Wrong note" : saidChanged ? "It was the same" : "It changed",
      tip,
      legend,
      actions: [
        { label: "▶ Original", key: "o", onClick: () => replay(seq.midis, false) },
        { label: "▶ Replay", key: "r", onClick: () => replay(comp.midis, true) },
      ],
    });
  }

  function sameKeyTip(correct, saidChanged, col) {
    if (!comp.altered) return saidChanged ? `Nothing changed: note ${col + 1} was the same both times.` : "Nothing changed: the same melody both times.";
    const i = comp.alteredIndex;
    const d = comp.newMidi - seq.midis[i];
    const what = `${label(spelled[i])} became ${label(spellMidi(comp.newMidi, alterOf))} (${Math.abs(d)} semitone${Math.abs(d) > 1 ? "s" : ""} ${d > 0 ? "up" : "down"}${comp.keptShape ? ", same shape" : ""})`;
    if (correct) return `Note ${i + 1}: ${what}.`;
    if (saidChanged) return `Something did change, but it was note ${i + 1}, not note ${col + 1}: ${what}.`;
    return `Note ${i + 1} changed: ${what}. Replay both and listen for it.`;
  }

  function relativeTip(correct, saidChanged, col) {
    const moved = `moved ${comp.shift > 0 ? "up" : "down"} ${IV_NAMES[Math.abs(comp.shift)]}`;
    const far = comp.distance >= 5 ? " — one of the most distant keys, the hardest kind to compare" : comp.distance <= 1 ? " — a closely related key, the easiest kind" : "";
    if (!comp.altered) return saidChanged ? `Nothing changed. Note ${col + 1} only sounded different because the whole melody was ${moved}${far}.` : `Nothing changed — the replay was only ${moved}${far}.`;
    const i = comp.alteredIndex;
    const became = spellMidi(comp.newMidi - comp.shift, alterOf);
    const kind = { dd: "a scale note swapped for another scale note", nd: "a chromatic note straightened into the scale", nn: "one chromatic note swapped for another" }[comp.type];
    const what = `${label(spelled[i])} became ${label(became)} — ${kind}`;
    if (correct) return `Note ${i + 1}: ${what}. The replay was ${moved}${far}.`;
    if (saidChanged) return `Close — something did change, but it was note ${i + 1}, not note ${col + 1}: ${what}. The replay was ${moved}${far}.`;
    return `Note ${i + 1} changed: ${what}. The key change can mask it — the replay was ${moved}${far}. Replay both and listen for it.`;
  }

  async function replay(midis, isReplay) {
    try {
      // Stop first: stopAllSound() mutes the output until ensureAudioReady()
      // un-mutes it, so the other order would play into silence.
      stopAllSound();
      await ensureAudioReady();
      if (ctx.isDestroyed()) return;
      playNotes(midis, { mode: "melodic", noteDur: spec.gap * 2.3, gap: spec.gap, humanize: true, phrase: true });
      if (isReplay && comp.altered) ctx.status(`Listen for note ${comp.alteredIndex + 1}`);
    } catch (err) {
      console.warn("[SmartEar] comparison-memory playback error:", err);
    }
  }

  sameBtn.addEventListener("click", () => grade(false));
  diffBtn.addEventListener("click", startSelect);
  backBtn.addEventListener("click", backToJudge);

  return {
    startRound,
    onKey(e) {
      const k = e.key.toLowerCase();
      if (ctx.phase === "judge") {
        if (k === "s") return grade(false), true;
        if (k === "c" || k === "d") return startSelect(), true;
        return false;
      }
      if (ctx.phase === "select") {
        if (k === "backspace") return backToJudge(), true;
        if (/^[1-9]$/.test(k) && Number(k) <= spec.len) return grade(true, Number(k) - 1), true;
        if (k === "arrowleft" || k === "arrowright") {
          selCursor = Math.max(0, Math.min(spec.len - 1, selCursor + (k === "arrowleft" ? -1 : 1)));
          board.setActiveColumn(selCursor);
          return true;
        }
        if (k === "enter" || k === " ") return grade(true, selCursor), true;
      }
      return false;
    },
    destroy() {},
  };
}

const howTo = (transposed) => [
  ["Listen", "A melody plays while its notes light up on the staff."],
  ["Compare", transposed ? "It plays again, moved to a new key. Did any note actually change?" : "It plays again in the same key. Did any note change?"],
  ["Pinpoint", "If you heard a change, tap the note on the staff. Guessing “changed” isn't enough."],
];

const COMPARISON = {
  id: "memory",
  title: "Comparison",
  memoryType: "Spot what changed",
  tagline: "Hear a melody, then hear it again. Same melody, or did one note change? The melodies get longer, the leaps bigger and the changes smaller.",
  storageKey: "smartear_comparison_memory_v1",
  docId: "comparison-memory-progress",
  unitLabel: "Correct calls",
  accuracyLabel: "Correct calls",
  modes: {
    classic: { blurb: "3 lives. Each right call levels up: longer melodies, bigger leaps, subtler changes." },
    daily: { blurb: "Same melodies for everyone today." },
    training: { blurb: "No lives: the difficulty follows you." },
  },
  howTo: howTo(false),
  keysHint: "<kbd>S</kbd> same · <kbd>C</kbd> changed · <kbd>1</kbd>–<kbd>9</kbd> pick the note",
  createRunner: makeRunner(false),
};

const RELATIVE = {
  id: "relative-memory",
  title: "Relative Memory",
  memoryType: "Same tune, new key",
  tagline: "Hear a melody, then hear it again in a new key. Same tune, or did one note change?",
  storageKey: "smartear_relative_memory_v1",
  docId: "relative-memory-progress",
  unitLabel: "Correct calls",
  accuracyLabel: "Correct calls",
  modes: {
    classic: { blurb: "3 lives. Each right call levels up: farther keys, bigger leaps, subtler changes." },
    daily: { blurb: "Same melodies for everyone today." },
    training: { blurb: "No lives: the difficulty follows you." },
  },
  howTo: howTo(true),
  keysHint: "<kbd>S</kbd> same · <kbd>C</kbd> changed · <kbd>1</kbd>–<kbd>9</kbd> pick the note",
  createRunner: makeRunner(true),
};

export function open(container, opts) {
  return openMemoryGame(container, COMPARISON, opts);
}

export function openRelative(container, opts) {
  return openMemoryGame(container, RELATIVE, opts);
}
