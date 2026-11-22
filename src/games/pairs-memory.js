// pairs-memory.js — Sound Pairs: the classic card-matching game, for ears.
//
// A board of face-down cards; every card hides a SOUND, and every sound is
// on exactly two cards. Flip one, flip another: same sound → the pair stays
// open and shows what it was; different → both turn back. Find every pair
// before running out of misses. What's trained is associative / spatial
// memory for sound — remembering WHERE you heard WHAT — which none of the
// other memory games touch, and it's calm: nothing is timed.
//
// The sounds get harder to tell apart as the levels climb (and the board
// grows): far-apart notes → intervals → close notes (a semitone apart) →
// chord colours on one root → three-note melodies → (levels 11-13) random
// 4-5-note melodies, each pair on its own starting note. Matched cards
// reveal their names, so a run doubles as quiet ear training.

import { noteLabel, pitchName as nameWithOctave } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { ensureAudioReady, playNotesExclusive } from "./audio.js";
import { openMemoryGame, el, randInt, pick, shuffle } from "./memory-kit.js";

export const meta = {
  id: "pairs-memory",
  name: "Sound Pairs",
  blurb: "Flip cards, hear their sounds, and find every matching pair.",
  selfGuided: true,
};

const BOARDS = [
  { pairs: 3, kind: "wide" },
  { pairs: 4, kind: "wide" },
  { pairs: 5, kind: "intervals" },
  { pairs: 6, kind: "close" },
  { pairs: 6, kind: "chords" },
  { pairs: 8, kind: "intervals" },
  { pairs: 8, kind: "motifs" },
  { pairs: 8, kind: "chords" },
  { pairs: 10, kind: "close" },
  { pairs: 10, kind: "motifs" },
  // The hardest: random melodies, every pair starting on its own note.
  { pairs: 6, kind: "random" },
  { pairs: 8, kind: "random" },
  { pairs: 10, kind: "random", len: 5 },
];
const KIND_NAME = { wide: "notes", close: "close notes", intervals: "intervals", chords: "chord colours", motifs: "tiny melodies", random: "random melodies" };
const COLS = { 3: 3, 4: 4, 5: 5, 6: 4, 8: 4, 10: 5 };

