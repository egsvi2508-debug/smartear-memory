// interval-rush.js, Interval Rush: two notes play, name the interval fast.
// Starts with three easy intervals and adds more each level; then the
// notes start going down, then sound together, and the answer time
// shrinks. After every answer the two notes show on a staff, so the
// clip teaches as it goes. Answer with the big buttons or the number
// keys (the number of semitones: 1 = minor 2nd ... = = octave).
//
// Built on memory-kit.

import { ensureAudioReady, playNotes, stopAllSound, unmute, scheduleLength, Tone } from "./audio.js";
import { noteLabel } from "./theory.js";
import { getNoteSystem } from "./settings.js";
import { openMemoryGame, el, pick, randInt } from "./memory-kit.js";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const mod = (n, m) => ((n % m) + m) % m;

// semitones → names and staff steps (the tritone is written as an augmented 4th)
const IV = {
  1: { short: "m2", long: "Minor 2nd", steps: 1 },
  2: { short: "M2", long: "Major 2nd", steps: 1 },
  3: { short: "m3", long: "Minor 3rd", steps: 2 },
  4: { short: "M3", long: "Major 3rd", steps: 2 },
  5: { short: "P4", long: "Perfect 4th", steps: 3 },
  6: { short: "TT", long: "Tritone", steps: 3 },
  7: { short: "P5", long: "Perfect 5th", steps: 4 },
  8: { short: "m6", long: "Minor 6th", steps: 5 },
  9: { short: "M6", long: "Major 6th", steps: 5 },
  10: { short: "m7", long: "Minor 7th", steps: 6 },
  11: { short: "M7", long: "Major 7th", steps: 6 },
  12: { short: "P8", long: "Octave", steps: 7 },
};
const KEY_OF = { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "0", 11: "-", 12: "=" };
const SEMIS_OF_KEY = Object.fromEntries(Object.entries(KEY_OF).map(([s, k]) => [k, Number(s)]));
const ADD_ORDER = [[4, 7, 12], [5], [3], [2], [9, 1], [8, 10], [11, 6]];

/** Level → which intervals, which directions, how fast. */
export function spec(level) {
  const L = Math.max(1, level);
  const pool = ADD_ORDER.slice(0, Math.min(ADD_ORDER.length, L)).flat().sort((a, b) => a - b);
  return {
    pool,
    cards: 8 + Math.min(4, Math.floor(L / 3)),
    down: L >= 8 ? 0.5 : L >= 4 ? 0.3 : 0,
    together: L >= 8 ? 0.35 : L >= 6 ? 0.25 : 0,
    gap: Math.max(0.26, 0.55 - 0.025 * (L - 1)), // seconds between the two notes
    ms: Math.max(1300, Math.round(4200 - 260 * (L - 1))), // answer time after the sound
  };
}

/** A note from a staff step (octave * 7 + letter) and an exact MIDI number. */
function note(step, midi) {
  const letter = mod(step, 7);
  const oct = Math.floor(step / 7);
  const natural = (oct + 1) * 12 + LETTER_PC[letter];
  return { step, letter, oct, midi, alter: midi - natural };
}

function makeCard(rng, sp, prevSemis) {
  let semis = pick(rng, sp.pool);
  if (semis === prevSemis && sp.pool.length > 1) semis = pick(rng, sp.pool.filter((x) => x !== semis));
  const down = rng() < sp.down;
  const together = rng() < sp.together;
  const rootStep = randInt(rng, down ? 29 : 25, down ? 36 : 32); // D4–C5 going down, G3–G4 going up
  const rootLetter = mod(rootStep, 7);
  const rootMidi = (Math.floor(rootStep / 7) + 1) * 12 + LETTER_PC[rootLetter];
  const root = note(rootStep, rootMidi);
  const iv = IV[semis];
  const other = down ? note(rootStep - iv.steps, rootMidi - semis) : note(rootStep + iv.steps, rootMidi + semis);
  const notes = down ? [root, other] : [root, other]; // in the order they play
  return { semis, down: down && !together, together, notes };
}

function noteName(n) {
  return noteLabel({ letter: LETTERS[n.letter], alter: n.alter }, getNoteSystem());
}

