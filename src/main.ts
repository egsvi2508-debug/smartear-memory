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
import "./styles/bench.css";

import { loadVexFlow } from "./lib/vexflow";
import { mkHooks } from "./games/memory-kit.js";
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
  about: string[];
  load: () => Promise<{ open: Opener }>;
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const GAMES: Game[] = [
  { id: "visual-memory", name: "Visual", line: "Remember notes on the staff", tint: "#ffb547", storageKey: "smartear_visual_memory_v2", about: ["Notes flash on the staff for a few seconds, then vanish. Nothing plays: eyes only.", "Tap the staff where each note was. Pick ♭ ♮ ♯ first if a note needs one.", "A perfect board adds one more note. Three misses and the run is over."],
    icon: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), load: () => import("./games/visual-memory.js") },
  { id: "sequence-memory", name: "Sequence", line: "Play back a growing melody", tint: "#f39a6b", storageKey: "smartear_sequence_memory_v1", about: ["A melody plays, with its notes, lit keys or sound alone (your choice).", "Play it back on the piano in the same order.", "Each success adds one note to the same melody. How long can you go?"],
    icon: svg('<path d="M4 18V14M10 18V10M16 18V6M22 18V3"/>'), load: () => import("./games/sequence-memory.js") },
  { id: "pairs-memory", name: "Pairs", line: "Find matching sounds", tint: "#8fc4a0", storageKey: "smartear_pairs_memory_v1", about: ["Every card hides a sound, and every sound is on two cards.", "Tap a card to hear it, then find its twin. Nothing is timed.", "Clear every pair within the miss limit to move up a level."],
    icon: svg('<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>'), load: () => import("./games/pairs-memory.js") },
  { id: "hold-memory", name: "Pitch Hold", line: "Hold one note in your head", tint: "#9fb8e6", storageKey: "smartear_hold_memory_v1", about: ["One tone plays. Keep it in mind, without singing it.", "A stream of other notes tries to knock it out of your head.", "Find your tone again on the strip and lock it in."],
    icon: svg('<path d="M12 3v10"/><circle cx="12" cy="17" r="4"/>'), load: () => import("./games/hold-memory.js") },
  { id: "memory", name: "Compare", line: "Spot the note that changed", tint: "#e3a9c9", storageKey: "smartear_comparison_memory_v1", about: ["A melody plays while its notes light up on the staff.", "It plays again in the same key. Did any note change?", "If you heard a change, tap the note that changed."],
    icon: svg('<path d="M3 9h18M3 15h18"/><circle cx="15" cy="9" r="2" fill="currentColor"/>'), load: () => import("./games/memory.js") },
  { id: "relative-memory", name: "Relative", line: "Same tune, new key", tint: "#c7b4f0", storageKey: "smartear_relative_memory_v1", about: ["A melody plays while its notes light up on the staff.", "It plays again in a new key. Same tune, or did a note change?", "If you heard a change, tap the note that changed."],
    icon: svg('<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>'), load: () => import("./games/memory.js").then((m) => ({ open: m.openRelative as Opener })) },
];

// ---------------------------------------------------------------- saved progress
interface Progress {
  best: Record<string, { score: number; level: number }>;
  runs: number;
  streakDays: number;
  lastDay: string | null;
  history: { m: string; s: number; l: number; t: number }[];
}
function progressOf(g: Game): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(g.storageKey) || "null");
    return p && p.best ? p : null;
  } catch {
    return null;
  }
}
const bestScore = (p: Progress | null) => (p ? Math.max(0, ...Object.values(p.best).map((b) => Number(b.score) || 0)) : 0);
const topLevel = (p: Progress | null) => (p ? Math.max(0, ...Object.values(p.best).map((b) => Number(b.level) || 0)) : 0);
const fmt = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------- shared bits
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
  mkHooks.onRunEnd = null;
  stopAllSound();
  document.body.classList.remove("mode-train");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function link(href: string, cls: string, text: string) {
  const a = el("a", cls, text);
  a.href = href;
  return a;
}
const iconUrl = (g: Game) => `url("data:image/svg+xml,${encodeURIComponent(g.icon.replace('stroke="currentColor"', 'stroke="black"').replace(/fill="currentColor"/g, 'fill="black"').replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}")`;

function page(active: string): HTMLElement {
  closeGame();
  app.innerHTML = "";
  const nav = el("header", "nav");
  const inner = el("div", "nav-inner");
  const logo = link("#/", "logo", "");
  logo.innerHTML = `<span class="logo-mark">${svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')}</span><span>Musical Memory</span>`;
  const links = el("nav", "nav-links");
  const games = link("#/", active === "home" ? "on" : "", "Games");
  const dash = link("#/me", active === "me" ? "on" : "", "Dashboard");
  links.append(games, dash);
  inner.append(logo, links);
  nav.append(inner);
  const main = el("main");
  app.append(nav, main);
  window.scrollTo(0, 0);
  return main;
}

function tiles(): HTMLElement {
  const wrap = el("section", "tiles-wrap");
  const grid = el("div", "tiles");
  GAMES.forEach((g) => {
    const a = link(`#/${g.id}`, "tile", "");
    const icon = el("span", "tile-icon");
    icon.style.setProperty("--tint", g.tint);
    icon.innerHTML = g.icon;
    a.append(icon, el("span", "tile-name", g.name), el("span", "tile-line", g.line));
    const lv = topLevel(progressOf(g));
    if (lv) a.append(el("span", "tile-best", `Level ${lv}`));
    grid.append(a);
  });
  wrap.append(grid);
  return wrap;
}

