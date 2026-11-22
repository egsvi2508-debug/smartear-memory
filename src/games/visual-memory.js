// visual-memory.js — Visual Memory: photograph the staff, rebuild it.
//
// A snapshot of notes flashes on a grand staff divided into columns (time
// slots), vanishes, and you rebuild it by tapping the notes back onto the
// SAME board — the answer surface is literally the picture you studied
// (js/staff-board.js), so what's trained is holding a notated image in
// visuospatial memory, not translating it through a menu. The column grid
// makes it a 2-D memory task (which slot × which line/space), the staff
// equivalent of the classic grid-memory test, and it scales cleanly: a
// 10-note snapshot is a readable little passage, not a 10-note tower.
//
// Content is MOSTLY RANDOM (~65%): random positions, random column fill,
// random accidentals — nothing to lean on but memory. The rest are real
// patterns (lines, arches, zigzags, parallel 3rds/6ths, in an actual key)
// because spotting structure ("chunking") is the other half of a strong
// musical memory — and some of those patterns carry one deliberately broken
// note, so leaning on the pattern alone still fails. The reveal says which
// kind of round it was and why the miss happened.
//
// Levels (shell rules in js/memory-kit.js): level L shows L + 1 notes; the
// board widens (2 → 6 columns), the register opens from the treble staff
// to both staves, and accidentals phase in from level 3.
//
// Deliberately PURE VISUAL during the flash — nothing plays. The snapshot
// can be heard afterwards on the reveal ("Hear it") as reinforcement only.

import { keySpelling, keyLabel, noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { ensureAudioReady, playNotes, stopAllSound } from "./audio.js";
import { createStaffBoard, letterOf, midiOf, spelledOf, accidentalIcon } from "./staff-board.js";
import { openMemoryGame, el, randInt, pick } from "./memory-kit.js";

export const meta = {
  id: "visual-memory",
  name: "Visual Memory",
  blurb: "A snapshot of notes flashes on the staff and vanishes — rebuild it, every note back in its place.",
  // Not scored through js/scoring.js — progress lives in its own doc (see
  // js/memory-kit.js), so the account screen's lifetime totals skip it.
  selfGuided: true,
};

const READY_MS = 850;

function levelSpec(level) {
  const n = Math.min(16, level + 1);
  const cols = level <= 1 ? 2 : level <= 3 ? 3 : level <= 8 ? 4 : level <= 13 ? 5 : 6;
  const maxPerCol = level <= 2 ? 1 : level <= 6 ? 2 : 3;
  const range = level <= 2 ? [30, 38] : level <= 4 ? [27, 41] : level <= 6 ? [19, 40] : [14, 43];
  const accProb = level <= 2 ? 0 : Math.min(0.35, 0.05 + level * 0.035);
  const viewMs = Math.min(9500, 1100 + n * 620);
  return { n, cols, maxPerCol, range, accProb, viewMs };
}

function label(n) {
  return noteLabel(spelledOf(n), getNoteSystem());
}
function labelOct(n) {
  return label(n) + spelledOf(n).octave;
}

// ---------------------------------------------------------------------------
// Generators → { notes: [{ col, d, alter }], info }
// ---------------------------------------------------------------------------
function everydayAlter(d, alter) {
  const letter = letterOf(d);
  if ((letter === "E" || letter === "B") && alter === 1) return -1;
  if ((letter === "C" || letter === "F") && alter === -1) return 1;
  return alter;
}

function pickPositions(rng, count, lo, hi) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < 120) {
      const d = randInt(rng, lo, hi);
      if (out.every((x) => Math.abs(x - d) >= 2)) out.push(d);
    }
    if (out.length === count) return out;
  }
  return Array.from({ length: count }, (_, i) => lo + i * 2);
}

