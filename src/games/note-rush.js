// note-rush.js, Note Rush: flash cards of notes on a staff, in every key.
// A card shows a clef, a key signature and a note. Name the sounding note
// on the computer keyboard (or tap the piano) before the bar runs out.
// The key signature counts: an F in D major is an F♯. Later cards change
// key, switch to the bass clef, carry their own accidentals, and show two
// notes, which you enter from the bottom up. Each level is a set of cards;
// the time per card shrinks as you climb.
//
// Built on memory-kit, so it gets lives, Daily, Practice, ranks and the
// leaderboard like the other games.

import { createPiano } from "./memory-inputs.js";
import { playNotes, stopAllSound } from "./audio.js";
import { noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { openMemoryGame, el, pick, randInt } from "./memory-kit.js";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
const VEX_KEY = { 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#", "-1": "F", "-2": "Bb", "-3": "Eb", "-4": "Ab", "-5": "Db", "-6": "Gb", "-7": "Cb" };
const KEY_NAME = { 0: "C major", 1: "G major", 2: "D major", 3: "A major", 4: "E major", 5: "B major", 6: "F♯ major", 7: "C♯ major", "-1": "F major", "-2": "B♭ major", "-3": "E♭ major", "-4": "A♭ major", "-5": "D♭ major", "-6": "G♭ major", "-7": "C♭ major" };
// Diatonic step numbers (octave * 7 + letter): the staff's bottom and top lines.
const RANGE = { treble: [30, 38], bass: [18, 26] }; // E4–F5, G2–A3
const MILESTONES = { 10: "10 streak", 25: "25 streak", 50: "50 streak!", 75: "75 streak!", 100: "100 streak!!" };

// Computer-keyboard layouts.
const PIANO_ROW = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11 };
const LAYOUTS = {
  letters: { label: "Letters", sub: "Shift = ♯" },
  piano: { label: "Piano rows", sub: "ASDF + WETYU" },
};

const mod = (n, m) => ((n % m) + m) % m;

/** Level → how cards are made. */
export function spec(level) {
  const L = Math.max(1, level);
  return {
    cards: 8 + Math.min(4, Math.floor(L / 3)),
    maxAcc: [0, 0, 1, 2, 3, 4, 5, 7][Math.min(L, 7)],
    keyEvery: L <= 1 ? 99 : L <= 3 ? 3 : L <= 5 ? 2 : 1,
    clefs: L >= 4 ? ["treble", "bass"] : ["treble"],
    ledger: L >= 8 ? 2 : L >= 5 ? 1 : 0,
    dyad: L >= 7 ? Math.min(0.6, 0.3 + 0.05 * (L - 7)) : 0,
    written: L >= 9 ? Math.min(0.3, 0.12 + 0.03 * (L - 9)) : 0,
    ms: Math.max(650, Math.round(3000 - 230 * (L - 1))),
  };
}

/** The alteration a key signature gives a letter (+1 sharp, -1 flat, 0). */
function keyAlter(key, letter) {
  if (key > 0) return SHARP_ORDER.slice(0, key).includes(letter) ? 1 : 0;
  if (key < 0) return FLAT_ORDER.slice(0, -key).includes(letter) ? -1 : 0;
  return 0;
}

/** One note on a card: step number, plus a written accidental or null. */
function makeNote(key, step, written = null) {
  const letter = mod(step, 7);
  const oct = Math.floor(step / 7);
  const alter = written ?? keyAlter(key, letter);
  const midi = (oct + 1) * 12 + LETTER_PC[letter] + alter;
  return { step, letter, oct, written, alter, midi, pc: mod(midi, 12) };
}

function makeCard(rng, sp, key, clef, prevStep) {
  const [lo0, hi0] = RANGE[clef];
  const lo = lo0 - 2 * sp.ledger;
  const hi = hi0 + 2 * sp.ledger;
  if (rng() < sp.dyad) {
    const gap = randInt(rng, 2, 7);
    const a = randInt(rng, lo, hi - gap);
    return { key, clef, notes: [makeNote(key, a), makeNote(key, a + gap)] };
  }
  let s = randInt(rng, lo, hi);
  if (s === prevStep) s = s + 1 <= hi ? s + 1 : s - 1;
  let written = null;
  if (rng() < sp.written) {
    const base = keyAlter(key, mod(s, 7));
    written = pick(rng, [-1, 0, 1].filter((x) => x !== base));
  }
  return { key, clef, notes: [makeNote(key, s, written)] };
}

function pcName(pc) {
  const sys = getNoteSystem();
  const white = LETTER_PC.indexOf(pc);
  if (white >= 0) return noteLabel({ letter: LETTERS[white], alter: 0 }, sys);
  const below = LETTERS[LETTER_PC.indexOf(pc - 1)];
  const above = LETTERS[LETTER_PC.indexOf(pc + 1)];
  return `${noteLabel({ letter: below, alter: 1 }, sys)}/${noteLabel({ letter: above, alter: -1 }, sys)}`;
}
function spelled(n) {
  return noteLabel({ letter: LETTERS[n.letter], alter: n.alter }, getNoteSystem());
}

/** Draw a card's staff with VexFlow; returns the SVG. */
function drawStaff(host, card) {
  host.innerHTML = "";
  const { Renderer, Stave, StaveNote, Formatter, Accidental } = globalThis.Vex.Flow;
  const W = 236;
  const H = 112;
  const r = new Renderer(host, Renderer.Backends.SVG);
  r.resize(W, H);
  const c = r.getContext();
  const stave = new Stave(2, -8, W - 4);
  stave.addClef(card.clef).addKeySignature(VEX_KEY[card.key]);
  stave.setContext(c).draw();
  const note = new StaveNote({ clef: card.clef, keys: card.notes.map((n) => `${LETTERS[n.letter].toLowerCase()}/${n.oct}`), duration: "w", align_center: true });
  card.notes.forEach((n, i) => {
    if (n.written !== null) note.addModifier(new Accidental(n.written === 1 ? "#" : n.written === -1 ? "b" : "n"), i);
  });
  Formatter.FormatAndDraw(c, stave, [note]);
  const svg = host.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.width = "100%";
  svg.style.height = "auto";
  return svg;
}

function createRunner(ctx) {
  const { run, rng, stage, controls, fx } = ctx;
  const layout = LAYOUTS[ctx.prefs.keys] ? ctx.prefs.keys : "letters";
  if (run.noteStreak === undefined) run.noteStreak = 0;
  if (run.bestStreak === undefined) run.bestStreak = 0;

  stage.innerHTML = "";
  const top = el("div", "nr-top");
  const keyTag = el("div", "nr-keytag", "");
  const counter = el("div", "nr-count mono", "");
  const streak = el("div", "nr-streak");
  const streakN = el("b", "mono", "0");
  streak.append(streakN, el("span", "", "streak"));
  top.append(keyTag, counter, streak);
  const cardEl = el("div", "nr-card");
  const staffHost = el("div", "nr-staff");
  const answer = el("div", "nr-answer");
  cardEl.append(staffHost, answer);
  stage.append(top, cardEl);

  controls.innerHTML = "";
  const pianoWrap = el("div", "mk-piano-wrap nr-piano");
  controls.appendChild(pianoWrap);
  const piano = createPiano(pianoWrap, { low: 60, high: 71, onPress: (m) => input(mod(m, 12), "tap") });
  const hint = el("div", "nr-hint");
  hint.innerHTML =
    layout === "piano"
      ? "Type: <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd> = C D E F G A B · <kbd>W</kbd><kbd>E</kbd><kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd> = black keys"
      : "Type the letter: <kbd>G</kbd> = G · hold <kbd>Shift</kbd> for ♯ (<kbd>Shift</kbd>+<kbd>A</kbd> = A♯/B♭)";
  controls.appendChild(hint);

  let sp = spec(run.level);
  let cards = [];
  let ci = 0;
  let ni = 0; // which note of the card we're waiting for
  let token = 0;
  let cardStart = 0;
  let roundPts = 0;
  let hits = 0;
  let lastKey = null;
  let lastClef = null;
  let live = false;

  function setStreak(n) {
    run.noteStreak = n;
    run.bestStreak = Math.max(run.bestStreak, n);
    streakN.textContent = String(n);
    streak.classList.toggle("hot", n >= 10);
    streak.classList.toggle("blazing", n >= 25);
    if (n) fx.kick(streak, "pump", 300);
  }

  function buildRound() {
    sp = spec(run.level);
    cards = [];
    let key = lastKey ?? 0;
    let clef = "treble";
    let prev = null;
    for (let i = 0; i < sp.cards; i++) {
      if (i % sp.keyEvery === 0) key = sp.maxAcc ? randInt(rng, -sp.maxAcc, sp.maxAcc) : 0;
      if (i % 2 === 0 || sp.clefs.length === 1) clef = pick(rng, sp.clefs);
      const card = makeCard(rng, sp, key, clef, prev);
      prev = card.notes[0].step;
      cards.push(card);
    }
  }

  function showCard() {
    const my = ++token;
    const card = cards[ci];
    ni = 0;
    answer.textContent = "";
    answer.className = "nr-answer";
    cardEl.classList.remove("in", "out", "miss");
    drawStaff(staffHost, card);
    void cardEl.offsetWidth;
    cardEl.style.setProperty("--nr-in", `${Math.min(180, Math.round(sp.ms * 0.1))}ms`);
    cardEl.classList.add("in");
    const newKey = card.key !== lastKey && ci > 0;
    const newClef = card.clef !== lastClef && ci > 0;
    keyTag.textContent = newClef ? (card.clef === "bass" ? "Bass clef!" : "Treble clef!") : newKey ? "New key!" : "";
    if (newKey || newClef) fx.kick(keyTag, "flash", 700);
    lastKey = card.key;
    lastClef = card.clef;
    counter.textContent = `${ci + 1}/${cards.length}`;
    piano.clear();
    const ms = card.notes.length > 1 ? Math.round(sp.ms * 1.9) : sp.ms;
    cardStart = performance.now();
    ctx.timer.start(ms);
    ctx.later(() => my === token && live && miss("time"), ms);
  }

  function input(pc, how) {
    if (!live || ctx.phase !== "play") return false;
    const card = cards[ci];
    const want = card.notes[ni];
    if (pc === want.pc) {
      piano.flash(60 + pc, "good", 200);
      playNotes([want.midi], { mode: "melodic", noteDur: 0.35, velocity: 0.75 });
      const head = staffHost.querySelectorAll(".vf-notehead")[ni];
      if (head) head.classList.add("nr-hit");
      ni++;
      if (ni >= card.notes.length) hit();
    } else {
      piano.flash(60 + pc, "bad", 500);
      miss("wrong", pc);
    }
    void how;
    return true;
  }

  function hit() {
    token++;
    const card = cards[ci];
    const ms = card.notes.length > 1 ? sp.ms * 1.9 : sp.ms;
    const left = Math.max(0, 1 - (performance.now() - cardStart) / ms);
    const pts = 10 + 2 * run.level + Math.round(12 * left) + 6 * (card.notes.length - 1);
    roundPts += pts;
    hits++;
    setStreak(run.noteStreak + 1);
    cardEl.classList.remove("in");
    cardEl.classList.add("out");
    fx.burst(cardEl, { count: left > 0.6 ? 14 : 9, kind: "good" });
    fx.floatText(cardEl, left > 0.66 ? `+${pts} fast!` : `+${pts}`);
    const m = MILESTONES[run.noteStreak];
    if (m) fx.banner(ctx.card, m, "Keep going");
    ci++;
    if (ci >= cards.length) {
      live = false;
      ctx.later(() => {
        ctx.finishRound({ success: true, base: roundPts, units: [hits, cards.length], title: run.noteStreak >= 25 ? "Blazing" : "Level cleared" });
      }, 160);
    } else ctx.later(showCard, 110);
  }

  function miss(why, pressed) {
    live = false;
    token++;
    ctx.timer.reset(false);
    setStreak(0);
    const card = cards[ci];
    cardEl.classList.remove("in", "out");
    void cardEl.offsetWidth;
    cardEl.classList.add("miss");
    const heads = staffHost.querySelectorAll(".vf-notehead");
    card.notes.forEach((n, i) => {
      if (i >= ni && heads[i]) heads[i].classList.add("nr-want");
      piano.flash(60 + n.pc, "hint", 1600);
    });
    const names = card.notes.map(spelled).join(" then ");
    answer.textContent = `It was ${names}`;
    answer.className = "nr-answer show";
    playNotes(card.notes.map((n) => n.midi), { mode: "melodic", noteDur: 0.5, gap: 0.22 });
    const inKey = card.notes.some((n) => n.written === null && n.alter !== 0);
    let tip = `${names} in ${KEY_NAME[card.key]} (${card.clef} clef).`;
    if (why === "wrong" && pressed !== undefined) tip = `You pressed ${pcName(pressed)}. ${tip}`;
    if (inKey) tip += " The key signature changes that letter.";
    if (card.notes.length > 1) tip += " Two notes: enter the lower one first.";
    tip += ` ${hits}/${cards.length} cards.`;
    ctx.later(() => {
      ctx.finishRound({ success: false, partial: roundPts, units: [hits, cards.length], title: why === "time" ? "Too slow" : "Wrong note", tip });
    }, 650);
  }

  // Dev builds only (removed from the published site): lets tests read the answer.
  if (import.meta.env && import.meta.env.DEV) globalThis.__noteRush = { want: () => (live && cards[ci] ? cards[ci].notes.slice(ni).map((n) => n.pc) : null) };

  return {
    startRound() {
      stopAllSound();
      ci = 0;
      roundPts = 0;
      hits = 0;
      buildRound();
      ctx.setPhase("ready");
      ctx.splash(`Level ${run.level}`, `${sp.cards} cards · ${(sp.ms / 1000).toFixed(1)} s each${sp.dyad ? " · two-note cards" : ""}`);
      ctx.status(sp.dyad ? "Two notes? Lower one first." : "Name the note. The key signature counts.");
      setStreak(run.noteStreak);
      ctx.later(() => {
        ctx.setPhase("play");
        live = true;
        showCard();
      }, 640);
    },
    onKey(e) {
      if (e.repeat) return false;
      if (layout === "piano") {
        const pc = PIANO_ROW[e.code];
        return pc === undefined ? false : input(pc, "key");
      }
      const k = (e.key || "").toUpperCase();
      const li = LETTERS.indexOf(k);
      if (li < 0 || k.length !== 1) return false;
      return input(mod(LETTER_PC[li] + (e.shiftKey ? 1 : 0), 12), "key");
    },
    destroy() {
      live = false;
      token++;
    },
  };
}

function renderSettings(slot, prefs, setPref) {
  slot.appendChild(el("div", "mk-section-label", "Answer with your keyboard"));
  const seg = el("div", "mk-seg");
  seg.setAttribute("role", "radiogroup");
  const current = LAYOUTS[prefs.keys] ? prefs.keys : "letters";
  Object.entries(LAYOUTS).forEach(([id, c]) => {
    const b = el("button", "mk-seg-btn" + (id === current ? " active" : ""));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(id === current));
    b.append(el("span", "mk-seg-label", c.label), el("span", "mk-seg-sub mono", c.sub));
    b.addEventListener("click", () => {
      setPref("keys", id);
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
  id: "note-rush",
  title: "Note Rush",
  tagline: "Notes flash in every key. Name them before the bar runs out. It only gets faster.",
  storageKey: "smartear_note_rush_v1",
  docId: "note-rush-progress",
  unitLabel: "Cards read",
  accuracyLabel: "Cards read",
  defaultPrefs: { keys: "letters" },
  renderSettings,
  modes: {
    classic: { blurb: "3 lives. Every level is faster." },
    daily: { blurb: "Same cards for everyone today." },
    training: { blurb: "No lives, the speed follows you." },
  },
  howTo: [
    ["Read", "A card shows a clef, a key signature and a note. The key signature counts: F in D major is F♯."],
    ["Answer", "Type the letter (hold Shift for ♯), use piano rows, or tap the piano. Beat the bar."],
    ["Two notes", "From level 7 some cards have two notes. Enter them from the bottom up."],
  ],
  keysHint: "<kbd>A</kbd>–<kbd>G</kbd> note · <kbd>Shift</kbd> = ♯",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
