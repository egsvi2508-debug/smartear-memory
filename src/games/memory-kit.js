// memory-kit.js, the shared game shell. A game plugs in as a spec object
// (see openMemoryGame) whose createRunner(ctx) builds the round inside the
// stage/controls the shell provides and reports each round through
// ctx.finishRound().

import { statsStrip, noteRound, bestLine, pushBest } from "../lib/strip";
import { ensureAudioReady, stopAllSound, playCorrectFx, playWrongFx, Tone } from "./audio.js";
import * as fx from "./fx.js";

/** Kept for older callers; nothing sets these any more. */
export const mkHooks = { load: null, save: null, onRound: null, onRunEnd: null };

export const LIVES = Infinity;
const AUTO_NEXT_MS = 850; // after a clean round
const LEVEL_MISS_MS = 500; // Levels: after a miss, before the next go

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
// The shell: opens straight into play. A round runs until a miss.
// A clean level moves up; a miss shows the answer and ends the round, and
// the next round can start from any level (‹ › in the top bar too). The
// start level is kept per game.
// ---------------------------------------------------------------------------
/**
 * game: {
 *   id, title, storageKey,
 *   defaultPrefs?: {}, renderSettings?(slot, prefs, setPref),
 *   createRunner(ctx) → { startRound({ retry }), onKey(e) → bool, destroy() }
 * }
 */
