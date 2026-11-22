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
import "./styles/simple.css";

import { loadVexFlow } from "./lib/vexflow";
import { preloadPiano, stopAllSound } from "./lib/engine";
import { getNoteSystem, setNoteSystem } from "./lib/prefs";
import type { NoteSystem } from "./lib/theory";

type Handle = { destroy?: () => void } | void;
type Opener = (c: HTMLElement, o: { onExit: () => void; openModule: (id: string) => void; start?: string }) => Handle;

interface Game {
  id: string;
  name: string;
  line: string;
  tint: string;
  icon: string;
  storageKey: string;
  load: () => Promise<{ open: Opener }>;
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const GAMES: Game[] = [
  { id: "visual-memory", name: "Visual", line: "Remember notes on the staff", tint: "#ffb547", storageKey: "smartear_visual_memory_v2",
    icon: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), load: () => import("./games/visual-memory.js") },
  { id: "sequence-memory", name: "Sequence", line: "Play back a growing melody", tint: "#f39a6b", storageKey: "smartear_sequence_memory_v1",
    icon: svg('<path d="M4 18V14M10 18V10M16 18V6M22 18V3"/>'), load: () => import("./games/sequence-memory.js") },
  { id: "pairs-memory", name: "Pairs", line: "Find matching sounds", tint: "#8fc4a0", storageKey: "smartear_pairs_memory_v1",
    icon: svg('<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>'), load: () => import("./games/pairs-memory.js") },
  { id: "hold-memory", name: "Pitch Hold", line: "Hold one note in your head", tint: "#9fb8e6", storageKey: "smartear_hold_memory_v1",
    icon: svg('<path d="M12 3v10"/><circle cx="12" cy="17" r="4"/>'), load: () => import("./games/hold-memory.js") },
  { id: "memory", name: "Compare", line: "Spot the note that changed", tint: "#e3a9c9", storageKey: "smartear_comparison_memory_v1",
    icon: svg('<path d="M3 9h18M3 15h18"/><circle cx="15" cy="9" r="2" fill="currentColor"/>'), load: () => import("./games/memory.js") },
  { id: "relative-memory", name: "Relative", line: "Same tune, new key", tint: "#c7b4f0", storageKey: "smartear_relative_memory_v1",
    icon: svg('<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>'), load: () => import("./games/memory.js").then((m) => ({ open: m.openRelative as Opener })) },
];

/** Highest level reached in any mode (read from the games' saved progress). */
function topLevel(key: string): number {
  try {
    const p = JSON.parse(localStorage.getItem(key) || "null");
    if (!p || !p.best) return 0;
    return Math.max(0, ...Object.values(p.best as Record<string, { level?: number }>).map((b) => Number(b.level) || 0));
  } catch {
    return 0;
  }
}

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
  page.append(el("h1", "home-title", "Memory"), el("p", "home-sub", "Train your musical memory."));

  const list = el("ul", "home-list");
  GAMES.forEach((g) => {
    const li = el("li");
    const a = el("a", "home-row");
    a.href = `#/${g.id}`;
    const icon = el("span", "home-icon");
    icon.style.setProperty("--tint", g.tint);
    icon.innerHTML = g.icon;
    const text = el("span", "home-text");
    text.append(el("span", "home-name", g.name), el("span", "home-line", g.line));
    a.append(icon, text);
    const lv = topLevel(g.storageKey);
    if (lv) {
      const best = el("span", "home-best");
      best.append(el("b", undefined, String(lv)), document.createTextNode("level"));
      a.append(best);
    } else a.append(el("span", "home-chev", "›"));
    li.append(a);
    list.append(li);
  });
  page.append(list);

  const foot = el("footer", "home-foot");
  foot.append(el("span", "home-foot-label", "Note names"));
  const seg = el("div", "seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Note names");
  const opts: [NoteSystem, string][] = [["letter", "C D E"], ["solfege", "Do Ré Mi"], ["german", "C D H"]];
  const btns = opts.map(([v, t]) => {
    const b = el("button", undefined, t);
    b.type = "button";
    b.setAttribute("aria-pressed", String(getNoteSystem() === v));
    b.addEventListener("click", () => {
      setNoteSystem(v);
      btns.forEach((x, i) => x.setAttribute("aria-pressed", String(opts[i][0] === v)));
    });
    return b;
  });
  seg.append(...btns);
  foot.append(seg, el("p", "home-note", "Your progress is saved on this device."));
  page.append(foot);
  app.append(page);
  document.title = "Memory";
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
  document.title = `${game.name} · Memory`;
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