function genRandom(rng, spec) {
  const { n, cols, maxPerCol, range, accProb } = spec;
  const counts = new Array(cols).fill(0);
  const leaveEmpty = n > cols && cols >= 4 && (cols - 1) * maxPerCol >= n && rng() < 0.22 ? randInt(rng, 0, cols - 1) : -1;
  let remaining = n;
  for (let c = 0; c < cols && remaining > 0; c++) {
    if (c === leaveEmpty) continue;
    counts[c] = 1;
    remaining--;
  }
  let guard = 0;
  while (remaining > 0 && guard++ < 1000) {
    const c = randInt(rng, 0, cols - 1);
    if (c !== leaveEmpty && counts[c] < maxPerCol) {
      counts[c]++;
      remaining--;
    }
  }
  const notes = [];
  counts.forEach((k, col) => {
    pickPositions(rng, k, range[0], range[1]).forEach((d) => {
      const alter = rng() < accProb ? everydayAlter(d, rng() < 0.5 ? -1 : 1) : 0;
      notes.push({ col, d, alter });
    });
  });
  return { notes, info: { kind: "random" } };
}

const KEY_POOLS = [
  [0, 7, 5],
  [0, 7, 5, 2, 10, 9, 3],
  [0, 7, 5, 2, 10, 9, 3, 4, 8, 11, 1, 6],
];
const CONTOURS = {
  rise: { name: "a rising line", off: (i) => i },
  fall: { name: "a falling line", off: (i) => -i },
  arch: { name: "an arch — up, then back down", off: (i, n) => Math.min(i, n - 1 - i) },
  valley: { name: "a valley — down, then back up", off: (i, n) => -Math.min(i, n - 1 - i) },
  zigzag: { name: "a climbing zigzag", off: (i) => (i % 2 ? Math.floor(i / 2) + 2 : i / 2) },
};
const IV_NAME = { 2: "3rds", 3: "4ths", 4: "5ths", 5: "6ths" };

function genPattern(rng, spec, level) {
  const { n, cols, maxPerCol, range } = spec;
  const layers = Math.min(maxPerCol, Math.ceil(n / cols));
  const pool = KEY_POOLS[level <= 3 ? 0 : level <= 6 ? 1 : 2];
  const tonicPc = pick(rng, pool);
  const spelling = keySpelling(tonicPc, "major");
  const alterOf = {};
  spelling.forEach(({ letter, alter }) => (alterOf[letter] = alter));
  const keyName = keyLabel(spelling[0], true, getNoteSystem());

  for (let attempt = 0; attempt < 30; attempt++) {
    const contourId = pick(rng, Object.keys(CONTOURS));
    const contour = CONTOURS[contourId];
    const step = contourId === "zigzag" ? 1 : pick(rng, [1, 1, 2]);
    const iv = pick(rng, [2, 2, 5, 3, 4]);
    const base = Array.from({ length: cols }, (_, i) => contour.off(i, cols) * step);
    // Stack order: parallel interval above the line, then (3 layers) the
    // same interval again on top — a line in parallel 3rds becomes stacked
    // triads.
    const stacks = [0, iv, iv * 2].slice(0, layers);
    const lowOff = Math.min(...base);
    const highOff = Math.max(...base) + stacks[stacks.length - 1];
    const minStart = range[0] - lowOff;
    const maxStart = range[1] - highOff;
    if (maxStart < minStart) continue;
    const d0 = randInt(rng, minStart, maxStart);

    const notes = [];
    for (let layer = 0; layer < layers; layer++) {
      for (let c = 0; c < cols && notes.length < n; c++) {
        const d = d0 + base[c] + stacks[layer];
        notes.push({ col: c, d, alter: alterOf[letterOf(d)] });
      }
    }
    let desc = contour.name + (step === 2 ? " in skips" : "");
    if (layers > 1) desc += layers === 3 ? ` of stacked ${IV_NAME[iv]}` : ` in parallel ${IV_NAME[iv]}`;
    desc += ` (${keyName})`;

    // One broken note in ~30% of pattern rounds: patterns help, but the
    // exception is exactly what a lazy glance misses.
    let broken = null;
    if (rng() < 0.3) {
      const idx = randInt(rng, 0, notes.length - 1);
      const t = notes[idx];
      const others = notes.filter((m, i) => i !== idx && m.col === t.col).map((m) => m.d);
      const options = [-2, -1, 1, 2]
        .map((delta) => t.d + delta)
        .filter((d) => d >= range[0] && d <= range[1] && others.every((o) => Math.abs(o - d) >= 2));
      if (options.length) {
        const d = pick(rng, options);
        notes[idx] = { col: t.col, d, alter: alterOf[letterOf(d)] };
        broken = t.col;
      }
    }
    return { notes, info: { kind: "pattern", desc, broken, keyName } };
  }
  return genRandom(rng, spec);
}