function drawStaff(host, card) {
  host.innerHTML = "";
  const { Renderer, Stave, StaveNote, Formatter, Accidental, Voice } = globalThis.Vex.Flow;
  const W = 236;
  const H = 112;
  const r = new Renderer(host, Renderer.Backends.SVG);
  r.resize(W, H);
  const c = r.getContext();
  const low = Math.min(card.notes[0].midi, card.notes[1].midi);
  const clef = low >= 53 ? "treble" : "bass";
  const stave = new Stave(2, -8, W - 4);
  stave.addClef(clef);
  stave.setContext(c).draw();
  const key = (n) => `${LETTERS[n.letter].toLowerCase()}/${n.oct}`;
  const acc = (sn, n, i) => n.alter && sn.addModifier(new Accidental(n.alter === 1 ? "#" : n.alter === -1 ? "b" : n.alter === 2 ? "##" : "bb"), i);
  let notes;
  if (card.together) {
    const sorted = [...card.notes].sort((a, b) => a.midi - b.midi);
    const sn = new StaveNote({ clef, keys: sorted.map(key), duration: "w", align_center: true });
    sorted.forEach((n, i) => acc(sn, n, i));
    notes = [sn];
  } else {
    notes = card.notes.map((n) => {
      const sn = new StaveNote({ clef, keys: [key(n)], duration: "h" });
      acc(sn, n, 0);
      return sn;
    });
  }
  if (notes.length === 1) Formatter.FormatAndDraw(c, stave, notes);
  else {
    const v = new Voice({ num_beats: 4, beat_value: 4 }).addTickables(notes);
    new Formatter().joinVoices([v]).format([v], W - 110);
    v.draw(c, stave);
  }
  const svg = host.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.width = "100%";
  svg.style.height = "auto";
}

