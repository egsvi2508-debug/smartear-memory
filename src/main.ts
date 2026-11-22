// SmartEar Memory — the six memory games from SmartEar as their own app.
// Home lists the games; #/<game-id> opens one. Progress is kept in this
// browser (localStorage) by the games' shared shell, memory-kit.js.

import "@fontsource-variable/fraunces/soft.css";
import "@fontsource-variable/work-sans";
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/legacy.css";
import "./games/memory.css";
import "./styles/home.css";

import { loadVexFlow } from "./lib/vexflow";
import { preloadPiano, stopAllSound } from "./lib/engine";
import { getNoteSystem, setNoteSystem } from "./lib/prefs";
import type { NoteSystem } from "./lib/theory";

type Handle = { destroy?: () => void } | void;
type Opener = (c: HTMLElement, o: { onExit: () => void; openModule: (id: string) => void; start?: string }) => Handle;

interface Game {
  id: string;
  name: string;
  type: string;
  blurb: string;
  load: () => Promise<{ open: Opener }>;
}

const GAMES: Game[] = [
  { id: "visual-memory", name: "Visual Memory", type: "See", blurb: "Notes flash on a staff and vanish: rebuild them, every note back in place.", load: () => import("./games/visual-memory.js") },
  { id: "sequence-memory", name: "Sequence Memory", type: "Order", blurb: "A melody grows one note a round: play it back on the piano.", load: () => import("./games/sequence-memory.js") },
  { id: "pairs-memory", name: "Sound Pairs", type: "Match", blurb: "Cards hide sounds, each on two cards: find the pairs.", load: () => import("./games/pairs-memory.js") },
  { id: "hold-memory", name: "Pitch Hold", type: "Hold", blurb: "Keep one tone in mind through a stream of other notes, then find it again.", load: () => import("./games/hold-memory.js") },
  { id: "memory", name: "Comparison", type: "Spot", blurb: "A melody plays twice in the same key: same, or which note changed?", load: () => import("./games/memory.js") },
  { id: "relative-memory", name: "Relative Memory", type: "Shift", blurb: "A melody, then the same tune in a new key: same, or which note changed?", load: () => import("./games/memory.js").then((m) => ({ open: m.openRelative as Opener })) },
];

const app = document.getElementById("app")!;
let handle: Handle;
let token = 0;

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function showHome() {
  closeGame();
  app.innerHTML = "";
  const page = el("main", "home");
  const head = el("header", "home-head");
  head.append(el("div", "home-eyebrow", "SmartEar"), el("h1", "home-title", "Memory"));
  head.append(el("p", "home-sub", "Six games, six kinds of musical memory. Pick one and play."));
  page.append(head);

  const grid = el("div", "home-grid");
  GAMES.forEach((g, i) => {
    const a = el("a", "home-card");
    a.href = `#/${g.id}`;
    const top = el("div", "home-card-top");
    top.append(el("span", "home-card-num", String(i + 1).padStart(2, "0")), el("span", "home-card-type", g.type));
    a.append(top, el("h2", "home-card-name", g.name), el("p", "home-card-blurb", g.blurb));
    grid.append(a);
  });
  page.append(grid);

  const foot = el("footer", "home-foot");
  const label = el("label", "home-pref");
  label.append(el("span", undefined, "Note names"));
  const sel = el("select");
  ([["letter", "C D E"], ["solfege", "Do Ré Mi"], ["german", "C D E H (German)"]] as [NoteSystem, string][]).forEach(([v, t]) => {
    const o = el("option", undefined, t);
    o.value = v;
    sel.append(o);
  });
  sel.value = getNoteSystem();
  sel.addEventListener("change", () => setNoteSystem(sel.value as NoteSystem));
  label.append(sel);
  foot.append(label, el("p", "home-note", "Progress is saved in this browser."));
  page.append(foot);
  app.append(page);
  document.title = "SmartEar Memory";
}

async function showGame(game: Game) {
  closeGame();
  const my = ++token;
  app.innerHTML = "";
  const host = el("div", "legacy-root mk-root");
  app.append(host);
  const [, mod] = await Promise.all([loadVexFlow().catch(() => null), game.load()]);
  if (my !== token) return;
  handle = mod.open(host, {
    onExit: () => (location.hash = "#/"),
    openModule: (id: string) => (location.hash = `#/${id}`),
  });
  document.title = `${game.name} · SmartEar Memory`;
  window.scrollTo(0, 0);
}

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  const game = GAMES.find((g) => g.id === id);
  if (game) showGame(game);
  else {
    token++;
    showHome();
  }
}

window.addEventListener("hashchange", route);
preloadPiano();
route();
