// note-rush.js, Note Rush: flash cards of notes on a staff, in every key.
// A card shows a clef, a key signature and a note. Name the sounding note
// on the computer keyboard (or tap the piano) before the bar runs out.
// The key signature counts: an F in D major is an F♯. Later cards change
// key, switch to the bass clef, carry their own accidentals, and show two
// notes, which you enter from the bottom up. Each level is a set of cards;
// the time per card shrinks as you climb.
//
// Built on memory-kit.

import { createPiano } from "./memory-inputs.js";
import { playNotes, stopAllSound, unmute } from "./audio.js";
import { noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { openMemoryGame, el, pick, randInt } from "./memory-kit.js";
import { noteFromKey, keysHint, renderKeysChoice } from "../lib/keys";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
const VEX_KEY = { 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#", "-1": "F", "-2": "Bb", "-3": "Eb", "-4": "Ab", "-5": "Db", "-6": "Gb", "-7": "Cb" };
const KEY_NAME = { 0: "C major", 1: "G major", 2: "D major", 3: "A major", 4: "E major", 5: "B major", 6: "F♯ major", 7: "C♯ major", "-1": "F major", "-2": "B♭ major", "-3": "E♭ major", "-4": "A♭ major", "-5": "D♭ major", "-6": "G♭ major", "-7": "C♭ major" };
// Diatonic step numbers (octave * 7 + letter): the staff's bottom and top lines.
const RANGE = {
  treble: [30, 38], // E4–F5
  bass: [18, 26], // G2–A3
  alto: [24, 32], // F3–G4
  tenor: [22, 30], // D3–E4
  soprano: [28, 36], // C4–D5
  "mezzo-soprano": [26, 34], // A3–B4
  "baritone-c": [20, 28], // B2–C4
};
const CLEF_NAME = { treble: "Treble clef", bass: "Bass clef", alto: "Alto clef", tenor: "Tenor clef", soprano: "Soprano clef", "mezzo-soprano": "Mezzo clef", "baritone-c": "Baritone clef" };
/** Clefs by level: treble, then bass, then the C clefs, then the rare ones. */
function clefsFor(L) {
  const c = ["treble"];
  if (L >= 4) c.push("bass");
  if (L >= 10) c.push("alto");
  if (L >= 12) c.push("tenor");
  if (L >= 14) c.push("soprano", "mezzo-soprano", "baritone-c");
  return c;
}
// VexFlow can't place key signatures correctly on these, so they only get
// cards with no sharps or flats in the key.
const NO_KEYSIG = new Set(["soprano", "mezzo-soprano", "baritone-c"]);


// How long a card stays. Auto learns your pace (faster when you're quick and
// right, slower after a miss); Very fast = the level's own time; Slow has no clock.
const SPEEDS = {
  auto: { label: "Auto", mult: 1, auto: true },
  fast: { label: "Very fast", mult: 1 },
  medium: { label: "Medium", mult: 1.8 },
  slow: { label: "Slow", mult: 0 },
};

const mod = (n, m) => ((n % m) + m) % m;

// Auto pace: the time a one-note card gets, kept between visits.
const PACE_KEY = "hears:noteRushPace";
const PACE_MIN = 1200;
const PACE_MAX = 7000;
function readPace() {
  try {
    const v = Number(localStorage.getItem(PACE_KEY));
    return v >= PACE_MIN && v <= PACE_MAX ? v : 3500;
  } catch {
    return 3500;
  }
}
function savePace(v) {
  try {
    localStorage.setItem(PACE_KEY, String(Math.round(v)));
  } catch {
    /* ignore */
  }
}
/** Right answer in r ms: drift toward ~1.4× your time, so the clock follows
 *  you down as you get quicker and always leaves a little room. */
export function paceAfterHit(t, r) {
  const next = (0.8 * t + 0.2 * Math.max(r * 1.5, 900)) * 0.98;
  return Math.max(PACE_MIN, Math.min(PACE_MAX, next));
}
/** A miss or a timeout: give more time. */
export function paceAfterMiss(t) {
  return Math.min(PACE_MAX, t * 1.3);
}

/** Level → how cards are made. */
export function spec(level) {
  const L = Math.max(1, level);
  return {
    cards: 8 + Math.min(4, Math.floor(L / 3)),
    maxAcc: [0, 0, 1, 2, 3, 4, 5, 7][Math.min(L, 7)],
    keyEvery: L <= 1 ? 99 : L <= 3 ? 3 : L <= 5 ? 2 : 1,
    clefs: clefsFor(L),
    ledger: L >= 8 ? 2 : L >= 5 ? 1 : 0,
    dyad: L >= 7 ? Math.min(0.6, 0.3 + 0.05 * (L - 7)) : 0,
    written: L >= 9 ? Math.min(0.3, 0.12 + 0.03 * (L - 9)) : 0,
    ms: Math.max(1400, Math.round(3400 - 150 * (L - 1))),
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
  const speed = SPEEDS[ctx.prefs.speed] || SPEEDS.auto;
  let pace = readPace();
  let shownAt = 0;

  stage.innerHTML = "";
  const top = el("div", "nr-top");
  const keyTag = el("div", "nr-keytag", "");
  const counter = el("div", "nr-count mono", "");
  top.append(keyTag, counter);
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
  hint.textContent = keysHint();
  controls.appendChild(hint);
  const onKeysChanged = () => (hint.textContent = keysHint());
  window.addEventListener("hears:keys-changed", onKeysChanged);

  let sp = spec(run.level);
  let cards = [];
  let ci = 0;
  let ni = 0; // which note of the card we're waiting for
  let token = 0;
  let lastKey = null;
  let lastClef = null;
  let live = false;

  function buildRound() {
    sp = spec(run.level);
    cards = [];
    let key = lastKey ?? 0;
    let clef = "treble";
    let prev = null;
    for (let i = 0; i < sp.cards; i++) {
      if (i % sp.keyEvery === 0) key = sp.maxAcc ? randInt(rng, -sp.maxAcc, sp.maxAcc) : 0;
      if (i % 2 === 0 || sp.clefs.length === 1) clef = pick(rng, sp.clefs);
      if (i === 1 && sp.clefs.length > 2) clef = sp.clefs[sp.clefs.length - 1]; // show the newest clef early
      const card = makeCard(rng, sp, NO_KEYSIG.has(clef) ? 0 : key, clef, prev);
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
    keyTag.textContent = newClef ? `${CLEF_NAME[card.clef]}!` : newKey ? "New key!" : "";
    if (newKey || newClef) fx.kick(keyTag, "flash", 700);
    lastKey = card.key;
    lastClef = card.clef;
    counter.textContent = `${ci + 1}/${cards.length}`;
    piano.clear();
    if (!speed.mult) {
      ctx.timer.reset(true); // Slow: no clock, take your time
      return;
    }
    shownAt = performance.now();
    const base = speed.auto ? pace : sp.ms * speed.mult;
    const ms = Math.round(card.notes.length > 1 ? base * 1.9 : base);
    ctx.timer.start(ms);
    ctx.later(() => my === token && live && miss(), ms);
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
      miss();
    }
    void how;
    return true;
  }

  function hit() {
    token++;
    if (speed.auto) {
      const r = (performance.now() - shownAt) / (cards[ci].notes.length > 1 ? 1.9 : 1);
      pace = paceAfterHit(pace, r);
      savePace(pace);
    }
    ctx.hit();
    cardEl.classList.remove("in");
    cardEl.classList.add("out");
    fx.burst(cardEl, { count: 10, kind: "good" });
    ci++;
    if (ci >= cards.length) {
      live = false;
      ctx.later(() => {
        ctx.finishRound({ success: true });
      }, 160);
    } else ctx.later(showCard, 110);
  }

  function miss() {
    live = false;
    token++;
    if (speed.auto) {
      pace = paceAfterMiss(pace);
      savePace(pace);
    }
    ctx.timer.reset(false);
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
    const tip = `${names} · ${KEY_NAME[card.key]} · ${CLEF_NAME[card.clef]}`;
    ctx.later(() => {
      ctx.finishRound({ success: false, tip });
    }, 650);
  }

  // Dev builds only (removed from the published site): lets tests read the answer.
  if (import.meta.env && import.meta.env.DEV) globalThis.__noteRush = { want: () => (live && cards[ci] ? cards[ci].notes.slice(ni).map((n) => n.pc) : null) };

  return {
    startRound() {
      stopAllSound();
      unmute();
      ci = 0;
      buildRound();
      ctx.setPhase("ready");
      ctx.splash(`Level ${run.level}`);
      ctx.status(sp.dyad ? "Two notes: lower one first" : "");
      ctx.later(() => {
        ctx.setPhase("play");
        live = true;
        showCard();
      }, 640);
    },
    onKey(e) {
      if (e.repeat) return false;
      const n = noteFromKey(e);
      return n ? input(n.pc, "key") : false;
    },
    destroy() {
      live = false;
      token++;
      window.removeEventListener("hears:keys-changed", onKeysChanged);
    },
  };
}

function segment(slot, title, options, current, onPick) {
  slot.appendChild(el("div", "mk-section-label", title));
  const seg = el("div", "mk-seg");
  seg.setAttribute("role", "radiogroup");
  Object.entries(options).forEach(([id, c]) => {
    const b = el("button", "mk-seg-btn" + (id === current ? " active" : ""));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(id === current));
    b.append(el("span", "mk-seg-label", c.label));
    if (c.sub) b.append(el("span", "mk-seg-sub mono", c.sub));
    b.addEventListener("click", () => {
      seg.querySelectorAll(".mk-seg-btn").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-checked", String(x === b));
      });
      onPick(id);
    });
    seg.appendChild(b);
  });
  slot.appendChild(seg);
}

function renderSettings(slot, prefs, setPref) {
  segment(slot, "Speed", SPEEDS, SPEEDS[prefs.speed] ? prefs.speed : "auto", (id) => setPref("speed", id));
  renderKeysChoice(slot);
}

const GAME = {
  id: "note-rush",
  title: "Note Rush",
  storageKey: "smartear_note_rush_v1",
  defaultPrefs: { speed: "auto" },
  renderSettings,
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
