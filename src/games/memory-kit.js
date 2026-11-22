// memory-kit.js, the shared game shell for the Memory suite. Five games,
// five different kinds of memory, so the suite trains memory from every
// side rather than one skill five ways:
//   Visual Memory      SEE     , a notated snapshot (visuospatial)
//   Sequence Memory    ORDER   , a growing melody, played back (serial)
//   Sound Pairs        MATCH   , where each sound was (associative)
//   Pitch Hold         HOLD    , one pitch kept through a wait (retention)
//   Comparison Memory  COMPARE , same melody or changed? (recognition)
//
// Every memory game looks and flows the same, so moving between them costs
// nothing to learn:
//
//   HUB     , best scores, day streak, one big "Play" (Classic) plus the
//              Daily Challenge and Training, a 3-step how-to, and tabs to
//              jump to the other memory games.
//   RUN     , HUD (quit · level · lives · score), an ivory "stage" card the
//              game draws into, a status line with progress pips, the game's
//              own controls, and a shared result panel after every round.
//   SUMMARY , score count-up, personal-best ribbon, run stats, recent-runs
//              chart, Play again.
//
// Modes, identical in every game:
//   classic , 3 lives. Success → next level; a miss costs a life and
//              replays the level. Third miss ends the run.
//   daily   , Classic with a date-seeded RNG: the same content for everyone
//              today. Only the first run of the day is recorded.
//   training, no lives, adaptive: success → level up, miss → level down.
//              A 1-up/1-down staircase keeps you working right at the edge
//              of your span, which is where memory actually improves.
//
// A game plugs in as a spec object (see openMemoryGame) whose
// createRunner(ctx) builds the round UI inside the stage/controls the shell
// provides and reports each round's outcome through ctx.finishRound().
//
// Progress persists per game to localStorage and, when signed in, Firestore
// users/{uid}/modules/{docId}, same doc-per-module convention and
// fire-and-forget writes as Register ID's progress doc.

import { ensureAudioReady, stopAllSound, playCorrectFx, playWrongFx, Tone } from "./audio.js";
import * as fx from "./fx.js";

/** SmartEar v2 hooks, set by the island wrapper:
 *  load(docId) / save(docId, progress), account sync through the app store;
 *  onRound(gameId, outcome)            , every finished round (learning engine);
 *  onRunEnd(gameId, run)               , the end of a run (session, XP). */
/** @type {{ load: null | ((docId: string) => Promise<any>), save: null | ((docId: string, p: any) => void), onRound: null | ((gameId: string, o: any) => void), onRunEnd: null | ((gameId: string, r: any) => void) }} */
export const mkHooks = { load: null, save: null, onRound: null, onRunEnd: null };

export const LIVES = 3;
const HISTORY_LEN = 40;
const AUTO_NEXT_MS = 850; // after a clean round: keep the pace up
const FAIL_NEXT_MS = 2100; // after a miss: long enough to read the tip
const MILESTONES = { 3: "Heating up", 5: "On fire", 8: "Unstoppable", 12: "Legendary", 16: "Godlike" };
const MODE_IDS = ["classic", "daily", "training"];

/** The Memory suite, in menu order, drives the tab row on every hub. */
export const SUITE = [
  { id: "visual-memory", label: "Visual", type: "See" },
  { id: "sequence-memory", label: "Sequence", type: "Order" },
  { id: "pairs-memory", label: "Pairs", type: "Match" },
  { id: "hold-memory", label: "Pitch", type: "Hold" },
  { id: "memory", label: "Compare", type: "Spot" },
  { id: "relative-memory", label: "Relative", type: "Shift" },
];

const MODE_META = {
  classic: { name: "Classic", tag: "Classic" },
  daily: { name: "Daily", tag: "Today" },
  training: { name: "Practice", tag: "No lives" },
};

const PRAISE = ["Perfect", "Sharp!", "Flawless", "Locked in", "Clean", "Spot on"];

// ---------------------------------------------------------------------------
// Small shared helpers (also used by the games themselves)
// ---------------------------------------------------------------------------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function fmt(n) {
  return Math.round(n).toLocaleString("en-US");
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRng(key) {
  return mulberry32(hashString(key));
}
export function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
export function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** items: [{ value, weight }] */
export function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function defaultProgress() {
  const best = {};
  MODE_IDS.forEach((m) => (best[m] = { score: 0, level: 0 }));
  return { best, daily: null, runs: 0, units: 0, streakDays: 0, lastDay: null, history: [] };
}