function createRunner(ctx) {
  const { run, rng, stage, controls, fx } = ctx;

  stage.innerHTML = "";
  const top = el("div", "nr-top");
  const tag = el("div", "nr-keytag", "");
  const counter = el("div", "nr-count mono", "");
  top.append(tag, counter);

  const card = el("div", "ir-card");
  const listen = el("div", "ir-listen");
  const dotA = el("div", "ir-dot", "1");
  const link = el("div", "ir-link", "?");
  const dotB = el("div", "ir-dot", "2");
  listen.append(dotA, link, dotB);
  const reveal = el("div", "ir-reveal");
  const staffHost = el("div", "ir-staff");
  const revealName = el("div", "ir-name");
  reveal.append(staffHost, revealName);
  card.append(listen, reveal);
  stage.append(top, card);

  controls.innerHTML = "";
  const grid = el("div", "ir-grid");
  const buttons = new Map();
  controls.appendChild(grid);
  const foot = el("div", "ir-foot");
  const replay = el("button", "mk-btn ghost ir-replay", "Replay");
  replay.addEventListener("click", () => play(false));
  foot.append(replay);
  controls.appendChild(foot);

  let sp = spec(run.level);
  let cards = [];
  let ci = 0;
  let token = 0;
  let live = false;
  let misses = 0; // Levels: wrong cards this round (a few are fine)
  const allowedMisses = () => Math.floor(cards.length / 4);

  function buildButtons() {
    grid.innerHTML = "";
    buttons.clear();
    const cols = sp.pool.length <= 4 ? sp.pool.length : sp.pool.length <= 8 ? 4 : 6;
    grid.style.setProperty("--cols", cols);
    grid.classList.toggle("wide", cols > 4);
    sp.pool.forEach((s) => {
      const b = el("button", "ir-btn");
      b.append(el("b", "", IV[s].short), el("span", "", IV[s].long), el("kbd", "", KEY_OF[s]));
      b.addEventListener("click", () => answer(s));
      grid.appendChild(b);
      buttons.set(s, b);
    });
  }

  function play(first) {
    const c = cards[ci];
    if (!c) return 0;
    stopAllSound();
    unmute(); // stopAllSound() mutes the output; turn it back on for this interval
    const midis = c.notes.map((n) => n.midi);
    const sound = () => (c.together ? playNotes(midis, { mode: "harmonic", noteDur: 1.1, velocity: 0.85 }) : playNotes(midis, { mode: "melodic", noteDur: sp.gap * 1.7, gap: sp.gap, velocity: 0.85 }));
    const sched = sound();
    const my = token;
    if (import.meta.env && import.meta.env.DEV) globalThis.__irSound = { notes: sched.length, muted: Tone.getDestination().mute, state: Tone.getContext().state };
    // Audio not allowed yet (no tap on this page so far): play it as soon as it is.
    if (!sched.length) ensureAudioReady().then(() => my === token && !ctx.isDestroyed() && (unmute(), sound()), () => {});
    const len = Math.round(scheduleLength(sched)); // already in ms
    // light the dots in time with the sound
    if (c.together) {
      fx.kick(dotA, "ring", 500);
      fx.kick(dotB, "ring", 500);
    } else {
      fx.kick(dotA, "ring", 500);
      ctx.later(() => my === token && fx.kick(dotB, "ring", 500), Math.round(sp.gap * 1000));
    }
    if (first) return Math.max(len - 200, Math.round(sp.gap * 1000) + 150);
    return 0;
  }

  function showCard() {
    const my = ++token;
    const c = cards[ci];
    card.classList.remove("revealed", "missed", "in");
    void card.offsetWidth;
    card.classList.add("in");
    link.textContent = "?";
    listen.classList.toggle("together", c.together);
    tag.textContent = c.together ? "Together!" : c.down ? "Going down!" : "";
    if (c.together || c.down) fx.kick(tag, "flash", 700);
    counter.textContent = `${ci + 1}/${cards.length}`;
    buttons.forEach((b) => b.classList.remove("good", "bad", "want"));
    live = true;
    const wait = play(true);
    ctx.timer.reset(true);
    ctx.later(() => {
      if (my !== token || !live) return;
      ctx.timer.start(sp.ms);
      ctx.later(() => my === token && live && miss(null), sp.ms);
    }, wait);
  }

  function showReveal(c, kind) {
    drawStaff(staffHost, c);
    const names = c.notes.map(noteName).join(c.together ? " + " : c.down ? " ↓ " : " ↑ ");
    revealName.innerHTML = "";
    revealName.append(el("b", "", IV[c.semis].long), el("span", "", names));
    card.classList.add(kind === "good" ? "revealed" : "missed");
    link.textContent = IV[c.semis].short;
  }

  function answer(s) {
    if (!live || ctx.phase !== "play") return false;
    const c = cards[ci];
    if (s === c.semis) hit(s);
    else miss(s);
    return true;
  }

  function hit(s) {
    live = false;
    token++;
    const c = cards[ci];
    ctx.hit();
    buttons.get(s)?.classList.add("good");
    showReveal(c, "good");
    fx.burst(card, { count: 10 });
    ci++;
    if (ci >= cards.length) {
      ctx.later(() => ctx.finishRound({ success: misses <= allowedMisses() }), 450);
    } else ctx.later(showCard, 520);
  }

  function miss(pressed) {
    live = false;
    token++;
    ctx.timer.reset(false);
    const c = cards[ci];
    if (pressed) buttons.get(pressed)?.classList.add("bad");
    buttons.get(c.semis)?.classList.add("want");
    showReveal(c, "bad");
    fx.kick(card, "shakeit", 450);
    if (!ctx.streakMode) {
      // Levels: a mistake doesn't stop you, the next card comes right away.
      ctx.miss();
      misses++;
      ci++;
      ctx.later(() => (ci >= cards.length ? ctx.finishRound({ success: misses <= allowedMisses() }) : showCard()), 650);
      return;
    }
    ctx.later(() => play(false), 250);
    const tip = `${IV[c.semis].long} · ${c.notes.map(noteName).join(" ")}`;
    ctx.later(() => ctx.finishRound({ success: false, tip, actions: [{ label: "Hear it", key: "h", onClick: () => play(false) }] }), 900);
  }

  // Dev builds only (removed from the published site): lets tests read the answer.
  if (import.meta.env && import.meta.env.DEV) globalThis.__intervalRush = { want: () => (live && cards[ci] ? cards[ci].semis : null) };

  return {
    async startRound() {
      stopAllSound();
      sp = spec(run.level);
      ci = 0;
      misses = 0;
      cards = [];
      let prev = null;
      for (let i = 0; i < sp.cards; i++) {
        const c = makeCard(rng, sp, prev);
        prev = c.semis;
        cards.push(c);
      }
      buildButtons();
      ctx.setPhase("ready");
      ctx.splash(`Level ${run.level}`);
      ctx.status("");
      const my = token;
      await Promise.race([ensureAudioReady().catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
      ctx.later(() => {
        if (my !== token) return;
        ctx.setPhase("play");
        showCard();
      }, 600);
    },
    onKey(e) {
      if (e.repeat) return false;
      if (e.key === " ") {
        if (cards[ci] && ctx.phase === "play") play(false);
        return true;
      }
      const s = SEMIS_OF_KEY[e.key];
      if (s === undefined || !sp.pool.includes(s)) return false;
      return answer(s);
    },
    destroy() {
      live = false;
      token++;
    },
  };
}

const GAME = {
  id: "interval-rush",
  title: "Interval Rush",
  storageKey: "smartear_interval_rush_v1",
  createRunner,
};

export function open(container, opts) {
  return openMemoryGame(container, GAME, opts);
}