function boardSpec(level) {
  const idx = Math.min(level, BOARDS.length) - 1;
  const b = BOARDS[idx];
  const beyond = Math.max(0, level - BOARDS.length); // past the table: same boards, fewer misses allowed
  const kind = beyond ? pickKind(level) : b.kind;
  const budget = Math.max(3, Math.round(b.pairs * 1.2) + (level <= 3 ? 2 : 1) - beyond);
  return { pairs: b.pairs, kind, budget, cols: COLS[b.pairs], len: beyond ? 5 : b.len || 4 };
}
function pickKind(level) {
  return ["close", "random", "chords", "random"][level % 4];
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
function pitchName(m, withOctave = true) {
  const pc = ((m % 12) + 12) % 12;
  const map = [["C", 0], ["C", 1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
  const [letter, alter] = map[pc];
  const txt = getNoteSystem() === "letter" ? NAMES[pc] : noteLabel({ letter, alter }, getNoteSystem());
  return withOctave ? (getNoteSystem() === "german" ? nameWithOctave({ letter, alter }, Math.floor(m / 12) - 1, "german") : txt + (Math.floor(m / 12) - 1)) : txt;
}

const INTERVALS = [
  { s: 12, name: "Octave" },
  { s: 7, name: "Perfect 5th" },
  { s: 4, name: "Major 3rd" },
  { s: 3, name: "Minor 3rd" },
  { s: 5, name: "Perfect 4th" },
  { s: 9, name: "Major 6th" },
  { s: 10, name: "Minor 7th" },
  { s: 8, name: "Minor 6th" },
  { s: 2, name: "Major 2nd" },
  { s: 6, name: "Tritone" },
  { s: 11, name: "Major 7th" },
  { s: 1, name: "Minor 2nd" },
];
const CHORDS = [
  { iv: [0, 4, 7], name: "major" },
  { iv: [0, 3, 7], name: "minor" },
  { iv: [0, 3, 6], name: "diminished" },
  { iv: [0, 4, 8], name: "augmented" },
  { iv: [0, 5, 7], name: "sus4" },
  { iv: [0, 4, 7, 10], name: "dominant 7th" },
  { iv: [0, 4, 7, 11], name: "major 7th" },
  { iv: [0, 3, 7, 10], name: "minor 7th" },
  { iv: [0, 2, 7], name: "sus2" },
  { iv: [0, 3, 6, 10], name: "half-diminished" },
];
const MOTIFS = [
  [0, 2, 4],
  [0, -2, -4],
  [0, 4, 7],
  [0, 7, 4],
  [0, 2, 0],
  [0, -1, 0],
  [0, 5, 4],
  [0, 0, 7],
  [0, 3, 1],
  [0, -3, -5],
  [0, 4, 2],
  [0, 7, 12],
];

/** Every item: { key, label, midis, mode } — two cards per item. */
function buildItems(rng, spec) {
  const { pairs, kind } = spec;
  if (kind === "wide" || kind === "close") {
    const lo = kind === "wide" ? 55 : 60 + randInt(rng, -3, 3);
    const hi = kind === "wide" ? 79 : lo + 12;
    const gap = kind === "wide" ? 3 : 1;
    for (let attempt = 0; attempt < 200; attempt++) {
      const set = [];
      let guard = 0;
      while (set.length < pairs && guard++ < 300) {
        const m = randInt(rng, lo, hi);
        if (set.every((x) => Math.abs(x - m) >= gap)) set.push(m);
      }
      if (set.length === pairs) return set.sort((a, b) => a - b).map((m) => ({ key: "n" + m, label: pitchName(m), midis: [m], mode: "harmonic" }));
    }
  }
  if (kind === "intervals") {
    const root = randInt(rng, 55, 62);
    const pool = INTERVALS.slice(0, Math.max(pairs + 2, 7));
    return shuffle(rng, pool)
      .slice(0, pairs)
      .map((iv) => ({ key: "i" + iv.s, label: iv.name, midis: [root, root + iv.s], mode: "harmonic" }));
  }
  if (kind === "chords") {
    const root = randInt(rng, 52, 60);
    const pool = CHORDS.slice(0, Math.max(pairs + 1, 6));
    return shuffle(rng, pool)
      .slice(0, pairs)
      .map((c) => ({ key: "c" + c.name, label: `${pitchName(root, false)} ${c.name}`, midis: c.iv.map((x) => root + x), mode: "harmonic" }));
  }
  if (kind === "random") return randomMelodies(rng, pairs, spec.len);
  // motifs
  const root = randInt(rng, 60, 67);
  return shuffle(rng, MOTIFS)
    .slice(0, pairs)
    .map((mo) => ({ key: "m" + mo.join(","), label: mo.map((x) => pitchName(root + x, false)).join(" "), midis: mo.map((x) => root + x), mode: "melodic" }));
}

/** Random melodies (`len` notes, steps up to a 5th, chromatic), each on its
 *  own starting note and with its own shape, so neither the first note nor
 *  a transposed twin gives a pair away. */
function randomMelodies(rng, pairs, len) {
  const starts = shuffle(rng, Array.from({ length: 20 }, (_, i) => 55 + i)).slice(0, pairs);
  const STEPS = [-7, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7];
  const shapes = new Set();
  return starts.map((start, i) => {
    let midis;
    let shape;
    let guard = 0;
    do {
      midis = [start];
      for (let k = 1; k < len; k++) {
        let next = midis[k - 1] + pick(rng, STEPS);
        if (next < 50 || next > 84) next = midis[k - 1] - (next - midis[k - 1]);
        midis.push(next);
      }
      shape = midis.map((m) => m - start).join(",");
    } while (shapes.has(shape) && guard++ < 50);
    shapes.add(shape);
    return { key: "r" + i + ":" + shape, label: midis.map((m) => pitchName(m, false)).join(" "), midis, mode: "melodic" };
  });
}

// Calm pair colours — no reds, so a found pair never reads as "wrong".
const HUES = [160, 45, 265, 200, 130, 300, 185, 85, 230, 30];

const TIPS = [
  "Give every sound a word as you hear it — “low”, “bright”, “sad”. Words stick better than sounds.",
  "Flip cards you haven't heard yet before guessing: every new card is information.",
  "Sweep the board in rows. A fixed route makes positions easier to remember.",
  "When a card doesn't match, say its sound AND its place: “bright one, top left”.",
  "Chord colours: major sounds open, minor darker, diminished tense, augmented dreamy.",
];

function createRunner(ctx) {
  const { run, rng } = ctx;
  const grid = el("div", "pm-grid");
  ctx.stage.appendChild(grid);
  const hint = el("div", "mk-hint");
  hint.dataset.show = "recall";
  hint.innerHTML = '<span>Tap a card to hear it · tap an open card to hear it again</span><span class="mk-keys-only"> · arrows + <kbd>Space</kbd></span>';
  ctx.controls.appendChild(hint);

  let spec = null;
  let cards = [];
  let first = null; // index of the open, unmatched card
  let pending = null; // [a, b] — a mismatch still showing
  let pendingTimer = null;
  let mistakes = 0;
  let found = 0;
  let focus = 0;
  let roundIndex = 0;
  let ending = false; // the round is decided — just waiting to reveal

  async function sound(item) {
    try {
      await ensureAudioReady();
      if (ctx.isDestroyed()) return;
      // Exclusive: a new flip cuts the last card off, so two melodies never interleave.
      if (item.mode === "melodic") playNotesExclusive(item.midis, { mode: "melodic", noteDur: 0.42, gap: 0.26 });
      else playNotesExclusive(item.midis, { mode: "harmonic", noteDur: item.midis.length > 1 ? 1.2 : 0.9 });
    } catch {
      /* audio is best-effort */
    }
  }

  function status() {
    const left = spec.budget - mistakes;
    ctx.status(`${found} of ${spec.pairs} pairs · ${left} miss${left === 1 ? "" : "es"} left`);
    ctx.pips(cards.filter((c, i) => cards.findIndex((d) => d.item.key === c.item.key) === i).map((c) => (c.matched ? "good" : "")));
  }

  function render() {
    grid.innerHTML = "";
    grid.style.setProperty("--cols", spec.cols);
    cards.forEach((c, i) => {
      const b = el("button", "pm-card");
      b.setAttribute("aria-label", `Card ${i + 1}`);
      const inner = el("div", "pm-inner");
      const back = el("div", "pm-back");
      const front = el("div", "pm-front");
      front.innerHTML = '<svg class="pm-wave" viewBox="0 0 40 20" aria-hidden="true"><path d="M2 10h5l3-7 5 14 5-12 4 9 3-4h11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const lab = el("div", "pm-label", c.item.label);
      front.appendChild(lab);
      inner.append(back, front);
      b.appendChild(inner);
      b.addEventListener("click", () => flip(i));
      c.el = b;
      grid.appendChild(b);
    });
    setFocus(focus, false);
  }

  function setFocus(i, show = true) {
    focus = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => c.el.classList.toggle("focus", show && k === focus));
  }

  function settlePending() {
    if (!pending) return;
    clearTimeout(pendingTimer);
    pending.forEach((k) => cards[k].el.classList.remove("open", "miss"));
    pending = null;
  }

  function ping(c) {
    sound(c.item);
    c.el.classList.remove("ping");
    void c.el.offsetWidth;
    c.el.classList.add("ping");
  }

  function flip(i) {
    const c = cards[i];
    if (ctx.phase === "reveal") return ping(c); // the board is face up — listen freely
    if (ctx.phase !== "recall" || ending) return;
    if (pending) settlePending(); // tapping on moves the game along without waiting
    if (c.matched || i === first) return ping(c); // hear it again
    c.el.classList.add("open");
    sound(c.item);
    if (first === null) {
      first = i;
      return;
    }
    const a = cards[first];
    if (a.item.key === c.item.key) {
      a.matched = c.matched = true;
      const hue = HUES[found % HUES.length];
      [a, c].forEach((x) => {
        x.el.classList.add("matched");
        x.el.style.setProperty("--hue", hue);
      });
      found++;
      first = null;
      status();
      if (found === spec.pairs) {
        ending = true;
        ctx.later(() => finish(true), 450);
      }
    } else {
      mistakes++;
      const pair = [first, i];
      first = null;
      pair.forEach((k) => cards[k].el.classList.add("miss"));
      pending = pair;
      pendingTimer = setTimeout(settlePending, 1100);
      status();
      if (mistakes > spec.budget) {
        ending = true;
        ctx.later(() => finish(false), 700);
      }
    }
  }

  function finish(success) {
    if (ctx.phase !== "recall") return;
    settlePending();
    cards.forEach((c) => {
      c.el.classList.add("open", "shown");
      if (!c.matched) c.el.classList.add("unfound");
    });
    const n = spec.pairs;
    const spare = spec.budget - mistakes;
    let tip;
    if (success) tip = spare >= Math.ceil(n / 2) ? `Only ${mistakes} miss${mistakes === 1 ? "" : "es"} — sharp memory. ${TIPS[roundIndex % TIPS.length]}` : `Board cleared with ${Math.max(0, spare)} miss${spare === 1 ? "" : "es"} to spare. ${TIPS[roundIndex % TIPS.length]}`;
    else tip = `The misses ran out. Every card is face up now — tap any to hear it. ${TIPS[(roundIndex + 1) % TIPS.length]}`;
    ctx.finishRound({
      success,
      base: n * 12 + Math.max(0, spare) * 6,
      partial: found * 4,
      units: [found, n],
      title: success ? (mistakes === 0 ? "Flawless board" : undefined) : `${found} of ${n} pairs`,
      tip,
      legend: null,
      actions: [],
    });
  }

  function startRound() {
    roundIndex++;
    spec = boardSpec(run.level);
    const items = buildItems(rng, spec);
    cards = shuffle(rng, [...items, ...items]).map((item) => ({ item, matched: false, el: null }));
    first = null;
    pending = null;
    mistakes = 0;
    found = 0;
    focus = 0;
    ending = false;
    render();
    ctx.timer.reset(false);
    ctx.setPhase("ready");
    ctx.splash(`Level ${run.level}`, `${spec.pairs} pairs · ${KIND_NAME[spec.kind]}`);
    ctx.status("Get ready…");
    ctx.pips(new Array(spec.pairs).fill(""));
    ctx.later(() => {
      ctx.setPhase("recall");
      status();
    }, 800);
  }

  return {
    startRound,
    onKey(e) {
      if (ctx.phase !== "recall") return false;
      const cols = spec.cols;
      const k = e.key;
      if (k === "ArrowRight") return setFocus(focus + 1), true;
      if (k === "ArrowLeft") return setFocus(focus - 1), true;
      if (k === "ArrowDown") return setFocus(focus + cols), true;
      if (k === "ArrowUp") return setFocus(focus - cols), true;
      if (k === " " || k === "Enter") {
        setFocus(focus);
        flip(focus);
        return true;
      }
      return false;
    },
    destroy() {
      clearTimeout(pendingTimer);
    },
  };
}

const GAME = {
  id: "pairs-memory",
  title: "Sound Pairs",
  memoryType: "Remember where each sound lives",
  tagline: "Every sound hides on two cards. Find the pairs.",
  storageKey: "smartear_pairs_memory_v1",
  docId: "pairs-memory-progress",
  unitLabel: "Pairs found",
  accuracyLabel: "Pairs found",
  modes: {
    classic: { blurb: "3 lives. Bigger boards, closer sounds." },
    daily: { blurb: "Same boards for everyone today." },
    training: { blurb: "No lives — the board size follows you." },
  },
  howTo: [
    ["Flip", "Tap a card to hear its sound. Nothing is timed."],
    ["Match", "Find the card with the same sound. A match stays open and shows its name."],
    ["Clear", "Find every pair within the miss limit to move up."],
  ],
  keysHint: "<kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> flip",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
