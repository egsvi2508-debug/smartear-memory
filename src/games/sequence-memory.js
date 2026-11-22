// sequence-memory.js — Sequence Memory: Simon, on a real piano.
//
// A melody plays; you play it back on the keyboard. Get it right and the
// SAME melody returns one note longer (the classic Simon / Corsi-span
// structure — the growing sequence is the point: you rehearse the old part
// and add one new link each round). A miss costs a life and replays the
// same melody, so you get to fix exactly the spot that slipped.
//
// What you get while it plays is your choice (a hub setting, remembered):
//   notes — the melody's notation, each note lighting as it sounds
//   keys  — the piano keys light up (pure Simon: sound + position)
//   ear   — sound only, the hardest
// Harder cues score more (×1.25 notes, ×1.5 ear) so one best score stays
// fair across them.
//
// The melody is a random tonal walk — steps, skips and the odd leap, never
// a stock pattern — with chromatic notes creeping in from level 6. It stays
// inside the on-screen keyboard (C4–F5), graded by exact pitch, one tap at
// a time: every right note drops onto the staff in green, the first wrong
// one ends the round.

import { keySpelling, noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { ensureAudioReady, playNotes, stopAllSound } from "./audio.js";
import { createStaffBoard, letterOf, midiOf, spelledOf } from "./staff-board.js";
import { createPiano, MUSICAL_TYPING } from "./memory-inputs.js";
import { openMemoryGame, el, pick } from "./memory-kit.js";

export const meta = {
  id: "sequence-memory",
  name: "Sequence Memory",
  blurb: "A melody plays — play it back on the piano. Every success adds one more note to the same melody.",
  selfGuided: true,
};

const READY_MS = 800;
const LOW = 60; // C4
const HIGH = 77; // F5
const CUES = {
  notes: { label: "Notes + sound", icon: "🎼", factor: 1.25 },
  keys: { label: "Keys + sound", icon: "🎹", factor: 1 },
  ear: { label: "Sound only", icon: "👂", factor: 1.5 },
};

function label(n) {
  return noteLabel(spelledOf(n), getNoteSystem());
}

/** A random tonal walk over the key's scale inside the keyboard's range. */
function createMelodyMaker(rng) {
  const tonicPc = pick(rng, [0, 2, 4, 5, 7, 9, 10, 3, 8]);
  const spelling = keySpelling(tonicPc, "major");
  const alterOf = {};
  spelling.forEach(({ letter, alter }) => (alterOf[letter] = alter));
  const scale = [];
  for (let d = 26; d <= 40; d++) {
    const n = { d, alter: alterOf[letterOf(d)] };
    const m = midiOf(n);
    if (m >= LOW && m <= HIGH) scale.push({ ...n, midi: m });
  }
  // Start on a tonic or fifth near the middle of the range.
  const starts = scale.map((s, i) => [s, i]).filter(([s]) => [tonicPc, (tonicPc + 7) % 12].includes(s.midi % 12));
  let i = starts.length ? pick(rng, starts)[1] : Math.floor(scale.length / 2);
  let first = true;
  return {
    next(level) {
      if (!first) {
        const r = rng();
        let step = r < 0.05 ? 0 : r < 0.55 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
        if (rng() < 0.5) step = -step;
        if (i + step < 0 || i + step >= scale.length) step = -step;
        i = Math.max(0, Math.min(scale.length - 1, i + step));
      }
      first = false;
      const base = scale[i];
      if (level >= 6 && rng() < 0.12) {
        // Chromatic neighbour: raise or lower by a semitone, spelled plainly.
        const up = rng() < 0.5;
        const alter = base.alter + (up ? 1 : -1);
        const cand = { d: base.d, alter };
        const m = midiOf(cand);
        const letter = letterOf(base.d);
        const odd = (letter === "E" || letter === "B") && alter > 0 ? true : (letter === "C" || letter === "F") && alter < 0;
        if (Math.abs(alter) <= 1 && !odd && m >= LOW && m <= HIGH) return { ...cand, midi: m };
      }
      return { d: base.d, alter: base.alter, midi: base.midi };
    },
  };
}

function motion(from, to) {
  const diff = to.midi - from.midi;
  const abs = Math.abs(diff);
  if (abs === 0) return "a repeat of the same note";
  const size = abs <= 2 ? "a step" : abs <= 4 ? "a skip" : "a leap";
  return `${size} ${diff > 0 ? "up" : "down"} from ${label(from)}`;
}

const TIPS = [
  "Sing it back in your head before your hands move — the ear leads, the fingers follow.",
  "Chunk it: hear the melody as short groups of 3–4 notes, not one long string.",
  "Track the contour — up, up, down — and the pitches have fewer places to hide.",
  "Only the last note is new each round. Replay the old part fast, save your focus for the new one.",
  "Notice where it lands: melodies love to rest on the home note of the key.",
];

function createRunner(ctx) {
  const { run, rng } = ctx;
  const cue = CUES[ctx.prefs.cue] ? ctx.prefs.cue : "notes";
  const factor = CUES[cue].factor;

  const board = createStaffBoard(ctx.stage, {
    layout: "treble",
    columns: 3,
    colWidth: 30,
    colMax: 48,
    minWidth: 236,
    head: "black",
    stems: true,
    guides: true,
    minScale: 0.55,
    maxScale: 1.9,
  });
  ctx.hudTag(`${CUES[cue].icon} ${CUES[cue].label}`);

  const pianoWrap = el("div", "mk-piano-wrap");
  // Aim-then-release piano (see memory-inputs.js): the key sounds while
  // you aim, the answer only counts when you lift your finger.
  const piano = createPiano(pianoWrap, {
    low: LOW,
    high: HIGH,
    onPreview: (m) => {
      if (ctx.phase === "recall" || ctx.phase === "reveal") sound(m);
    },
    onPress: (m) => press(m, false),
  });
  const hint = el("div", "mk-hint");
  hint.dataset.show = "recall";
  hint.innerHTML = '<span>Press a key to hear it · slide to fix · lift to play it</span><span class="mk-keys-only"> · or type <kbd>A</kbd>–<kbd>\'</kbd>, black keys <kbd>W</kbd><kbd>E</kbd><kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd><kbd>O</kbd><kbd>P</kbd></span>';
  ctx.controls.append(pianoWrap, hint);

  let maker = createMelodyMaker(rng);
  let melody = [];
  let idx = 0;
  let shown = [];
  let roundIndex = 0;

  function pipStates(failAt = -1, playing = -1) {
    return melody.map((_, i) => {
      if (ctx.phase === "listen") return i <= playing ? "on" : "";
      if (i < idx) return "good";
      if (i === failAt) return "bad";
      return i === idx && ctx.phase === "recall" ? "cur" : "";
    });
  }

  async function sound(m, dur = 0.5) {
    try {
      await ensureAudioReady();
      if (!ctx.isDestroyed()) playNotes([m], { mode: "harmonic", noteDur: dur });
    } catch {
      /* ignore */
    }
  }

  /** withSound: true for the computer keyboard (the piano already sounded
   *  the key while it was being aimed). */
  function press(m, withSound = true) {
    if (ctx.phase !== "recall") {
      // Free play on the reveal — handy for trying the melody out.
      if (ctx.phase === "reveal") {
        piano.flash(m, "lit", 250);
        if (withSound) sound(m);
      }
      return;
    }
    if (withSound) sound(m);
    const expected = melody[idx];
    if (m === expected.midi) {
      piano.flash(m, "good", 260);
      shown.push({ ...expected, col: idx, cls: "good" });
      board.setNotes(shown.map((s, i) => ({ ...s, just: i === shown.length - 1 })));
      idx++;
      ctx.pips(pipStates());
      if (idx === melody.length) return finish(true, m);
      board.setActiveColumn(idx);
      board.scrollToColumn(idx);
      ctx.status(`Play it back · note ${idx + 1} of ${melody.length}`);
    } else {
      piano.flash(m, "bad", 800);
      piano.flash(expected.midi, "hint", 1400);
      finish(false, m);
    }
  }

  function finish(success, played) {
    piano.setEnabled(true); // free play on the reveal
    board.setActiveColumn(null);
    const failAt = success ? -1 : idx;
    board.setNotes(melody.map((t, i) => ({ ...t, col: i, cls: i < idx ? "good" : i === failAt ? "bad" : "missed" })));
    ctx.pips(pipStates(failAt));
    const n = melody.length;
    let tip;
    if (success) tip = `${n} notes, straight from memory. ${TIPS[roundIndex % TIPS.length]}`;
    else {
      const t = melody[idx];
      const playedName = nameOfMidi(played, t);
      tip = `Note ${idx + 1} was ${label(t)}${idx > 0 ? ` — ${motion(melody[idx - 1], t)}` : ""}. You played ${playedName}.`;
      if (played % 12 === t.midi % 12) tip += " Right note, wrong octave.";
      else if (idx + 1 < n && played === melody[idx + 1].midi) tip += " That was the NEXT note — you skipped one.";
      else if (idx > 0 && played === melody[idx - 1].midi) tip += " That repeated the note before.";
      tip += ` ${TIPS[(roundIndex + 2) % TIPS.length]}`;
    }
    ctx.finishRound({
      success,
      base: n * 10 * factor,
      partial: idx * 5,
      units: [idx, n],
      title: success ? undefined : idx ? `${idx} of ${n} played` : "Missed the first note",
      tip,
      legend: success ? null : [["good", "Played"], ["bad", "Slipped here"], ["missed", "Not reached"]],
      actions: [{ label: "🔊 Hear it", key: "h", onClick: hear }],
    });
  }

  function nameOfMidi(m, near) {
    // Spell the played key the same way the expected note is spelled when
    // they share a letter; otherwise plain sharps.
    const pc = ((m % 12) + 12) % 12;
    const naturals = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" };
    if (naturals[pc]) return noteLabel({ letter: naturals[pc], alter: 0 }, getNoteSystem());
    const nearSp = spelledOf(near);
    if (nearSp.alter !== 0 && (midiOf(near) % 12) === pc) return label(near);
    return noteLabel({ letter: naturals[pc - 1], alter: 1 }, getNoteSystem());
  }

  async function hear() {
    try {
      // Stop first: stopAllSound() mutes the output until ensureAudioReady()
      // un-mutes it, so the other order would play into silence.
      stopAllSound();
      await ensureAudioReady();
      if (ctx.isDestroyed()) return;
      playNotes(melody.map((m) => m.midi), { mode: "melodic", noteDur: 0.8, gap: 0.45 });
    } catch (err) {
      console.warn("[SmartEar] sequence-memory playback error:", err);
    }
  }

  function startRound({ retry }) {
    roundIndex++;
    const desired = run.level + 2;
    while (melody.length < desired) melody.push(maker.next(run.level));
    if (melody.length > desired) melody = melody.slice(0, desired);
    idx = 0;
    shown = [];
    board.configure({ columns: desired });
    board.setNotes([]);
    board.setActiveColumn(null);
    piano.setEnabled(false);
    piano.clear();
    ctx.timer.reset(false);
    ctx.setPhase("ready");
    ctx.splash(retry ? "Again" : `Level ${run.level}`, retry ? "Same melody — listen closely" : `${desired} notes`);
    ctx.status(retry ? "Same melody again…" : "Get ready…");
    ctx.pips(new Array(desired).fill(""));
    ctx.later(listen, READY_MS);
  }

  async function listen() {
    ctx.setPhase("listen");
    ctx.status("Listen…");
    try {
      // Never let a stuck audio unlock freeze the round.
      await Promise.race([ensureAudioReady(), new Promise((r) => setTimeout(r, 2500))]);
    } catch (err) {
      console.warn("[SmartEar] sequence-memory audio error:", err);
    }
    if (ctx.isDestroyed() || ctx.phase !== "listen") return;
    const gap = Math.max(0.36, 0.62 - run.level * 0.016);
    const schedule = playNotes(melody.map((m) => m.midi), { mode: "melodic", noteDur: gap * 1.25, gap });
    if (cue === "notes") board.setNotes(melody.map((m, i) => ({ ...m, col: i, cls: "ink" })), { animate: "pop" });
    melody.forEach((m, i) => {
      const at = schedule[i] ? schedule[i].delayMs : i * gap * 1000;
      ctx.later(() => {
        if (ctx.phase !== "listen") return;
        if (cue === "notes") {
          board.setNotes(melody.map((mm, j) => ({ ...mm, col: j, cls: j === i ? "play" : "ink" })));
          board.scrollToColumn(i);
        } else board.setActiveColumn(i);
        if (cue === "keys") piano.flash(m.midi, "lit", Math.round(gap * 900));
        ctx.pips(pipStates(-1, i));
      }, at);
    });
    const last = schedule[schedule.length - 1];
    const total = last ? last.delayMs + gap * 1000 + 250 : melody.length * gap * 1000 + 400;
    ctx.later(startRecall, total);
  }

  function startRecall() {
    if (ctx.phase !== "listen") return;
    ctx.setPhase("recall");
    board.setNotes([]);
    board.setActiveColumn(0);
    board.scrollToColumn(0);
    piano.clear();
    piano.setEnabled(true);
    ctx.pips(pipStates());
    ctx.status(`Play it back · note 1 of ${melody.length}`);
  }

  return {
    startRound,
    onKey(e) {
      if (e.repeat || ctx.phase !== "recall") return false;
      const m = MUSICAL_TYPING[e.key.toLowerCase()];
      if (m === undefined) return false;
      press(m, true);
      return true;
    },
    destroy() {
      maker = null;
    },
  };
}

function renderSettings(slot, prefs, setPref) {
  slot.appendChild(el("div", "mk-section-label", "While the melody plays, show"));
  const seg = el("div", "mk-seg");
  seg.setAttribute("role", "radiogroup");
  const current = CUES[prefs.cue] ? prefs.cue : "notes";
  Object.entries(CUES).forEach(([id, c]) => {
    const b = el("button", "mk-seg-btn" + (id === current ? " active" : ""));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(id === current));
    b.append(el("span", "mk-seg-icon", c.icon), el("span", "mk-seg-label", c.label), el("span", "mk-seg-sub mono", c.factor === 1 ? "×1 pts" : `×${c.factor} pts`));
    b.addEventListener("click", () => {
      setPref("cue", id);
      seg.querySelectorAll(".mk-seg-btn").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-checked", String(x === b));
      });
    });
    seg.appendChild(b);
  });
  slot.appendChild(seg);
}

const GAME = {
  id: "sequence-memory",
  title: "Sequence Memory",
  memoryType: "Remember the order",
  tagline: "A melody plays. Play it back on the piano. Get it right and the same melody comes back one note longer.",
  storageKey: "smartear_sequence_memory_v1",
  docId: "sequence-memory-progress",
  unitLabel: "Notes played back",
  accuracyLabel: "Notes played",
  defaultPrefs: { cue: "notes" },
  renderSettings,
  modes: {
    classic: { blurb: "3 lives. A miss replays the same melody so you can fix the spot that slipped." },
    daily: { blurb: "Same melody for everyone today." },
    training: { blurb: "No lives — the melody follows you." },
  },
  howTo: [
    ["Listen", "A melody plays — with its notes, lit keys, or sound alone (your choice above)."],
    ["Play", "Play it back in order. A key only counts when you lift your finger — hit the wrong one? Slide to the right key first."],
    ["Grow", "Each success adds one note to the SAME melody. How long can you go?"],
  ],
  keysHint: "<kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd><kbd>'</kbd> white keys from C4 · <kbd>W</kbd><kbd>E</kbd><kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd><kbd>O</kbd><kbd>P</kbd> black keys",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