/** legacy: { oldModeId: newModeId }, folds bests/history from a game's
 *  earlier mode names into the current ones (Visual Memory's first rebuild
 *  shipped "chords"/"scatter" modes, now both part of Classic). */
function sanitizeProgress(p, legacy = {}) {
  const base = defaultProgress();
  if (!p || typeof p !== "object") return base;
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  const mapMode = (m) => (MODE_IDS.includes(m) ? m : legacy[m] || null);
  if (p.best && typeof p.best === "object") {
    for (const [m, b] of Object.entries(p.best)) {
      const target = mapMode(m);
      if (!target || !b) continue;
      base.best[target] = {
        score: Math.max(base.best[target].score, num(b.score)),
        level: Math.max(base.best[target].level, num(b.level)),
      };
    }
  }
  if (p.daily && typeof p.daily.date === "string") base.daily = { date: p.daily.date, score: num(p.daily.score), level: num(p.daily.level) };
  base.runs = num(p.runs);
  base.units = num(p.units ?? p.notesRecalled);
  base.streakDays = num(p.streakDays);
  base.lastDay = typeof p.lastDay === "string" ? p.lastDay : null;
  if (Array.isArray(p.history)) {
    base.history = p.history
      .filter((h) => h && mapMode(h.m))
      .map((h) => ({ m: mapMode(h.m), s: num(h.s), l: num(h.l), t: num(h.t) }))
      .slice(-HISTORY_LEN);
  }
  return base;
}

function loadLocal(key, legacy) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeProgress(JSON.parse(raw), legacy) : null;
  } catch {
    return null;
  }
}

function saveLocal(key, p) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* private browsing / quota, in-memory progress still works */
  }
}

async function loadProgress({ key, docId, legacy }) {
  const local = loadLocal(key, legacy) || defaultProgress();
  if (!mkHooks.load) return local;
  try {
    const raw = await mkHooks.load(docId);
    if (raw) {
      const remote = sanitizeProgress(raw, legacy);
      // Whichever has seen more runs wins, covers playing signed-out for a
      // while, then signing back in on this device.
      const pickP = remote.runs >= local.runs ? remote : local;
      saveLocal(key, pickP);
      return pickP;
    }
  } catch (err) {
    console.warn(`[SmartEar] Could not load ${docId}:`, err && err.message);
  }
  return local;
}

function persistProgress(p, { key, docId }) {
  saveLocal(key, p);
  try {
    mkHooks.save && mkHooks.save(docId, p);
  } catch (err) {
    console.warn(`[SmartEar] Could not save ${docId}:`, err && err.message);
  }
}

/** stopAllSound() leaves the shared output MUTED until something calls
 *  ensureAudioReady() again (see audio.js), the right/wrong chimes don't,
 *  so un-mute right before them or they'd play into silence. */
function playFx(ok) {
  try {
    Tone.getDestination().mute = false;
    (ok ? playCorrectFx : playWrongFx)();
  } catch {
    /* audio is feedback, never a blocker */
  }
}

/** Unlock audio from inside the user's own tap/keypress (iOS only allows
 *  starting the AudioContext synchronously within a gesture), the games
 *  play their first notes later, from timers, which wouldn't count. */
function unlockAudio() {
  ensureAudioReady().catch(() => {});
}