export function openMemoryGame(container, game, { onExit, rules, hudExtra } = {}) {
  document.body.classList.add("mode-train");
  container.innerHTML = "";
  const root = el("div", `trainer mk mk-${game.id}`);
  container.appendChild(root);

  const prefs = { ...(game.defaultPrefs || {}), ...loadPrefs(game.storageKey) };
  let destroyed = false;
  let runner = null;
  let runApi = null;
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
    unlockAudio();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.closest && e.target.closest("button")) return;
    const handled = runApi ? runApi.onKey(e) : false;
    if (handled === true) e.preventDefault();
  }
  window.addEventListener("keydown", onKey);
  root.addEventListener("pointerdown", unlockAudio);

  function stopRunner() {
    if (runner && runner.destroy) runner.destroy();
    runner = null;
    runApi = null;
  }

  function savedLevel() {
    try {
      return Math.max(1, Math.min(99, Number(localStorage.getItem(game.storageKey + "_level")) || 1));
    } catch {
      return 1;
    }
  }
  function saveLevel(l) {
    try {
      localStorage.setItem(game.storageKey + "_level", String(l));
    } catch {
      /* ignore */
    }
  }

  // "levels": climb a level per clean round. "streak": stay on one level and
  // count right answers in a row. Either way, one miss ends the round.
  const MODES = { levels: "Levels", streak: "Streak" };
  let playMode = "levels";
  try {
    if (localStorage.getItem(game.storageKey + "_mode") === "streak") playMode = "streak";
  } catch {
    /* ignore */
  }
  function setPlayMode(m) {
    playMode = m;
    try {
      localStorage.setItem(game.storageKey + "_mode", m);
    } catch {
      /* ignore */
    }
  }
  /** A row of choice buttons (the games' settings use the same look). */
  function choice(title, options, current, onPick) {
    const wrap = el("div", "mk-choice");
    if (title) wrap.appendChild(el("div", "mk-section-label", title));
    const seg = el("div", "mk-seg");
    seg.setAttribute("role", "radiogroup");
    Object.entries(options).forEach(([id, label]) => {
      const b = el("button", "mk-seg-btn" + (id === current ? " active" : ""));
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(id === current));
      b.append(el("span", "mk-seg-label", label));
      b.addEventListener("click", () => {
        seg.querySelectorAll(".mk-seg-btn").forEach((x) => {
          x.classList.toggle("active", x === b);
          x.setAttribute("aria-checked", String(x === b));
        });
        onPick(id);
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }

  /** intro: show the start pop-up (mode, level, options, Play) instead of starting. */
  function startRun(firstLevel, intro = false) {
    clearTimers();
    stopRunner();
    stopAllSound();
    unlockAudio();
    root.innerHTML = "";

    const run = { level: firstLevel, startLevel: firstLevel, lives: Infinity, combo: 0, rounds: 0, lastSuccess: null, streak: 0, hitsThisRound: 0 };
    const streakMode = playMode === "streak";

    // ---- DOM ----
    const game$ = el("div", "mk-run");
    const hud = el("div", "mk-hud");
    const backBtn = el("button", "mk-icon-btn", "←");
    backBtn.setAttribute("aria-label", "Back to the games");
    const hudMid = el("div", "mk-hud-mid");
    const title = el("div", "mk-hud-title", game.title);
    hudMid.append(title);
    const lvl = el("div", "mk-lvl");
    const down = el("button", "mk-lvl-btn", "‹");
    down.setAttribute("aria-label", "Level down");
    const levelLabel = el("div", "mk-hud-level mono", "1");
    const up = el("button", "mk-lvl-btn", "›");
    up.setAttribute("aria-label", "Level up");
    lvl.append(down, levelLabel, up);
    hud.append(backBtn, hudMid, lvl);
    const gear = el("button", "mk-icon-btn mk-gear");
    gear.setAttribute("aria-label", "Settings");
    gear.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
    hud.appendChild(gear);
    gear.addEventListener("click", () => startRun(run.startLevel, true));
    if (hudExtra) hud.appendChild(hudExtra);

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

    const status = el("div", "mk-status");
    const statusLeft = el("div", "mk-status-left");
    const statusText = el("div", "mk-status-text");
    const readout = el("div", "mk-readout");
    const streakBadge = el("div", "mk-streak mono");
    statusLeft.append(streakBadge, statusText, readout);
    const pips = el("div", "mk-pips");
    status.append(statusLeft, pips);

    const controls = el("div", "mk-controls");

    const result = el("div", "mk-result");
    const resultTip = el("div", "mk-result-tip");
    const legend = el("div", "mk-legend");
    const resultActions = el("div", "mk-result-actions");
    const extraActions = el("div", "mk-result-extra");
    const nextBtn = el("button", "mk-btn primary mk-next");
    const nextBar = el("span", "mk-next-bar");
    const nextLabel = el("span", "mk-next-label", "Next");
    nextBtn.append(nextBar, nextLabel);
    resultActions.append(extraActions, nextBtn);
    // Round over: where you got to, and pick any level to start the next round.
    const over = el("div", "mk-over");
    const overTitle = el("div", "mk-over-title", "Round over");
    const overSub = el("div", "mk-over-sub");
    let overMode = playMode;
    const overChoice = choice("Mode", MODES, playMode, (m) => {
      overMode = m;
      pickLabel.textContent = m === "streak" ? "Level" : "Start from level";
    });
    const pickRow = el("div", "mk-over-pick");
    const pDown = el("button", "mk-lvl-btn", "‹");
    pDown.setAttribute("aria-label", "Lower start level");
    const pVal = el("input", "mk-over-lv mono");
    pVal.type = "number";
    pVal.min = "1";
    pVal.max = "99";
    pVal.inputMode = "numeric";
    pVal.setAttribute("aria-label", "Start level");
    const pUp = el("button", "mk-lvl-btn", "›");
    pUp.setAttribute("aria-label", "Higher start level");
    const pickLabel = el("span", "mk-over-label", streakMode ? "Level" : "Start from level");
    pickRow.append(pickLabel, pDown, pVal, pUp);
    const playBtn = el("button", "mk-btn primary mk-over-play", "Play");
    // The game's own options (speed, what to show…), saved as you pick.
    const opts = el("div", "mk-settings mk-over-opts");
    if (game.renderSettings) {
      game.renderSettings(opts, prefs, (k, v) => {
        prefs[k] = v;
        savePrefs(game.storageKey, prefs);
      });
    }
    over.append(overTitle, overSub, overChoice, pickRow, opts, playBtn);
    const pickLevel = () => Math.max(1, Math.min(99, Math.round(Number(pVal.value) || 1)));
    pDown.addEventListener("click", () => (pVal.value = String(Math.max(1, pickLevel() - 1))));
    pUp.addEventListener("click", () => (pVal.value = String(Math.min(99, pickLevel() + 1))));
    const playAgain = () => {
      const l = pickLevel();
      saveLevel(l);
      setPlayMode(overMode);
      startRun(l);
    };
    playBtn.addEventListener("click", playAgain);
    pVal.addEventListener("keydown", (e) => {
      if (e.key === "Enter") playAgain();
    });
    result.append(resultTip, legend, over, resultActions);
    // The pop-up can be closed to look at the game, and opened again from a small button.
    const overX = el("button", "mk-over-x", "×");
    overX.type = "button";
    overX.setAttribute("aria-label", "Close");
    result.prepend(overX);
    // Shown on the play page once the pop-up is closed: extras (Hear it…) + Play again.
    const tuckBar = el("div", "mk-tuck");
    const tuckExtra = el("div", "mk-tuck-extra");
    const reopen = el("button", "mk-btn primary mk-over-reopen", "Play again");
    reopen.type = "button";
    tuckBar.append(tuckExtra, reopen);
    const popOpen = () => result.classList.contains("over") && !result.classList.contains("tucked");
    const tuck = (on) => {
      result.classList.toggle("tucked", on);
      tuckBar.classList.toggle("show", on);
    };
    overX.addEventListener("click", () => tuck(true));
    reopen.addEventListener("click", () => tuck(false));

    game$.append(hud, card, status, controls, result, tuckBar, statsStrip(game.id));
    if (rules && rules.length) {
      const box = el("section", "mk-rules");
      box.appendChild(el("div", "mk-rules-h", "Rules"));
      const ul = el("ul");
      rules.forEach((r) => ul.appendChild(el("li", "", r)));
      box.appendChild(ul);
      game$.append(box);
    }
    root.appendChild(game$);

    let phase = "ready";
    let resultKeys = [];
    let autoTimer = null;

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

    function updateHud() {
      levelLabel.textContent = `Lv ${run.level}`;
      down.disabled = run.level <= 1;
      streakBadge.textContent = `Streak ${run.streak}`;
      streakBadge.classList.toggle("on", streakMode);
    }
    function bumpStreak() {
      run.streak++;
      updateHud();
      if (streakMode) fx.kick(streakBadge, "pop", 400);
    }

    const ctx = {
      run,
      rng: Math.random,
      mode: "training",
      prefs,
      root: game$,
      card,
      stage,
      controls,
      later,
      clearTimers,
      comboMult: () => 1,
      fx,
      isDestroyed: () => destroyed,
      setPhase,
      get phase() {
        return phase;
      },
      status(text) {
        statusText.textContent = text;
      },
      readout(text) {
        if (text) readout.textContent = text;
        status.classList.toggle("reading", !!text);
      },
      hudTag() {},
      /** Streak mode: one miss ends the round. Levels: misses never stop you. */
      get streakMode() {
        return streakMode;
      },
      /** A wrong answer inside a round (Levels mode): the streak starts over. */
      miss() {
        run.streak = 0;
        updateHud();
      },
      /** One right answer inside a round (a card, a note): counts toward the streak. */
      hit() {
        run.hitsThisRound++;
        bumpStreak();
      },
      /** states: array of "" | "on" | "good" | "bad" | "missed" | "over" | "cur" */
      pips(states) {
        pips.innerHTML = "";
        pips.classList.toggle("dense", states.length > 12);
        states.forEach((s) => pips.appendChild(el("span", "mk-pip" + (s ? " " + s : ""))));
      },
      splash(t, sub) {
        splashTitle.textContent = t;
        splashSub.textContent = "";
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
      /** A level is done: a clean one moves up, a miss ends the round. */
      finishRound(o) {
        setPhase("reveal");
        run.rounds++;
        run.lastSuccess = !!o.success;
        if (o.success && !run.hitsThisRound) bumpStreak();
        const cardGame = run.hitsThisRound > 0; // counts its own hits and misses per card
        run.hitsThisRound = 0;
        noteRound(game.id, { cleared: o.success && !streakMode ? run.level : 0, streak: run.streak, round: true });
        playFx(!!o.success);
        if (!o.success && !streakMode) {
          // Levels: a miss never stops you. Flash, then a new go at this level.
          if (!cardGame) run.streak = 0;
          updateHud();
          card.classList.remove("good", "bad");
          void card.offsetWidth;
          card.classList.add("bad");
          try {
            fx.flash(card, "bad");
            fx.kick(card, "shake", 350);
          } catch (e) {
            console.warn(e);
          }
          result.classList.remove("over", "intro");
          statusText.textContent = "";
          autoTimer = later(advance, LEVEL_MISS_MS);
          return;
        }
        card.classList.remove("good", "bad");
        void card.offsetWidth;
        card.classList.add(o.success ? "good" : "bad");
        try {
          if (o.success) {
            fx.flash(card, "good");
            fx.burst(card, { kind: "good", count: 22, glyphs: true });
            fx.stamp(card, streakMode ? `Streak ${run.streak}` : "Nice", "", "good");
            fx.kick(card, "pop", 340);
          } else {
            fx.flash(card, "bad");
            fx.stamp(card, "Round over", streakMode ? `Streak ${run.streak}` : `Lv ${run.level}`, "bad", 1000);
            fx.kick(card, "shake", 450);
          }
        } catch (e) {
          console.warn(e);
        }
        result.classList.toggle("success", !!o.success);
        resultTip.textContent = o.success ? "" : o.tip || "";
        legend.innerHTML = "";
        (o.legend || []).forEach(([cls, text]) => legend.appendChild(el("span", "lg " + cls, text)));
        legend.classList.toggle("hidden", !(o.legend && o.legend.length));
        extraActions.innerHTML = "";
        tuckExtra.innerHTML = "";
        resultKeys = [];
        (o.actions || []).forEach((a) => {
          const b = el("button", "mk-btn ghost", a.label);
          const run$ = () => {
            cancelAuto();
            a.onClick();
          };
          if (a.key) resultKeys.push([a.key.toLowerCase(), run$]);
          b.addEventListener("click", run$);
          // Round over: extras live on the play page, once the pop-up is closed.
          (o.success ? extraActions : tuckExtra).appendChild(b);
        });
        statusText.textContent = "";
        nextLabel.textContent = "Next";
        nextBtn.classList.remove("auto");
        nextBar.style.animation = "none";
        result.classList.toggle("over", !o.success);
        tuck(false);
        reopen.textContent = "Play again";
        if (!o.success) {
          overSub.textContent = streakMode
            ? `Streak ${run.streak} at level ${run.level}`
            : run.level > run.startLevel
              ? `You reached level ${run.level} (started at ${run.startLevel})`
              : `You reached level ${run.level}`;
          pVal.value = String(run.startLevel);
        }
        if (o.success && o.autoNext !== false) {
          const ms = AUTO_NEXT_MS;
          void nextBar.offsetWidth;
          nextBar.style.animation = "";
          nextBar.style.animationDuration = `${ms}ms`;
          nextBtn.classList.add("auto");
          autoTimer = later(advance, ms);
        }
      },
      endRun: () => exit(),
    };

    function advance() {
      if (phase !== "reveal") return;
      autoTimer = null;
      clearTimers();
      stopAllSound();
      unlockAudio();
      card.classList.remove("good", "bad");
      status.classList.remove("reading");
      if (!run.lastSuccess && streakMode) return playAgain();
      const up = !streakMode && run.lastSuccess;
      if (up) run.level++;
      updateHud();
      if (up) fx.kick(levelLabel, "pop", 650);
      setPhase("ready");
      runner.startRound({ retry: false });
    }

    nextBtn.addEventListener("click", advance);
    backBtn.addEventListener("click", exit);
    const jump = (d) => {
      const l = Math.max(1, Math.min(99, run.level + d));
      if (l === run.level) return;
      saveLevel(l);
      startRun(l);
    };
    down.addEventListener("click", () => jump(-1));
    up.addEventListener("click", () => jump(1));

    runApi = {
      onKey(e) {
        if (e.key === "Escape") {
          if (popOpen()) return tuck(true), true;
          return exit(), true;
        }
        if (phase === "intro") {
          if (e.key === "Enter" || e.key === " ") return playAgain(), true;
          return false;
        }
        if (phase === "reveal") {
          if (e.key === "Enter" || e.key === " ") return (run.lastSuccess ? advance() : playAgain()), true;
          const hit = !popOpen() || run.lastSuccess ? resultKeys.find(([k]) => k === e.key.toLowerCase()) : null;
          if (hit) return hit[1](), true;
          return false;
        }
        return runner && runner.onKey ? runner.onKey(e) : false;
      },
    };

    updateHud();
    setPhase("ready");
    runner = game.createRunner(ctx);
    if (intro) {
      overTitle.textContent = game.title;
      overSub.textContent = bestLine(game.id);
      pVal.value = String(run.startLevel);
      result.classList.add("over", "intro");
      reopen.textContent = "Play";
      setPhase("intro");
      return;
    }
    runner.startRound({ retry: false });
  }

  function exit() {
    teardown();
    onExit && onExit();
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

  startRun(savedLevel(), true);
  pushBest(game.id, 2500); // make sure the board has your bests
  return { destroy: teardown };
}
