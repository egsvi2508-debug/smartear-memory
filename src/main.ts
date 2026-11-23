// Human Ears: a simple site of ear games. Home lists the games;
// #/<game-id> opens one straight into play; #/privacy, #/terms, #/credits.

import "@fontsource-variable/work-sans";
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/legacy.css";
import "./games/memory.css";
import "./games/fx.css";
import "./styles/simple.css";
import "./styles/site.css";

import { loadVexFlow } from "./lib/vexflow";
import { preloadPiano, stopAllSound, ensureAudio, setGameVolume } from "./lib/engine";
import "./lib/keys-dialog";
import { openKeySettings } from "./lib/keys";
import { getStats } from "./lib/stats";
import { DOCS, renderDoc, type Doc } from "./legal";
import { showBeach } from "./lib/beach";
import { unlockMusic, musicOn, musicStyle, setMusicStyle, setMusicOn, onMusicChange, musicVolume, setMusicVolume, skipTrack, nowPlaying } from "./lib/music";

type Handle = { destroy?: () => void } | void;
type Opener = (c: HTMLElement, o: { name: string; onExit: () => void; openModule: (id: string) => void; rules?: string[]; hudExtra?: HTMLElement }) => Handle;

interface Game {
  id: string;
  name: string;
  tint: string;
  icon: string;
  rules: string[];
  load: () => Promise<{ open: Opener }>;
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const GAMES: Game[] = [
  { id: "note-rush", name: "Note Rush", tint: "#ffd400", rules: ["Name the note before the bar runs out.", "The key signature counts.", "Two notes: lowest first."], icon: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'), load: () => import("./games/note-rush.js") },
  { id: "interval-rush", name: "Interval Rush", tint: "#00c2ff", rules: ["Two notes play. Name the interval.", "Number keys count half steps: 4 = M3, 7 = P5."], icon: svg('<circle cx="7" cy="17" r="3"/><circle cx="17" cy="9" r="3"/><path d="M10 17V5l10-2v6"/>'), load: () => import("./games/interval-rush.js") },
  { id: "visual-memory", name: "Visual", tint: "#5cf2a6", rules: ["Notes flash, then hide.", "Tap the staff where they were."], icon: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), load: () => import("./games/visual-memory.js") },
  { id: "sequence-memory", name: "Sequence", tint: "#ff6b9a", rules: ["A melody plays. Play it back in order.", "Each level adds one note."], icon: svg('<path d="M4 18V14M10 18V10M16 18V6M22 18V3"/>'), load: () => import("./games/sequence-memory.js") },
  { id: "pairs-memory", name: "Pairs", tint: "#b49bff", rules: ["Tap a card to hear it.", "Find the two cards with the same sound."], icon: svg('<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>'), load: () => import("./games/pairs-memory.js") },
  { id: "hold-memory", name: "Pitch Hold", tint: "#ffa23a", rules: ["Remember the first note.", "Ignore the notes after it, then find yours."], icon: svg('<path d="M12 3v10"/><circle cx="12" cy="17" r="4"/>'), load: () => import("./games/hold-memory.js") },
  { id: "memory", name: "Compare", tint: "#4de2e8", rules: ["A melody plays twice.", "Same? Or tap the note that changed."], icon: svg('<path d="M3 9h18M3 15h18"/><circle cx="15" cy="9" r="2" fill="currentColor"/>'), load: () => import("./games/memory.js") },
  { id: "relative-memory", name: "Relative", tint: "#c6f24d", rules: ["A melody plays, then again in a new key.", "Same tune? Or tap the note that changed."], icon: svg('<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>'), load: () => import("./games/memory.js").then((m) => ({ open: m.openRelative as Opener })) },
];

const app = document.getElementById("app")!;
let handle: Handle;
let token = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function closeGame() {
  try {
    handle && handle.destroy && handle.destroy();
  } catch {
    /* already gone */
  }
  handle = undefined;
  stopAllSound();
  document.body.classList.remove("mode-train");
}

function showHome() {
  token++;
  closeGame();
  app.innerHTML = "";
  document.title = "Human Ears";
  const main = el("main", "home");
  const logo = el("h1", "logo");
  logo.innerHTML = `<span class="logo-mark">${svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')}</span><span>Human Ears</span>`;
  const grid = el("div", "tiles");
  GAMES.forEach((g, i) => {
    const a = el("a", "tile");
    a.href = `#/${g.id}`;
    a.style.setProperty("--tint", g.tint);
    a.style.setProperty("--i", String(i));
    const icon = el("span", "tile-icon");
    icon.innerHTML = g.icon;
    a.append(icon, el("span", "tile-name", g.name));
    const s = getStats(g.id);
    if (s.bestLevel || s.bestStreak) a.append(el("span", "tile-best mono", s.bestLevel ? `Lv ${s.bestLevel}` : `×${s.bestStreak}`));
    a.addEventListener("click", () => void ensureAudio().catch(() => {}));
    grid.append(a);
  });
  const head = el("div", "home-head");
  head.append(logo, musicBtn);
  const foot = el("footer", "home-foot");
  for (const [id, label] of Object.entries(DOCS)) foot.append(Object.assign(el("a", "", label), { href: `#/${id}` }));
  foot.append(Object.assign(el("a", "", "Feedback"), { href: "https://github.com/egsvi2508-debug/smartear-memory/issues", target: "_blank", rel: "noopener" }));
  main.append(head, el("p", "home-tag", "Train your ears. Pick a game and play."), grid, foot);
  app.append(main);
  window.scrollTo(0, 0);
}

async function showGame(game: Game) {
  const my = ++token;
  closeGame();
  app.innerHTML = "";
  const host = el("div", "legacy-root mk-root play");
  host.style.setProperty("--tint", game.tint);
  app.append(host);
  showBeach(app);
  window.scrollTo(0, 0);
  document.title = `${game.name} · Human Ears`;
  const [, mod] = await Promise.all([loadVexFlow().catch(() => null), game.load()]);
  if (my !== token) return;
  handle = mod.open(host, {
    name: game.name,
    rules: game.rules,
    hudExtra: musicBtn,
    onExit: () => (location.hash = "#/"),
    openModule: (id: string) => (location.hash = `#/${id}`),
  });
}

const GAME_VOL = "smem:gameVol";
function readGameVol(): number {
  try {
    const v = Number(localStorage.getItem(GAME_VOL) ?? "1");
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch {
    return 1;
  }
}
setGameVolume(readGameVol());

const NOTE_ICON = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';

/** The sound button (top bar) and its panel: music on/off + volumes. */
function musicButton() {
  const b = el("button", "music-btn");
  b.type = "button";
  b.setAttribute("aria-label", "Settings");
  b.setAttribute("aria-haspopup", "dialog");

  const pop = el("div", "snd-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Settings");
  const slider = (label: string, value: number, on: (v: number) => void) => {
    const row = el("label", "snd-row");
    const name = el("span", "snd-name", label);
    const pct = el("span", "snd-pct mono", `${Math.round(value * 100)}%`);
    const r = el("input", "snd-range");
    r.type = "range";
    r.min = "0";
    r.max = "100";
    r.value = String(Math.round(value * 100));
    const paint = () => r.style.setProperty("--p", `${r.value}%`);
    paint();
    r.addEventListener("input", () => {
      pct.textContent = `${r.value}%`;
      paint();
      on(Number(r.value) / 100);
    });
    row.append(name, pct, r);
    return row;
  };
  const top = el("div", "snd-top");
  const toggle = el("button", "snd-toggle");
  toggle.type = "button";
  const skip = el("button", "snd-skip", "Next rhythm");
  skip.type = "button";
  toggle.setAttribute("aria-label", "Music");
  const musicName = el("span", "snd-title", "Music");
  musicName.addEventListener("click", () => toggle.click()); // the name works as a switch too
  top.append(musicName, toggle);
  // Background: beach waves, a basic rhythm, or both. Picking one also turns it on.
  const styleRow = el("div", "snd-style");
  styleRow.setAttribute("role", "radiogroup");
  styleRow.setAttribute("aria-label", "Music style");
  const styleBtns = (["beach", "rhythm", "both"] as const).map((id) => {
    const sb = el("button", "snd-style-btn", id === "beach" ? "Beach" : id === "rhythm" ? "Rhythm" : "Both");
    sb.type = "button";
    sb.setAttribute("role", "radio");
    sb.addEventListener("click", () => {
      setMusicStyle(id);
      if (!musicOn()) setMusicOn(true);
    });
    styleRow.append(sb);
    return [id, sb] as const;
  });
  const now = el("div", "snd-now");
  const keysBtn = el("button", "snd-skip snd-keys", "Keyboard keys");
  keysBtn.type = "button";
  keysBtn.addEventListener("click", () => {
    pop.classList.remove("open");
    openKeySettings();
  });
  // Clean screen: hides the stats and rules under the game, for recording.
  const CLEAN = "hears:clean";
  const cleanRow = el("div", "snd-top snd-clean");
  const cleanBtn = el("button", "snd-toggle");
  cleanBtn.type = "button";
  cleanBtn.setAttribute("aria-label", "Clean screen");
  const cleanName = el("span", "snd-name", "Clean screen (for recording)");
  cleanName.addEventListener("click", () => cleanBtn.click());
  cleanRow.append(cleanName, cleanBtn);
  const drawClean = () => {
    const on = document.body.classList.contains("clean");
    cleanBtn.textContent = on ? "On" : "Off";
    cleanBtn.classList.toggle("on", on);
    cleanBtn.setAttribute("aria-pressed", String(on));
  };
  try {
    document.body.classList.toggle("clean", localStorage.getItem(CLEAN) === "on");
  } catch {
    /* ignore */
  }
  cleanBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("clean");
    try {
      localStorage.setItem(CLEAN, on ? "on" : "off");
    } catch {
      /* ignore */
    }
    drawClean();
  });
  drawClean();
  pop.append(
    top,
    styleRow,
    slider("Music volume", musicVolume(), setMusicVolume),
    slider("Game sounds", readGameVol(), (v) => {
      setGameVolume(v);
      try {
        localStorage.setItem(GAME_VOL, String(v));
      } catch {
        /* ignore */
      }
    }),
    now,
    skip,
    keysBtn,
    cleanRow,
  );
  document.body.append(pop);