// ---------------------------------------------------------------------------
// Grading + teaching copy
// ---------------------------------------------------------------------------
const posKey = (n) => `${n.col}:${n.d}`;

function gradeAttempt(target, attempt) {
  const byKey = new Map(target.map((t) => [posKey(t), t]));
  const attemptKeys = new Set(attempt.map(posKey));
  const shown = [];
  let good = 0;
  let wrongAcc = 0;
  let wrongPos = 0;
  attempt.forEach((a) => {
    const t = byKey.get(posKey(a));
    if (t && t.alter === a.alter) {
      good++;
      shown.push({ ...a, cls: "good" });
    } else if (t) {
      wrongAcc++;
      shown.push({ ...a, cls: "bad", forceNatural: a.alter === 0 });
    } else {
      wrongPos++;
      shown.push({ ...a, cls: "bad" });
    }
  });
  const missed = target.filter((t) => !attemptKeys.has(posKey(t)));
  missed.forEach((t) => shown.push({ ...t, cls: "missed" }));
  const stray = attempt.filter((a) => !byKey.has(posKey(a)));
  const colSlip = stray.filter((a) => missed.some((m) => m.d === a.d && m.col !== a.col)).length;
  const stepOff = stray.filter((a) => missed.some((m) => m.col === a.col && Math.abs(m.d - a.d) === 1)).length;
  const perfect = good === target.length && attempt.length === target.length;
  return { shown, good, wrongAcc, wrongPos, missed: missed.length, placed: attempt.length, colSlip, stepOff, perfect };
}

const TIPS = [
  "Read it column by column, left to right — like a short passage, not a cloud of dots.",
  "Anchor to landmarks: middle C, the top line F, the bottom line G. Measure from them.",
  "Name the notes silently while they're up. Words stick better than dots.",
  "Trace the outline: which column is highest, which is lowest? The shape holds the rest.",
  "Accidentals first — note which notes carry a sign, then learn the positions.",
  "Split the grand staff: remember the treble part and the bass part as two small pictures.",
];

