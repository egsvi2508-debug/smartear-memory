// memory-kit.js, the shared game shell. A game plugs in as a spec object
// (see openMemoryGame) whose createRunner(ctx) builds the round inside the
// stage/controls the shell provides and reports each round through
// ctx.finishRound().

import { ensureAudioReady, stopAllSound, playCorrectFx, playWrongFx, Tone } from "./audio.js";
import * as fx from "./fx.js";

/** Kept for older callers; nothing sets these any more. */
export const mkHooks = { load: null, save: null, onRound: null, onRunEnd: null };

export const LIVES = Infinity;
const AUTO_NEXT_MS = 850; // after a clean round
const FAIL_NEXT_MS = 2400; // after a miss: long enough to read the answer

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
// The shell: opens straight into play. No lives, no score, no modes.
// A clean round moves up a level; a miss shows the answer and tries the
// same level again. The level is kept per game, and ‹ › in the top bar
// changes it.
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

  function startRun(firstLevel) {
    clearTimers();
    stopRunner();
    stopAllSound();
    unlockAudio();
    root.innerHTML = "";

    const run = { level: firstLevel, lives: Infinity, combo: 0, rounds: 0, lastSuccess: null };

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
    let gear = null;
    let settings = null;
    if (game.renderSettings) {
      gear = el("button", "mk-icon-btn mk-gear");
      gear.setAttribute("aria-label", "Settings");
      gear.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
      hud.appendChild(gear);
      settings = el("div", "mk-settings mk-drawer");
      game.renderSettings(settings, prefs, (k, v) => {
        prefs[k] = v;
        savePrefs(game.storageKey, prefs);
        later(() => startRun(run.level), 120);
      });
      gear.addEventListener("click", () => settings.classList.toggle("open"));
    }
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
    statusLeft.append(statusText, readout);
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
    result.append(resultTip, legend, resultActions);

    game$.append(hud);
    if (settings) game$.append(settings);
    game$.append(card, status, controls, result);
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
      /** A round is over: a clean one moves up, a miss tries again. */
      finishRound(o) {
        setPhase("reveal");
        run.rounds++;
        run.lastSuccess = !!o.success;
        playFx(!!o.success);
        card.classList.remove("good", "bad");
        void card.offsetWidth;
        card.classList.add(o.success ? "good" : "bad");
        try {
          if (o.success) {
            fx.flash(card, "good");
            fx.burst(card, { kind: "good", count: 22, glyphs: true });
            fx.stamp(card, "Nice", "", "good");
            fx.kick(card, "pop", 340);
          } else {
            fx.flash(card, "bad");
            fx.stamp(card, "Missed", "", "bad", 800);
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
        resultKeys = [];
        (o.actions || []).forEach((a) => {
          const b = el("button", "mk-btn ghost", a.label);
          const run$ = () => {
            cancelAuto();
            a.onClick();
          };
          if (a.key) resultKeys.push([a.key.toLowerCase(), run$]);
          b.addEventListener("click", run$);
          extraActions.appendChild(b);
        });
        statusText.textContent = "";
        nextLabel.textContent = o.success ? "Next" : "Try again";
        nextBtn.classList.remove("auto");
        nextBar.style.animation = "none";
        if (o.autoNext !== false) {
          const ms = o.success ? AUTO_NEXT_MS : FAIL_NEXT_MS;
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
      if (run.lastSuccess) {
        run.level++;
        saveLevel(run.level);
      }
      updateHud();
      if (run.lastSuccess) fx.kick(levelLabel, "pop", 650);
      setPhase("ready");
      runner.startRound({ retry: !run.lastSuccess });
    }

    nextBtn.addEventListener("click", advance);
    backBtn.addEventListener("click", exit);
    const jump = (d) => {
      const l = Math.max(1, run.level + d);
      if (l === run.level) return;
      saveLevel(l);
      startRun(l);
    };
    down.addEventListener("click", () => jump(-1));
    up.addEventListener("click", () => jump(1));

    runApi = {
      onKey(e) {
        if (e.key === "Escape") return exit(), true;
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

  startRun(savedLevel());
  return { destroy: teardown };
}
