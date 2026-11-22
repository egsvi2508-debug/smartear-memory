// Musical Memory: a simple site of ear games. Home lists the games;
// #/<game-id> opens one straight into play.

import "@fontsource-variable/fraunces/soft.css";
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
import { preloadPiano, stopAllSound, ensureAudio, playListeners } from "./lib/engine";
import { unlockMusic, setMusicMode, duckMusic, musicOn, setMusicOn, onMusicChange } from "./lib/music";

type Handle = { destroy?: () => void } | void;
type Opener = (c: HTMLElement, o: { onExit: () => void; openModule: (id: string) => void; rules?: string[]; hudExtra?: HTMLElement }) => Handle;

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
  { id: "note-rush", name: "Note Rush", tint: "#ffd400", rules: ["Name the note before the bar runs out.", "The key signature counts. Shift = sharp.", "Two notes: lowest first."], icon: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'), load: () => import("./games/note-rush.js") },
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
  document.title = "Musical Memory";
  const main = el("main", "home");
  const logo = el("h1", "logo");
  logo.innerHTML = `<span class="logo-mark">${svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')}</span><span>Musical Memory</span>`;
  const grid = el("div", "tiles");
  GAMES.forEach((g, i) => {
    const a = el("a", "tile");
    a.href = `#/${g.id}`;
    a.style.setProperty("--tint", g.tint);
    a.style.setProperty("--i", String(i));
    const icon = el("span", "tile-icon");
    icon.innerHTML = g.icon;
    a.append(icon, el("span", "tile-name", g.name));
    a.addEventListener("click", () => void ensureAudio().catch(() => {}));
    grid.append(a);
  });
  const head = el("div", "home-head");
  head.append(logo, musicBtn);
  main.append(head, grid);
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
  window.scrollTo(0, 0);
  document.title = `${game.name} · Musical Memory`;
  const [, mod] = await Promise.all([loadVexFlow().catch(() => null), game.load()]);
  if (my !== token) return;
  handle = mod.open(host, {
    rules: game.rules,
    hudExtra: musicBtn,
    onExit: () => (location.hash = "#/"),
    openModule: (id: string) => (location.hash = `#/${id}`),
  });
}

// Background music: full track where you read, drums only where you listen.
const READING = new Set(["note-rush", "visual-memory"]);
function musicButton() {
  const b = el("button", "music-btn");
  b.type = "button";
  const draw = (on: boolean) => {
    b.classList.toggle("off", !on);
    b.setAttribute("aria-label", on ? "Music on (tap to turn off)" : "Music off (tap to turn on)");
    b.innerHTML = svg(on ? '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' : '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M3 3l18 18"/>');
  };
  draw(musicOn());
  onMusicChange(draw);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    setMusicOn(!musicOn());
  });
  return b;
}
const musicBtn = musicButton();
playListeners.add(duckMusic);
// Browsers only allow sound after a tap or key press: start the music on the first one.
for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => unlockMusic(), { capture: true });

function route() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  const game = GAMES.find((g) => g.id === id);
  setMusicMode(!game || READING.has(game.id) ? "full" : "beat");
  if (game) showGame(game);
  else showHome();
}

window.addEventListener("hashchange", route);
preloadPiano();
route();