function buildTip({ target, info, g, success, roundIndex }) {
  const n = target.length;
  if (!success) {
    if (g.placed !== n) return `There were ${n} notes — you placed ${g.placed}. Count them column by column while they're up.`;
    if (g.wrongAcc > 0 && g.wrongPos === 0) {
      if (info.kind === "pattern") return `Every position right — the accidentals slipped. This one was in ${info.keyName}.`;
      const signed = target.filter((t) => t.alter !== 0).map(labelOct);
      return signed.length ? `Right spots, wrong signs. The accidentals were: ${signed.join(", ")}.` : "Right spots — but there were no accidentals this time.";
    }
    if (info.kind === "pattern" && info.broken !== null) return `Almost a pattern: ${info.desc} — but column ${info.broken + 1} broke it. Patterns help; check for the exception.`;
    if (info.kind === "pattern") return `This one had a pattern: ${info.desc}. Spotting the shape turns ${n} notes into one idea.`;
    if (g.colSlip > 0) return `${g.colSlip === 1 ? "A note" : `${g.colSlip} notes`} landed in the wrong column. Read the board left to right, one column at a time.`;
    if (g.stepOff > 0) return `${g.stepOff === 1 ? "A note was" : `${g.stepOff} notes were`} one step off. Line or space? Check against middle C and the outer lines.`;
    return "Pure random this time — nothing to lean on. " + TIPS[roundIndex % TIPS.length];
  }
  if (info.kind === "pattern" && info.broken !== null) return `Almost a pattern: ${info.desc}, with one note out of line — and you caught it.`;
  if (info.kind === "pattern") return `Pattern round: ${info.desc}. Seeing the shape turns ${n} notes into one idea.`;
  return "Random round — no pattern, all memory. " + TIPS[roundIndex % TIPS.length];
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------
function createRunner(ctx) {
  const { run, rng } = ctx;

  const board = createStaffBoard(ctx.stage, {
    layout: "grand",
    columns: 2,
    colWidth: 46,
    colMax: 60,
    minWidth: 236,
    head: "whole",
    guides: true,
    onPlace: (col, d) => placeAt(col, d),
    onHover: (pos) => showReadout(pos),
  });

  // Flash controls
  const flashRow = el("div", "mk-row center");
  flashRow.dataset.show = "flash";
  const gotItBtn = el("button", "mk-btn ghost", "Got it — hide");
  gotItBtn.appendChild(el("kbd", "mk-kbd-hint", "Space"));
  flashRow.appendChild(gotItBtn);

  // Recall controls
  const recallRow = el("div", "mk-row");
  recallRow.dataset.show = "recall";
  const accSeg = el("div", "mk-acc");
  accSeg.setAttribute("role", "radiogroup");
  accSeg.setAttribute("aria-label", "Accidental for the next note");
  const accBtns = new Map();
  [
    [-1, "1", "Flat"],
    [0, "2", "Natural"],
    [1, "3", "Sharp"],
  ].forEach(([alter, k, name]) => {
    const b = el("button", "mk-acc-btn");
    b.append(accidentalIcon(alter), el("span", "mk-acc-key mono", k));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", name);
    b.addEventListener("click", () => setAcc(alter));
    accBtns.set(alter, b);
    accSeg.appendChild(b);
  });
  const undoBtn = el("button", "mk-btn ghost", "Undo");
  const clearBtn = el("button", "mk-btn ghost", "Clear");
  const checkBtn = el("button", "mk-btn primary", "Check");
  const right = el("div", "mk-row-right");
  right.append(undoBtn, clearBtn, checkBtn);
  recallRow.append(accSeg, right);
  const hint = el("div", "mk-hint");
  hint.dataset.show = "recall";
  hint.textContent = "Tap the staff to place a note · tap it again to remove it";
  ctx.controls.append(flashRow, recallRow, hint);

  let spec = null;
  let target = [];
  let info = null;
  let attempt = [];
  let acc = 0;
  let cursor = null; // { col, d } — keyboard cursor
  let flashStart = 0;
  let lastPlaced = null;
  let roundIndex = 0;

  function setAcc(alter) {
    acc = alter;
    accBtns.forEach((b, a) => {
      b.classList.toggle("active", a === alter);
      b.setAttribute("aria-checked", String(a === alter));
    });
    const p = board.preview;
    board.setPreview(p ? p.col : null, p ? p.d : null, acc);
    if (p) showReadout(p);
  }

  function showReadout(pos) {
    if (ctx.phase !== "recall" || !pos) return ctx.readout(null);
    const existing = attempt.find((n) => n.col === pos.col && n.d === pos.d);
    const next = { d: pos.d, alter: acc };
    if (existing && existing.alter === acc) ctx.readout(`${labelOct(existing)} · tap to remove`);
    else if (existing) ctx.readout(`${labelOct(existing)} → ${labelOct(next)}`);
    else ctx.readout(`Place ${labelOct(next)}`);
  }

  function pipStates() {
    const states = [];
    for (let i = 0; i < Math.max(attempt.length, target.length); i++) states.push(i < attempt.length ? (i < target.length ? "on" : "over") : "");
    return states;
  }

  function renderAttempt() {
    board.setNotes(attempt.map((n) => ({ ...n, cls: "pending", just: lastPlaced && n.col === lastPlaced.col && n.d === lastPlaced.d })));
    ctx.pips(pipStates());
    undoBtn.disabled = attempt.length === 0;
    clearBtn.disabled = attempt.length === 0;
    checkBtn.disabled = attempt.length === 0;
    checkBtn.classList.toggle("ready", attempt.length === target.length);
    ctx.status(attempt.length === target.length ? "All placed — check when ready" : `Rebuild it · ${attempt.length} of ${target.length}`);
  }

  function placeAt(col, d) {
    if (ctx.phase !== "recall") return;
    const idx = attempt.findIndex((n) => n.col === col && n.d === d);
    lastPlaced = null;
    if (idx >= 0 && attempt[idx].alter === acc) attempt.splice(idx, 1);
    else if (idx >= 0) {
      attempt[idx] = { col, d, alter: acc };
      lastPlaced = { col, d };
    } else {
      attempt.push({ col, d, alter: acc });
      lastPlaced = { col, d };
    }
    cursor = { col, d };
    renderAttempt();
    showReadout(board.preview);
  }

  undoBtn.addEventListener("click", () => {
    if (ctx.phase !== "recall" || !attempt.length) return;
    attempt.pop();
    lastPlaced = null;
    renderAttempt();
  });
  clearBtn.addEventListener("click", () => {
    if (ctx.phase !== "recall") return;
    attempt = [];
    lastPlaced = null;
    renderAttempt();
  });
  checkBtn.addEventListener("click", () => {
    if (ctx.phase === "recall" && attempt.length) grade();
  });
  gotItBtn.addEventListener("click", () => endFlash());

  function startRound() {
    roundIndex++;
    spec = levelSpec(run.level);
    const gen = run.level >= 2 && rng() < 0.35 ? genPattern(rng, spec, run.level) : genRandom(rng, spec);
    target = gen.notes;
    info = gen.info;
    attempt = [];
    lastPlaced = null;
    cursor = null;
    board.configure({ columns: spec.cols });
    board.setInteractive(false);
    board.setNotes([]);
    ctx.readout(null);
    ctx.timer.reset(true);
    ctx.setPhase("ready");
    ctx.splash(`Level ${run.level}`, `${spec.n} notes · ${spec.cols} columns`);
    ctx.status("Get ready…");
    ctx.pips(new Array(spec.n).fill(""));
    ctx.later(startFlash, READY_MS);
  }

  function startFlash() {
    ctx.setPhase("flash");
    board.setNotes(target.map((t) => ({ ...t, cls: "ink" })), { animate: "pop" });
    flashStart = performance.now();
    ctx.status(`Memorise · ${target.length} notes`);
    ctx.timer.start(spec.viewMs);
    ctx.later(endFlash, spec.viewMs);
  }

  function endFlash() {
    if (ctx.phase !== "flash") return;
    ctx.clearTimers();
    ctx.timer.reset(false);
    ctx.setPhase("recall");
    board.setNotes([]);
    board.setInteractive("place");
    setAcc(0);
    renderAttempt();
  }

  function grade() {
    board.setInteractive(false);
    ctx.readout(null);
    const g = gradeAttempt(target, attempt);
    board.setNotes(g.shown, { animate: "stagger" });
    const n = target.length;
    const wrong = g.wrongAcc + g.wrongPos;
    ctx.pips([...Array(g.good).fill("good"), ...Array(wrong).fill("bad"), ...Array(g.missed).fill("missed")]);
    const elapsed = performance.now() - flashStart;
    const allowance = spec.viewMs + n * 1800;
    const speed = Math.round(Math.max(0, Math.min(1, (allowance - elapsed) / allowance)) * n * 10);
    ctx.finishRound({
      success: g.perfect,
      base: n * 10 + speed,
      partial: g.good * 5,
      units: [g.good, n],
      title: g.perfect ? undefined : g.good ? `${g.good} of ${n} right` : "Missed it",
      tip: buildTip({ target, info, g, success: g.perfect, roundIndex }),
      legend: g.perfect ? null : [["good", "Correct"], ["bad", "Wrong"], ["missed", "Missed"]],
      actions: [{ label: "🔊 Hear it", key: "h", onClick: hear }],
    });
  }

  async function hear() {
    try {
      // Stop first: stopAllSound() mutes the output until ensureAudioReady()
      // un-mutes it, so the other order would play into silence.
      stopAllSound();
      await ensureAudioReady();
      if (ctx.isDestroyed()) return;
      const cols = [...new Set(target.map((t) => t.col))].sort((a, b) => a - b);
      cols.forEach((c, i) => {
        const midis = target.filter((t) => t.col === c).map(midiOf);
        ctx.later(() => playNotes(midis, { mode: "harmonic", noteDur: 1.1 }), i * 520);
      });
    } catch (err) {
      console.warn("[SmartEar] visual-memory playback error:", err);
    }
  }

  function moveCursor(dc, dd) {
    const start = cursor || board.preview;
    if (!start) cursor = { col: 0, d: 34 };
    else
      cursor = {
        col: Math.max(0, Math.min(spec.cols - 1, start.col + dc)),
        d: Math.max(board.dMin, Math.min(board.dMax, start.d + dd)),
      };
    board.setPreview(cursor.col, cursor.d, acc);
    showReadout(cursor);
  }

  return {
    startRound,
    onKey(e) {
      const k = e.key;
      if (ctx.phase === "flash") {
        if (k === " " || k === "Enter") return endFlash(), true;
        return false;
      }
      if (ctx.phase !== "recall") return false;
      if (k === "1") return setAcc(-1), true;
      if (k === "2") return setAcc(0), true;
      if (k === "3" || k === "#") return setAcc(1), true;
      if (k === "Backspace") return undoBtn.click(), true;
      if (k === "Enter") return checkBtn.click(), true;
      if (k === "ArrowUp") return moveCursor(0, e.shiftKey ? 7 : 1), true;
      if (k === "ArrowDown") return moveCursor(0, e.shiftKey ? -7 : -1), true;
      if (k === "ArrowLeft") return moveCursor(-1, 0), true;
      if (k === "ArrowRight") return moveCursor(1, 0), true;
      if (k === " ") {
        const p = cursor || board.preview;
        if (p) placeAt(p.col, p.d);
        return true;
      }
      return false;
    },
    destroy() {},
  };
}

const GAME = {
  id: "visual-memory",
  title: "Visual Memory",
  memoryType: "Remember what you see",
  tagline: "Notes flash on the staff. Put them back where they were.",
  storageKey: "smartear_visual_memory_v2",
  docId: "visual-memory-progress",
  legacyModes: { chords: "classic", scatter: "classic" },
  unitLabel: "Notes recalled",
  accuracyLabel: "Note accuracy",
  modes: {
    classic: { blurb: "3 lives. Every perfect rebuild adds a note — and the board grows." },
    daily: { blurb: "Same snapshots for everyone today." },
    training: { blurb: "No lives — the level follows you." },
  },
  howTo: [
    ["Look", "Notes appear for a few seconds — mostly random, sometimes a pattern. Nothing plays: eyes only."],
    ["Rebuild", "Tap the staff where each note was. Choose ♭ ♮ ♯ first; tap a note again to remove it."],
    ["Climb", "A perfect board adds one more note. Three misses and the run is over."],
  ],
  keysHint: "<kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> place · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> ♭ ♮ ♯ · <kbd>⌫</kbd> undo · <kbd>Enter</kbd> check",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