function loadPrefs(key) {
  try {
    return JSON.parse(localStorage.getItem(key + "_prefs")) || {};
  } catch {
    return {};
  }
}
function savePrefs(key, prefs) {
  try {
    localStorage.setItem(key + "_prefs", JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------
/**
 * game: {
 *   id, title, tagline, storageKey, docId, legacyModes?,
 *   unitLabel ("Notes recalled"), accuracyLabel ("Note accuracy"),
 *   modes: { classic: { blurb }, daily: { blurb }, training: { blurb } },
 *   howTo: [[title, text] × 3], keysHint?: html string,
 *   defaultPrefs?: {}, renderSettings?(slot, prefs, setPref),
 *   createRunner(ctx) → { startRound({ retry }), onKey(e) → bool, destroy() }
 * }
 */
// `start` (the basic list's levels bar) skips the hub: a Training run (no
// lives; the level follows you) from that level, or, for a game with a cue
// setting (Sequence), with that cue from level 1. Leaving the run exits.
export function openMemoryGame(container, game, { onExit, openModule, start } = {}) {
  document.body.classList.add("mode-train");
  container.innerHTML = "";
  const root = el("div", `trainer mk mk-${game.id}`);
  container.appendChild(root);

  const store = { key: game.storageKey, docId: game.docId, legacy: game.legacyModes || {} };
  let progress = loadLocal(store.key, store.legacy) || defaultProgress();
  const prefs = { ...(game.defaultPrefs || {}), ...loadPrefs(store.key) };
  const direct = !!start;
  const numeric = /^\d+$/.test(String(start));
  const startLevel = direct && numeric ? Math.max(1, Number(start)) : 1;
  if (direct && !numeric) prefs.cue = String(start);
  let destroyed = false;
  let screen = "hub"; // hub | game | summary
  let screenKeys = null; // hub/summary key handler
  let runner = null;
  let runApi = null; // the live run's own handlers (advance, endRun, phase)
  const timers = new Set();

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers.clear();
  }

  // Mouse/touch clicks shouldn't leave a button focused, otherwise the
  // next Space/Enter shortcut would ALSO re-click that button natively.
  root.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button");
    if (b && e.detail > 0) b.blur();
  });

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // A keyboard-focused button owns Enter/Space (native activation).
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.closest && e.target.closest("button")) return;
    let handled = false;
    if (screen === "game" && runApi) handled = runApi.onKey(e);
    else if (screenKeys) handled = screenKeys(e);
    if (handled === true) e.preventDefault();
  }
  window.addEventListener("keydown", onKey);

  loadProgress(store).then((p) => {
    if (destroyed) return;
    progress = p;
    if (screen === "hub" && !direct) showHub();
  });

  function stopRunner() {
    if (runner && runner.destroy) runner.destroy();
    runner = null;
    runApi = null;
  }

  // =========================================================================
  // HUB
  // =========================================================================
  function showHub() {
    screen = "hub";
    clearTimers();
    stopRunner();
    stopAllSound();
    root.innerHTML = "";
    const hub = el("div", "mk-hub");

    const head = el("header", "mk-hub-head");
    const back = el("button", "mk-icon-btn", "←");
    back.setAttribute("aria-label", "Back to all games");
    back.title = "Back (Esc)";
    back.addEventListener("click", exit);
    head.append(back, el("h1", "mk-hub-title", game.title));
    hub.appendChild(head);

    // One calm card: what it is, your record, one big Play.
    const home = el("section", "mk-home");
    home.appendChild(el("p", "mk-home-sub", game.tagline));

    const bestScore = Math.max(...MODE_IDS.map((m) => progress.best[m].score));
    const bestLevel = Math.max(...MODE_IDS.map((m) => progress.best[m].level));
    const streakAlive = progress.lastDay === todayKey() || progress.lastDay === yesterdayKey();
    const streak = streakAlive ? progress.streakDays : 0;
    if (bestScore || bestLevel) {
      const facts = el("div", "mk-home-facts");
      const fact = (v, l) => {
        const f = el("div", "mk-fact");
        f.append(el("b", "mono", v), el("span", "", l));
        return f;
      };
      facts.append(fact(fmt(bestScore), "Best"), fact(String(bestLevel), "Top level"), fact(String(streak), streak === 1 ? "Day" : "Days"));
      home.appendChild(facts);
    }

    if (game.renderSettings) {
      const slot = el("div", "mk-settings");
      game.renderSettings(slot, prefs, (k, v) => {
        prefs[k] = v;
        savePrefs(store.key, prefs);
      });
      home.appendChild(slot);
    }

    const play = el("button", "mk-play");
    play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span>Play</span>';
    play.setAttribute("aria-label", "Play (Enter)");
    play.addEventListener("click", () => startRun("classic"));
    home.appendChild(play);

    const more = el("div", "mk-more");
    const today = todayKey();
    const dailyDone = progress.daily && progress.daily.date === today;
    const daily = el("button", "mk-more-btn" + (dailyDone ? " done" : ""));
    daily.innerHTML = `<span class="mk-more-name">Daily${dailyDone ? " (played)" : ""}</span><span class="mk-more-sub">${dailyDone ? `Today: ${fmt(progress.daily.score)}` : "Same puzzle for everyone"}</span>`;
    daily.addEventListener("click", () => startRun("daily"));
    const training = el("button", "mk-more-btn");
    training.innerHTML = `<span class="mk-more-name">Practice</span><span class="mk-more-sub">No lives, no pressure</span>`;
    training.addEventListener("click", () => startRun("training"));
    more.append(daily, training);
    home.appendChild(more);
    hub.appendChild(home);

    const how = el("details", "mk-how-box");
    how.appendChild(el("summary", "", "How to play"));
    const steps = el("ol", "mk-how");
    game.howTo.forEach(([t, d]) => {
      const li = el("li", "mk-how-step");
      li.append(el("b", "", t), document.createTextNode(" " + d));
      steps.appendChild(li);
    });
    how.appendChild(steps);
    if (game.keysHint) {
      const keys = el("div", "mk-keys-hint");
      keys.innerHTML = `${game.keysHint} · <kbd>Enter</kbd> play · <kbd>Esc</kbd> back`;
      how.appendChild(keys);
    }
    hub.appendChild(how);

    root.appendChild(hub);

    screenKeys = (e) => {
      if (e.key === "Enter" || e.key === "1") return startRun("classic"), true;
      if (e.key === "2") return startRun("daily"), true;
      if (e.key === "3") return startRun("training"), true;
      if (e.key === "Escape") return exit(), true;
      return false;
    };
  }

  // =========================================================================
  // RUN
  // =========================================================================
  function startRun(modeId, firstLevel = 1) {
    screen = "game";
    screenKeys = null;
    clearTimers();
    stopRunner();
    stopAllSound();
    unlockAudio();
    root.innerHTML = "";
    const today = todayKey();
    const counted = modeId !== "daily" || !(progress.daily && progress.daily.date === today);
    const rng = modeId === "daily" ? seededRng(`smartear-${game.id}-${today}`) : Math.random;
    const bestBefore = modeId === "daily" ? (counted ? 0 : progress.daily.score) : progress.best[modeId].score;
    const training = modeId === "training";

    const run = {
      mode: modeId,
      level: firstLevel,
      lives: training ? Infinity : LIVES,
      score: 0,
      combo: 0,
      bestCombo: 0,
      rounds: 0,
      perfectRounds: 0,
      units: 0,
      unitsTotal: 0,
      peakLevel: firstLevel,
      levelSum: 0,
      counted,
      bestBefore,
      lastSuccess: null,
    };

    // ---- DOM ----
    const game$ = el("div", "mk-run");
    const hud = el("div", "mk-hud");
    const quitBtn = el("button", "mk-icon-btn", "✕");
    quitBtn.setAttribute("aria-label", "End run");
    quitBtn.title = "End run (Esc)";
    const hudMid = el("div", "mk-hud-mid");
    const modeLabel = el("div", "mk-hud-mode", `${MODE_META[modeId].name}${modeId === "daily" && !counted ? " · practice" : ""}`);
    const levelLabel = el("div", "mk-hud-level", "Level 1");
    hudMid.append(modeLabel, levelLabel);
    const livesEl = el("div", "mk-lives");
    const hearts = [];
    if (training) {
      livesEl.appendChild(el("span", "mk-lives-inf", "∞"));
      livesEl.title = "Training, no lives";
    } else {
      for (let i = 0; i < LIVES; i++) {
        const h = el("span", "mk-heart", "♥");
        hearts.push(h);
        livesEl.appendChild(h);
      }
    }
    const scoreBox = el("div", "mk-score");
    const scoreV = el("div", "mk-score-v mono", "0");
    const scoreL = el("div", "mk-score-l", bestBefore ? `best ${fmt(bestBefore)}` : "score");
    scoreBox.append(scoreV, scoreL);
    hud.append(quitBtn, hudMid, livesEl, scoreBox);

    const card = el("div", "mk-card");
    const timer = el("div", "mk-timer");
    const timerFill = el("div", "mk-timer-fill");
    timer.appendChild(timerFill);
    const stage = el("div", "mk-stage");
    const splash = el("div", "mk-splash");
    const splashTitle = el("div", "mk-splash-title");
    const splashSub = el("div", "mk-splash-sub");
    splash.append(splashTitle, splashSub);
    card.append(timer, stage, splash);

    // Nothing overlays the stage card, in a memory game a badge sitting on
    // the staff could hide a note. Combo + placement readout live here.
    const status = el("div", "mk-status");
    const statusLeft = el("div", "mk-status-left");
    const statusText = el("div", "mk-status-text");
    const readout = el("div", "mk-readout");
    const comboBadge = el("div", "mk-combo");
    statusLeft.append(statusText, readout, comboBadge);
    const pips = el("div", "mk-pips");
    status.append(statusLeft, pips);

    const controls = el("div", "mk-controls");

    const result = el("div", "mk-result");
    const resultHead = el("div", "mk-result-head");
    const resultTitle = el("div", "mk-result-title");
    const resultPts = el("div", "mk-result-pts mono");
    resultHead.append(resultTitle, resultPts);
    const resultTip = el("div", "mk-result-tip");
    const legend = el("div", "mk-legend");
    const resultActions = el("div", "mk-result-actions");
    const extraActions = el("div", "mk-result-extra");
    const nextBtn = el("button", "mk-btn primary mk-next");
    const nextBar = el("span", "mk-next-bar");
    const nextLabel = el("span", "mk-next-label", "Next");
    nextBtn.append(nextBar, nextLabel, el("kbd", "mk-kbd-hint", "⏎"));
    resultActions.append(extraActions, nextBtn);
    result.append(resultHead, resultTip, legend, resultActions);

    game$.append(hud, card, status, controls, result);
    root.appendChild(game$);

    let phase = "ready";
    let resultKeys = [];
    let autoTimer = null;

    /** Any interaction with the reveal (Hear it, Replay…) means "I'm
     *  studying this", stop the auto-advance so it doesn't cut them off. */
    function cancelAuto() {
      if (autoTimer === null) return;
      clearTimeout(autoTimer);
      timers.delete(autoTimer);
      autoTimer = null;
      nextBtn.classList.remove("auto");
      nextBar.style.animation = "none";
    }

    function setPhase(p) {
      phase = p;
      game$.dataset.phase = p;
    }

    function comboMult() {
      return Math.min(5, 1 + Math.floor(run.combo / 2));
    }

    function updateHud() {
      levelLabel.textContent = `Level ${run.level}`;
      game$.classList.toggle("heat-1", run.combo >= 2 && run.combo < 4);
      game$.classList.toggle("heat-2", run.combo >= 4 && run.combo < 7);
      game$.classList.toggle("heat-3", run.combo >= 7);
      game$.classList.toggle("danger", !training && run.lives === 1);
      hearts.forEach((h, i) => h.classList.toggle("lost", i >= run.lives));
      scoreV.textContent = fmt(run.score);
      const mult = comboMult();
      comboBadge.textContent = `${run.combo} streak · ×${mult}`;
      comboBadge.classList.toggle("on", mult > 1);
      if (run.bestBefore && run.score > run.bestBefore) {
        scoreL.textContent = "new best!";
        scoreBox.classList.add("record");
      }
    }

    const ctx = {
      run,
      rng,
      mode: modeId,
      prefs,
      root: game$,
      card,
      stage,
      controls,
      later,
      clearTimers,
      comboMult,
      fx,
      isDestroyed: () => destroyed,
      setPhase,
      get phase() {
        return phase;
      },
      status(text) {
        statusText.textContent = text;
      },
      /** A transient pill (e.g. the note under the cursor) shown in place of
       *  the status text; null hides it. */
      readout(text) {
        if (text) readout.textContent = text;
        status.classList.toggle("reading", !!text);
      },
      /** A small tag after the mode name in the HUD (e.g. the chosen cue). */
      hudTag(text) {
        modeLabel.textContent = `${game.title} · ${MODE_META[modeId].name}${text ? ` · ${text}` : ""}`;
      },
      /** states: array of "" | "on" | "good" | "bad" | "missed" | "over" | "cur" */
      pips(states) {
        pips.innerHTML = "";
        pips.classList.toggle("dense", states.length > 12);
        states.forEach((s) => pips.appendChild(el("span", "mk-pip" + (s ? " " + s : ""))));
      },
      splash(title, sub) {
        splashTitle.textContent = title;
        splashSub.textContent = sub || "";
        splash.classList.remove("on");
        void splash.offsetWidth;
        splash.classList.add("on");
      },
      timer: {
        start(ms) {
          timerFill.classList.remove("critical");
          timerFill.style.transition = "none";
          timerFill.style.transform = "scaleX(1)";
          void timerFill.offsetWidth;
          timerFill.style.transition = `transform ${ms}ms linear`;
          timerFill.style.transform = "scaleX(0)";
          later(() => timerFill.classList.add("critical"), Math.round(ms * 0.72));
        },
        reset(full = true) {
          timerFill.classList.remove("critical");
          timerFill.style.transition = "none";
          timerFill.style.transform = full ? "scaleX(1)" : "scaleX(0)";
        },
      },
      /** A round is over. See the shell header for how lives/levels move. */
      finishRound(o) {
        setPhase("reveal");
        try {
          mkHooks.onRound && mkHooks.onRound(game.id, { success: !!o.success, level: run.level, mode: run.mode, units: o.units || null });
        } catch (e) {
          console.warn(e);
        }
        run.rounds++;
        run.levelSum += run.level;
        if (o.units) {
          run.units += o.units[0];
          run.unitsTotal += o.units[1];
        }
        let pts;
        run.lastSuccess = !!o.success;
        const scoreBefore = run.score;
        if (o.success) {
          run.combo++;
          run.bestCombo = Math.max(run.bestCombo, run.combo);
          run.perfectRounds++;
          const mult = comboMult();
          pts = Math.round((o.base || 0) * mult);
          resultTitle.textContent = o.title || (run.combo >= 3 ? PRAISE[run.combo % PRAISE.length] : "Perfect");
          resultPts.textContent = `+${fmt(pts)}${mult > 1 ? `  ×${mult}` : ""}`;
          playFx(true);
        } else {
          run.combo = 0;
          if (!training) {
            run.lives--;
            const h = hearts[run.lives];
            if (h) {
              h.classList.add("breaking");
              later(() => h.classList.remove("breaking"), 700);
            }
          }
          pts = Math.round(o.partial || 0);
          resultTitle.textContent = o.title || "Missed it";
          resultPts.textContent = pts ? `+${fmt(pts)}` : "";
          playFx(false);
        }
        run.score += pts;

        card.classList.remove("good", "bad");
        void card.offsetWidth;
        card.classList.add(o.success ? "good" : "bad");
        // Camera-friendly feedback: a stamp, a burst, a counting score.
        try {
          if (o.success) {
            const mult = comboMult();
            const milestone = MILESTONES[run.combo];
            fx.flash(card, milestone ? "gold" : "good");
            fx.burst(card, { kind: "good", count: milestone ? 34 : 22, glyphs: true });
            if (milestone) fx.banner(card, milestone, `${run.combo} in a row · ×${mult}`);
            else fx.stamp(card, resultTitle.textContent, `+${fmt(pts)}${mult > 1 ? ` ×${mult}` : ""}`, mult >= 3 ? "gold" : "good");
            fx.kick(card, "pop", 340);
          } else {
            fx.flash(card, "bad");
            fx.stamp(card, resultTitle.textContent, run.lives <= 0 && !training ? "Out of lives" : training ? "" : `${run.lives} ${run.lives === 1 ? "life" : "lives"} left`, "bad", 900);
            fx.kick(card, "shake", 450);
          }
          if (pts) fx.floatText(scoreBox, `+${fmt(pts)}`);
        } catch (e) {
          console.warn(e);
        }
        result.classList.toggle("success", !!o.success);
        resultTip.textContent = o.tip || "";
        legend.innerHTML = "";
        (o.legend || []).forEach(([cls, text]) => legend.appendChild(el("span", "lg " + cls, text)));
        legend.classList.toggle("hidden", !(o.legend && o.legend.length));
        extraActions.innerHTML = "";
        resultKeys = [];
        (o.actions || []).forEach((a) => {
          const b = el("button", "mk-btn ghost", a.label);
          const run$ = () => {
            cancelAuto();
            a.onClick();
          };
          if (a.key) {
            b.appendChild(el("kbd", "mk-kbd-hint", a.key.toUpperCase()));
            resultKeys.push([a.key.toLowerCase(), run$]);
          }
          b.addEventListener("click", run$);
          extraActions.appendChild(b);
        });
        scoreBox.classList.remove("bump");
        void scoreBox.offsetWidth;
        if (pts) scoreBox.classList.add("bump");
        updateHud();
        fx.countTo(scoreV, scoreBefore, run.score, fmt);

        nextBtn.classList.remove("auto");
        nextBar.style.animation = "none";
        if (o.success) {
          statusText.textContent = `Level ${run.level} cleared`;
          nextLabel.textContent = `Level ${run.level + 1}`;
          if (o.autoNext !== false) {
            void nextBar.offsetWidth;
            nextBar.style.animation = "";
            nextBar.style.animationDuration = `${AUTO_NEXT_MS}ms`;
            nextBtn.classList.add("auto");
            autoTimer = later(advance, AUTO_NEXT_MS);
          }
        } else if (training) {
          const next = Math.max(1, run.level - 1);
          statusText.textContent = next < run.level ? "Stepping down a level" : "Stay here and try again";
          nextLabel.textContent = next < run.level ? `Level ${next}` : "Try again";
        } else if (run.lives > 0) {
          statusText.textContent = `${run.lives} ${run.lives === 1 ? "life" : "lives"} left`;
          nextLabel.textContent = "Try again";
        } else {
          statusText.textContent = "Out of lives";
          nextLabel.textContent = "See results";
        }
        // Misses keep moving too (any action on the reveal stops the clock).
        if (!o.success && o.autoNext !== false) {
          void nextBar.offsetWidth;
          nextBar.style.animation = "";
          nextBar.style.animationDuration = `${FAIL_NEXT_MS}ms`;
          nextBtn.classList.add("auto");
          autoTimer = later(advance, FAIL_NEXT_MS);
        }
      },
      endRun: (quit) => endRun(quit),
    };

    function advance() {
      if (phase !== "reveal") return;
      autoTimer = null;
      clearTimers();
      stopAllSound();
      unlockAudio();
      card.classList.remove("good", "bad");
      status.classList.remove("reading");
      if (run.lastSuccess) run.level++;
      else if (training) run.level = Math.max(1, run.level - 1);
      run.peakLevel = Math.max(run.peakLevel, run.level);
      if (run.lives <= 0) return endRun(false);
      updateHud();
      if (run.lastSuccess) fx.kick(levelLabel, "pop", 650);
      setPhase("ready");
      runner.startRound({ retry: !run.lastSuccess });
    }

    function endRun(quit) {
      clearTimers();
      stopAllSound();
      const r = run;
      stopRunner();
      if (direct) {
        // Opened at a level: the run's rounds were already reported; just leave.
        if (r.rounds) {
          try {
            mkHooks.onRunEnd && mkHooks.onRunEnd(game.id, { score: r.score, level: r.peakLevel, rounds: r.rounds, perfect: r.perfectRounds, mode: r.mode, units: r.units, unitsTotal: r.unitsTotal, counted: false });
          } catch (e) {
            console.warn(e);
          }
        }
        return exit();
      }
      // Quitting before finishing a single round isn't a "run".
      if (quit && r.rounds === 0) return showHub();
      showSummary(r);
    }

    nextBtn.addEventListener("click", advance);
    quitBtn.addEventListener("click", () => endRun(true));

    runApi = {
      onKey(e) {
        if (e.key === "Escape") return endRun(true), true;
        if (phase === "reveal") {
          if (e.key === "Enter" || e.key === " ") return advance(), true;
          const hit = resultKeys.find(([k]) => k === e.key.toLowerCase());
          if (hit) return hit[1](), true;
          return false;
        }
        return runner && runner.onKey ? runner.onKey(e) : false;
      },
    };

    updateHud();
    setPhase("ready");
    runner = game.createRunner(ctx);
    runner.startRound({ retry: false });
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  function showSummary(run) {
    screen = "summary";
    clearTimers();
    const today = todayKey();
    const training = run.mode === "training";
    const levelStat = training ? run.peakLevel : run.level;

    let newBest = false;
    if (run.counted) {
      const b = progress.best[run.mode];
      if (run.score > b.score) {
        newBest = run.score > 0;
        b.score = run.score;
      }
      b.level = Math.max(b.level, levelStat);
      if (run.mode === "daily") progress.daily = { date: today, score: run.score, level: run.level };
    }
    progress.runs++;
    progress.units += run.units;
    if (progress.lastDay !== today) {
      progress.streakDays = progress.lastDay === yesterdayKey() ? progress.streakDays + 1 : 1;
      progress.lastDay = today;
    }
    progress.history.push({ m: run.mode, s: run.score, l: levelStat, t: Date.now() });
    progress.history = progress.history.slice(-HISTORY_LEN);
    persistProgress(progress, store);
    try {
      mkHooks.onRunEnd && mkHooks.onRunEnd(game.id, { score: run.score, level: levelStat, rounds: run.rounds, perfect: run.perfectRounds, mode: run.mode, units: run.units, unitsTotal: run.unitsTotal, counted: run.counted });
    } catch (e) {
      console.warn(e);
    }

    root.innerHTML = "";
    const wrap = el("div", "mk-summary");
    const card = el("div", "mk-sum-card" + (newBest ? " record" : ""));
    card.appendChild(el("div", "mk-eyebrow", `${game.title} · ${MODE_META[run.mode].name}${run.mode === "daily" && !run.counted ? " (practice)" : ""}`));
    if (newBest) card.appendChild(el("div", "mk-ribbon", "New personal best"));
    const scoreEl = el("div", "mk-sum-score mono", "0");
    card.append(scoreEl, el("div", "mk-sum-score-l", "points"));

    const grid = el("div", "mk-sum-grid");
    const acc = run.unitsTotal ? Math.round((run.units / run.unitsTotal) * 100) : 0;
    [
      [String(levelStat), training ? "Peak level" : "Level reached"],
      [`${acc}%`, game.accuracyLabel],
      [`${run.perfectRounds}/${run.rounds}`, "Perfect rounds"],
      training ? [(run.levelSum / Math.max(1, run.rounds)).toFixed(1), "Avg level"] : [`×${Math.min(5, 1 + Math.floor(run.bestCombo / 2))}`, "Top combo"],
    ].forEach(([v, l]) => {
      const s = el("div", "mk-sum-stat");
      s.append(el("div", "mk-sum-stat-v mono", v), el("div", "mk-sum-stat-l", l));
      grid.appendChild(s);
    });
    card.appendChild(grid);

    const recent = progress.history.filter((h) => h.m === run.mode).slice(-12);
    if (recent.length > 1) {
      const chart = el("div", "mk-spark");
      const key = training ? "l" : "s";
      const max = Math.max(...recent.map((h) => h[key]), 1);
      recent.forEach((h, i) => {
        const bar = el("div", "mk-spark-bar" + (i === recent.length - 1 ? " now" : ""));
        bar.style.height = `${Math.max(6, (h[key] / max) * 100)}%`;
        bar.style.animationDelay = `${i * 30}ms`;
        bar.title = `${fmt(h.s)} pts · level ${h.l}`;
        chart.appendChild(bar);
      });
      const chartWrap = el("div", "mk-spark-wrap");
      chartWrap.append(el("div", "mk-section-label", training ? "Peak level, last runs" : "Your last runs"), chart);
      card.appendChild(chartWrap);
    }

    let line;
    const best = progress.best[run.mode];
    if (run.mode === "daily" && run.counted) line = "Today's challenge is logged. New content tomorrow, keep the streak alive.";
    else if (newBest && run.bestBefore) line = `You beat your old best of ${fmt(run.bestBefore)}.`;
    else if (newBest) line = "First score on the board. Now beat it.";
    else if (training) line = `You worked around level ${(run.levelSum / Math.max(1, run.rounds)).toFixed(1)}. Consistency here is what moves your span.`;
    else if (best.score) line = `Best: ${fmt(best.score)} · level ${best.level}. One more?`;
    else line = "One more run?";
    card.appendChild(el("div", "mk-sum-line", line));

    const actions = el("div", "mk-sum-actions");
    const again = el("button", "mk-btn primary lg", "Play again");
    again.appendChild(el("kbd", "mk-kbd-hint", "⏎"));
    again.addEventListener("click", () => startRun(run.mode));
    const hubBtn = el("button", "mk-btn ghost", "Back");
    hubBtn.addEventListener("click", showHub);
    actions.append(hubBtn, again);
    card.appendChild(actions);
    wrap.appendChild(card);
    root.appendChild(wrap);

    const t0 = performance.now();
    const dur = Math.min(1400, 400 + run.score / 3);
    (function tick(now) {
      if (destroyed || screen !== "summary") return;
      const p = Math.min(1, (now - t0) / dur);
      scoreEl.textContent = fmt(run.score * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
    if (newBest) playFx(true);

    screenKeys = (e) => {
      if (e.key === "Enter" || e.key === " ") return startRun(run.mode), true;
      if (e.key === "Escape") return showHub(), true;
      return false;
    };
  }

  // =========================================================================
  function exit() {
    teardown();
    onExit();
  }

  function teardown() {
    if (destroyed) return;
    destroyed = true;
    clearTimers();
    stopRunner();
    stopAllSound();
    window.removeEventListener("keydown", onKey);
    document.body.classList.remove("mode-train");
  }

  if (direct) startRun("training", startLevel);
  else showHub();
  return { destroy: teardown };
}