// ---------------------------------------------------------------- home
function showHome() {
  token++;
  const main = page("home");
  const hero = el("section", "band hero");
  const inner = el("div", "band-inner");
  const mark = el("div", "hero-icon");
  mark.innerHTML = svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
  inner.append(mark, el("h1", "hero-title", "Musical Memory"), el("p", "hero-sub", "Six games, six kinds of musical memory. Find your limit."));
  inner.append(link("#/visual-memory", "band-btn", "Get started"));
  hero.append(inner);
  main.append(hero, tiles());

  const notes = el("section", "panels one");
  const panel = el("div", "panel");
  panel.append(el("h2", "", "Settings"));
  const row = el("div", "setting-row");
  row.append(el("span", "", "Note names"));
  const seg = el("div", "seg");
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
  row.append(seg);
  panel.append(row, el("p", "fine", "Your scores are saved on this device."));
  notes.append(panel);
  main.append(notes);
  document.title = "Musical Memory";
}

// ---------------------------------------------------------------- a game
async function showGame(game: Game) {
  const my = ++token;
  const main = page("game");
  const band = el("section", "band game-band");
  band.style.setProperty("--icon", iconUrl(game));
  const host = el("div", "legacy-root mk-root");
  band.append(host);

  const panels = el("section", "panels");
  const stats = el("div", "panel");
  const about = el("div", "panel");
  about.append(el("h2", "", "About the game"));
  const ol = el("ol", "about-steps");
  game.about.forEach((t) => ol.append(el("li", "", t)));
  about.append(ol, el("p", "fine", "Play: lives and levels. Daily: the same puzzle for everyone today. Practice: no lives."));
  panels.append(stats, about);
  main.append(band, panels);

  const drawStats = () => renderStats(stats, game);
  drawStats();
  mkHooks.onRunEnd = () => setTimeout(drawStats, 50);

  const [, mod] = await Promise.all([loadVexFlow().catch(() => null), game.load()]);
  if (my !== token) return;
  handle = mod.open(host, {
    onExit: () => (location.hash = "#/"),
    openModule: (id: string) => (location.hash = `#/${id}`),
  });
  document.title = `${game.name} · Musical Memory`;
}

function renderStats(box: HTMLElement, g: Game) {
  box.innerHTML = "";
  box.append(el("h2", "", "Your statistics"));
  const p = progressOf(g);
  if (!p || !p.runs) {
    box.append(el("p", "empty", "Play a run to see your scores here."));
    return;
  }
  const facts = el("div", "facts");
  const fact = (v: string, l: string) => {
    const f = el("div", "fact");
    f.append(el("b", "", v), el("span", "", l));
    return f;
  };
  const streakAlive = p.lastDay != null && (Date.now() - new Date(p.lastDay).getTime()) / 864e5 < 2;
  facts.append(fact(fmt(bestScore(p)), "Best score"), fact(String(topLevel(p)), "Top level"), fact(String(p.runs), p.runs === 1 ? "Run" : "Runs"), fact(String(streakAlive ? p.streakDays : 0), "Day streak"));
  box.append(facts);

  const recent = (p.history || []).slice(-15);
  if (recent.length) {
    box.append(el("div", "chart-label", "Recent runs (level reached)"));
    const max = Math.max(...recent.map((h) => h.l || 0), 1);
    const W = 300, H = 90, gap = 4;
    const bw = (W - gap * (recent.length - 1)) / Math.max(recent.length, 1);
    const bars = recent
      .map((h, i) => {
        const hh = Math.max(3, ((h.l || 0) / max) * (H - 4));
        return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(H - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2"><title>Level ${h.l}, ${fmt(h.s)} pts</title></rect>`;
      })
      .join("");
    const chart = el("div", "chart");
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Level reached in your recent runs">${bars}</svg>`;
    box.append(chart);
  }
}

// ---------------------------------------------------------------- dashboard
function showDashboard() {
  token++;
  const main = page("me");
  const band = el("section", "band small");
  const inner = el("div", "band-inner");
  inner.append(el("h1", "hero-title", "Dashboard"), el("p", "hero-sub", "Your best result in every game."));
  band.append(inner);
  const panels = el("section", "panels one");
  const panel = el("div", "panel");
  const table = el("table", "scores");
  table.innerHTML = "<thead><tr><th>Game</th><th>Top level</th><th>Best score</th><th>Runs</th></tr></thead>";
  const tb = el("tbody");
  GAMES.forEach((g) => {
    const p = progressOf(g);
    const tr = el("tr");
    const name = el("td");
    const a = link(`#/${g.id}`, "row-link", "");
    const ic = el("span", "mini-icon");
    ic.style.setProperty("--tint", g.tint);
    ic.innerHTML = g.icon;
    a.append(ic, el("span", "", g.name));
    name.append(a);
    const lv = topLevel(p);
    tr.append(name, el("td", "num", lv ? String(lv) : "–"), el("td", "num", p && p.runs ? fmt(bestScore(p)) : "–"), el("td", "num", String(p?.runs || 0)));
    tb.append(tr);
  });
  table.append(tb);
  panel.append(table);
  panels.append(panel);
  main.append(band, panels);
  document.title = "Dashboard · Musical Memory";
}

// ---------------------------------------------------------------- router
function route() {
  const id = location.hash.replace(/^#\/?/, "");
  if (id === "me") return showDashboard();
  const game = GAMES.find((g) => g.id === id);
  if (game) showGame(game);
  else showHome();
}

window.addEventListener("hashchange", route);
preloadPiano();
route();