  const draw = () => {
    const on = musicOn();
    b.classList.toggle("off", !on);
    b.innerHTML = svg(on ? NOTE_ICON : NOTE_ICON + '<path d="M3 3l18 18"/>');
    toggle.textContent = on ? "On" : "Off";
    toggle.classList.toggle("on", on);
    toggle.setAttribute("aria-pressed", String(on));
    now.textContent = on ? `♪ ${nowPlaying()}` : "";
    for (const [id, sb] of styleBtns) {
      sb.classList.toggle("on", id === musicStyle());
      sb.setAttribute("aria-checked", String(id === musicStyle()));
    }
  };
  draw();
  onMusicChange(draw);
  toggle.addEventListener("click", () => setMusicOn(!musicOn()));
  skip.addEventListener("click", () => skipTrack());

  const place = () => {
    const r = b.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  };
  const close = () => pop.classList.remove("open");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.classList.toggle("open")) place();
  });
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  pop.addEventListener("keydown", (e) => e.stopPropagation());
  // Escape closes the panel (and only the panel: a game would take it as "leave").
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !pop.classList.contains("open")) return;
      e.stopPropagation();
      e.preventDefault();
      close();
    },
    { capture: true },
  );
  document.addEventListener("pointerdown", close);
  window.addEventListener("hashchange", close);
  window.addEventListener("resize", close);
  return b;
}
const musicBtn = musicButton();
// Browsers only allow sound after a tap or key press: start the music on the first one.
for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => unlockMusic(), { capture: true });

function showDoc(kind: Doc) {
  token++;
  closeGame();
  app.innerHTML = "";
  document.title = `${DOCS[kind]} · Human Ears`;
  renderDoc(app, kind);
  window.scrollTo(0, 0);
}

function route() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  const game = GAMES.find((g) => g.id === id);
  if (game) showGame(game);
  else if (id in DOCS) showDoc(id as Doc);
  else showHome();
}

window.addEventListener("hashchange", route);
preloadPiano();
route();
