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
import { mkHooks, todayKey } from "./games/memory-kit.js";
import { TIERS, UNRANKED, badge, tierOf, tierIndex, nextTier, tierProgress } from "./rank";
import { submitGame, submitOverall, topGame, topOverall, myPlace, myUid, type Entry, type OverallEntry } from "./board";
import { preloadPiano, stopAllSound, playRewardFx } from "./lib/engine";
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
const RANKED = ["classic", "daily"];
/** Highest level in a ranked run (Classic or Daily). */
const rankedLevel = (p: Progress | null) => (p ? Math.max(0, ...RANKED.map((m) => Number(p.best[m]?.level) || 0)) : 0);
const rankedScore = (p: Progress | null) => (p ? Math.max(0, ...RANKED.map((m) => Number(p.best[m]?.score) || 0)) : 0);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Overall: rating = 100 per ranked level across all six; rank from the average. */
function overall() {
  const levels = GAMES.map((g) => rankedLevel(progressOf(g)));
  const played = levels.filter((l) => l > 0).length;
  const avg = levels.reduce((a, b) => a + b, 0) / GAMES.length;
  return { rating: levels.reduce((a, b) => a + b, 0) * 100, tier: played ? tierOf(Math.max(1, Math.floor(avg))) : UNRANKED, played, avg };
}

/** "5 more levels across your games to Bronze" for the overall rank. */
function overallNext(o: ReturnType<typeof overall>): string {
  const n = nextTier(Math.floor(o.avg));
  if (!n) return "Top rank reached";
  const need = Math.max(1, n.tier.min * GAMES.length - Math.round(o.rating / 100));
  return `${need} more level${need === 1 ? "" : "s"} across your games to ${n.tier.name}`;
}

const NAME_KEY = "smem:name";
function playerName(): string {
  try {
    return (localStorage.getItem(NAME_KEY) || "").slice(0, 20);
  } catch {
    return "";
  }
}
function setPlayerName(v: string) {
  try {
    localStorage.setItem(NAME_KEY, v.trim().slice(0, 20));
  } catch {
    /* storage blocked */
  }
}

// ---------------------------------------------------------------- global leaderboard sync
function ensureName(): string {
  let n = playerName().trim();
  if (!n) {
    n = `Player${Math.floor(1000 + Math.random() * 9000)}`;
    setPlayerName(n);
  }
  return n;
}
/** The better of a game's Classic and Daily bests. */
function bestEntry(p: Progress | null): { level: number; score: number; mode: string } | null {
  if (!p) return null;
  let best: { level: number; score: number; mode: string; r: number } | null = null;
  for (const m of RANKED) {
    const b = p.best[m];
    if (!b || !b.level) continue;
    const r = b.level * 1e7 + (b.score || 0);
    if (!best || r > best.r) best = { level: b.level, score: b.score || 0, mode: m, r };
  }
  return best;
}
async function syncGame(g: Game): Promise<boolean> {
  const e = bestEntry(progressOf(g));
  return e ? submitGame(g.id, { name: ensureName(), ...e }) : false;
}
async function syncOverall(): Promise<boolean> {
  const o = overall();
  return o.played ? submitOverall(ensureName(), o.rating, o.played) : false;
}
let syncTimer = 0;
/** Push every local best (and the overall rating) to the boards, shortly. */
function syncAllSoon(delay = 800) {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(async () => {
    for (const g of GAMES) await syncGame(g);
    await syncOverall();
  }, delay);
}

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
  document.querySelector(".overlay")?.remove();
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
function btn(text: string, cls: string, onClick: () => void) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
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
  links.append(link("#/", active === "home" ? "on" : "", "Games"), link("#/top", active === "top" ? "on" : "", "Leaderboard"), link("#/me", active === "me" ? "on" : "", "Ranks"));
  const o = overall();
  const chip = link("#/me", "nav-rank", "");
  chip.innerHTML = `${badge(o.tier, 26)}<span>${fmt(o.rating)}</span>`;
  chip.title = `${o.tier.name} · rating ${fmt(o.rating)}`;
  links.append(chip);
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
    const lv = rankedLevel(progressOf(g));
    const t = tierOf(lv);
    const corner = el("span", "tile-badge");
    corner.innerHTML = badge(t, 30);
    a.append(corner, icon, el("span", "tile-name", g.name), el("span", "tile-line", g.line));
    const rk = el("span", "tile-rank", lv ? `${t.name} · Lv ${lv}` : "Unranked");
    rk.style.color = lv ? t.color : "";
    a.append(rk);
    grid.append(a);
  });
  wrap.append(grid);
  return wrap;
}

/** A rank card: badge, tier, a bar to the next tier. */
function rankCard(level: number, title: string, sub: string, nextText?: string): HTMLElement {
  const t = tierOf(level);
  const card = el("div", "rank-card");
  card.style.setProperty("--tier", t.color);
  const b = el("div", "rank-badge");
  b.innerHTML = badge(t, 72);
  const txt = el("div", "rank-text");
  txt.append(el("div", "rank-kicker", title), el("div", "rank-name", t.name), el("div", "rank-sub", sub));
  const n = nextTier(level);
  const bar = el("div", "rank-bar");
  const fill = el("div", "rank-fill");
  fill.style.width = `${tierProgress(level) * 100}%`;
  bar.append(fill);
  txt.append(bar, el("div", "rank-next", nextText ?? (n ? `${n.need} more level${n.need === 1 ? "" : "s"} to ${n.tier.name}` : "Top rank reached")));
  card.append(b, txt);
  return card;
}

// ---------------------------------------------------------------- home
function showHome() {
  token++;
  const main = page("home");
  const hero = el("section", "band hero");
  const inner = el("div", "band-inner");
  inner.append(el("div", "eyebrow", "Ranked ear training"), el("h1", "hero-title", "Musical Memory"), el("p", "hero-sub", "Six memory games. Climb from Bronze to Grandmaster, then challenge your friends."));
  const o = overall();
  if (o.played) {
    inner.append(rankCard(Math.floor(o.avg), "Your overall rank", `Rating ${fmt(o.rating)} · ${o.played}/6 games ranked`, overallNext(o)));
  }
  inner.append(link("#/visual-memory", "band-btn", o.played ? "Keep climbing" : "Start ranked"));
  hero.append(inner);
  main.append(hero, tiles());
  const prevWrap = el("section", "panels one");
  const prev = el("div", "panel");
  prev.append(el("h2", "", "Top players"));
  const prevList = el("div", "board", "Loading…");
  prev.append(prevList, link("#/top", "panel-link", "Full leaderboard →"));
  prevWrap.append(prev);
  main.append(prevWrap);
  fillOverall(prevList, 5);
  syncAllSoon(1500);

  const ladder = el("section", "panels one");
  const lp = el("div", "panel");
  lp.append(el("h2", "", "The ladder"));
  const row = el("div", "ladder");
  TIERS.forEach((t) => {
    const c = el("div", "ladder-step");
    c.innerHTML = `${badge(t, 44)}<b>${t.name}</b><span>Level ${t.min}+</span>`;
    row.append(c);
  });
  lp.append(row, el("p", "fine", "Your rank in a game is the highest level you reach in Classic or Daily. Practice runs don't count. Your overall rank is the average across all six games."));
  ladder.append(lp);

  const settings = el("div", "panel");
  settings.append(el("h2", "", "Player"));
  const nameRow = el("label", "setting-row");
  nameRow.append(el("span", "", "Your name (shown on challenges)"));
  const input = el("input", "name-input");
  input.maxLength = 20;
  input.placeholder = "Player";
  input.value = playerName();
  input.addEventListener("change", () => {
    setPlayerName(input.value);
    syncAllSoon(200);
  });
  nameRow.append(input);
  const notes = el("div", "setting-row");
  notes.append(el("span", "", "Note names"));
  const seg = el("div", "seg");
  const opts: [NoteSystem, string][] = [["letter", "C D E"], ["solfege", "Do Ré Mi"], ["german", "C D H"]];
  const btns = opts.map(([v, t]) => {
    const b = btn(t, "", () => {
      setNoteSystem(v);
      btns.forEach((x, i) => x.setAttribute("aria-pressed", String(opts[i][0] === v)));
    });
    b.setAttribute("aria-pressed", String(getNoteSystem() === v));
    return b;
  });
  seg.append(...btns);
  notes.append(seg);
  settings.append(nameRow, notes, el("p", "fine", "Your scores are saved on this device, and your best runs go on the public leaderboard under this name."));
  ladder.append(settings);
  main.append(ladder);
  document.title = "Musical Memory · Ranked";
}

// ---------------------------------------------------------------- challenges
interface Challenge {
  score: number;
  level: number;
  mode: "classic" | "daily";
  name: string;
  date: string;
}
function parseChallenge(q: string): Challenge | null {
  const p = new URLSearchParams(q);
  if (!p.has("c")) return null;
  const score = Number(p.get("c"));
  if (!Number.isFinite(score) || score < 0) return null;
  const mode = p.get("m") === "classic" ? "classic" : "daily";
  return { score, level: Number(p.get("l")) || 0, mode, name: (p.get("n") || "A friend").slice(0, 20), date: p.get("d") || "" };
}
function challengeUrl(g: Game, r: { score: number; level: number; mode: string }) {
  const q = new URLSearchParams({ c: String(Math.round(r.score)), l: String(r.level), m: r.mode === "daily" ? "daily" : "classic", n: playerName() || "A friend", d: todayKey() });
  return `${location.origin}${location.pathname}#/${g.id}?${q}`;
}
async function shareChallenge(g: Game, r: { score: number; level: number; mode: string }, note: HTMLElement) {
  const url = challengeUrl(g, r);
  const what = r.mode === "daily" ? `today's ${g.name} Daily` : `${g.name} (Classic)`;
  const text = `I scored ${fmt(r.score)} (${tierOf(r.level).name}, level ${r.level}) on ${what} in Musical Memory. Think you can beat me?`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Musical Memory challenge", text, url });
      note.textContent = "Challenge sent!";
      return;
    }
  } catch {
    /* cancelled: fall back to copying */
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    note.textContent = "Challenge link copied. Paste it anywhere!";
  } catch {
    note.textContent = url;
  }
}

// ---------------------------------------------------------------- a game
async function showGame(game: Game, challenge: Challenge | null) {
  const my = ++token;
  const main = page("game");
  const band = el("section", "band game-band");
  band.style.setProperty("--icon", iconUrl(game));
  if (challenge) {
    const sameDay = challenge.mode === "daily" && challenge.date === todayKey();
    const banner = el("div", "challenge-banner");
    const txt = el("div", "challenge-text");
    txt.innerHTML = `<span class="vs">VS</span><span><b></b> scored <b class="target">${fmt(challenge.score)}</b> (level ${challenge.level}) on ${challenge.mode === "daily" ? (sameDay ? "today's Daily, the same puzzle you'll get" : "a Daily puzzle") : "Classic"}. Beat it!</span>`;
    (txt.querySelector("b") as HTMLElement).textContent = challenge.name;
    const accept = btn("Accept", "challenge-go", () => startMode(challenge.mode));
    banner.append(txt, accept);
    band.append(banner);
  }
  const host = el("div", "legacy-root mk-root");
  band.append(host);

  const panels = el("section", "panels");
  const stats = el("div", "panel");
  const about = el("div", "panel");
  about.append(el("h2", "", "How to play"));
  const ol = el("ol", "about-steps");
  game.about.forEach((t) => ol.append(el("li", "", t)));
  about.append(ol, el("p", "fine", "Play: ranked, 3 lives. Daily: ranked, the same puzzle for everyone today. Practice: no lives, not ranked."));
  const topPanel = el("div", "panel wide");
  const topHead = el("div", "panel-head");
  topHead.append(el("h2", "", "Top players"), link(`#/top?g=${game.id}`, "panel-link", "Full board →"));
  const topList = el("div", "board", "Loading…");
  topPanel.append(topHead, topList);
  panels.append(stats, about, topPanel);
  main.append(band, panels);
  const drawTop = () => fillGame(topList, game, 10);
  drawTop();

  const drawStats = () => renderStats(stats, game);
  drawStats();

  let before = progressOf(game);
  mkHooks.onRunEnd = (_id: string, r: { score: number; level: number; mode: string; counted: boolean }) => {
    const prev = before;
    before = progressOf(game);
    setTimeout(drawStats, 50);
    // Refresh the rank chip in the top bar.
    const chip = document.querySelector(".nav-rank");
    if (chip) {
      const o = overall();
      chip.innerHTML = `${badge(o.tier, 26)}<span>${fmt(o.rating)}</span>`;
    }
    if (r.mode === "training") return;
    const ov = showRunEnd(game, r, prev, challenge && challenge.mode === r.mode ? challenge : null);
    const globalEl = ov.querySelector(".ov-global") as HTMLElement;
    (async () => {
      const ok = await syncGame(game);
      await syncOverall();
      const place = ok ? await myPlace(game.id) : null;
      if (globalEl) globalEl.textContent = place && place.place ? `Global rank #${place.place} of ${place.total} on ${game.name}` : ok ? "" : "Leaderboard offline: your score is saved on this device.";
      drawTop();
    })();
  };

  function startMode(mode: "classic" | "daily") {
    const hubBtn = mode === "daily" ? host.querySelector<HTMLButtonElement>(".mk-more-btn") : host.querySelector<HTMLButtonElement>(".mk-play");
    if (hubBtn) hubBtn.click();
    band.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const [, mod] = await Promise.all([loadVexFlow().catch(() => null), game.load()]);
  if (my !== token) return;
  handle = mod.open(host, {
    onExit: () => (location.hash = "#/"),
    openModule: (id: string) => (location.hash = `#/${id}`),
  });
  document.title = `${game.name} · Musical Memory`;
}

/** The big moment after a ranked run: rank up, new best, or a challenge result. */
function showRunEnd(g: Game, r: { score: number; level: number; mode: string; counted: boolean }, prev: Progress | null, ch: Challenge | null): HTMLElement {
  const oldLevel = rankedLevel(prev);
  const newLevel = Math.max(oldLevel, r.counted ? r.level : 0);
  const rankUp = r.counted && tierIndex(newLevel) > tierIndex(oldLevel);
  const prevBest = prev ? Number(prev.best[r.mode]?.score) || 0 : 0;
  const newBest = r.counted && r.score > prevBest && r.score > 0;

  const ov = el("div", "overlay");
  const card = el("div", "ov-card");
  let headline = "Run complete";
  let kind = "plain";
  if (ch) {
    const won = r.score > ch.score;
    headline = won ? "Victory" : r.score === ch.score ? "Draw" : "Defeat";
    kind = won ? "win" : "lose";
  } else if (rankUp) {
    headline = "Rank up!";
    kind = "up";
  } else if (newBest) {
    headline = "New best!";
    kind = "best";
  }
  card.classList.add(kind);
  const t = tierOf(newLevel);
  card.style.setProperty("--tier", t.color);
  card.append(el("div", "ov-kicker", `${g.name} · ${r.mode === "daily" ? "Daily" : "Classic"}`), el("div", "ov-headline", headline));
  const b = el("div", "ov-badge");
  b.innerHTML = badge(t, 112);
  card.append(b);
  if (rankUp) card.append(el("div", "ov-tier", `${tierOf(oldLevel).name} → ${t.name}`));
  else card.append(el("div", "ov-tier", t.name));

  const nums = el("div", "ov-nums");
  const num = (v: string, l: string) => {
    const d = el("div", "ov-num");
    d.append(el("b", "", v), el("span", "", l));
    return d;
  };
  if (ch) {
    nums.append(num(fmt(r.score), "You"), num(fmt(ch.score), ch.name));
  } else {
    nums.append(num(fmt(r.score), "Score"), num(String(r.level), "Level"));
  }
  card.append(nums, el("div", "ov-global", r.counted ? "Posting to the leaderboard…" : ""));
  if (!r.counted) card.append(el("p", "ov-note", "You already played today's Daily, so this run isn't ranked."));
  else {
    const n = nextTier(newLevel);
    card.append(el("p", "ov-note", n ? `${n.need} more level${n.need === 1 ? "" : "s"} to ${n.tier.name}` : "You're at the top rank."));
  }

  const nameRow = el("label", "ov-name");
  nameRow.append(el("span", "", "Your name"));
  const input = el("input", "name-input");
  input.maxLength = 20;
  input.placeholder = "Player";
  input.value = playerName();
  input.addEventListener("input", () => setPlayerName(input.value));
  input.addEventListener("change", () => syncAllSoon(200));
  nameRow.append(input);
  const note = el("div", "ov-share-note");
  const actions = el("div", "ov-actions");
  actions.append(
    btn("Close", "ov-btn ghost", () => ov.remove()),
    btn(ch ? "Challenge back" : "Challenge a friend", "ov-btn primary", () => shareChallenge(g, r, note)),
  );
  card.append(nameRow, actions, note);
  ov.append(card);
  ov.addEventListener("click", (e) => e.target === ov && ov.remove());
  document.body.append(ov);
  if (kind === "up" || kind === "best" || kind === "win") {
    try {
      playRewardFx();
    } catch {
      /* no audio */
    }
    burst(ov, t.color);
  }
  return ov;
}

/** A quick confetti burst behind the card. */
function burst(host: HTMLElement, color: string) {
  const colors = [color, "#ffffff", "#ff5a1f", "#ffd75e"];
  for (let i = 0; i < 36; i++) {
    const p = el("i", "confetti");
    const ang = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 160;
    p.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(ang) * dist - 60}px`);
    p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.12}s`;
    host.append(p);
  }
}

function renderStats(box: HTMLElement, g: Game) {
  box.innerHTML = "";
  const p = progressOf(g);
  const lv = rankedLevel(p);
  box.append(el("h2", "", "Your rank"));
  box.append(rankCard(lv, g.name, lv ? `Best ranked level ${lv}` : "Play a ranked run to get placed"));
  if (!p || !p.runs) return;
  const facts = el("div", "facts");
  const fact = (v: string, l: string) => {
    const f = el("div", "fact");
    f.append(el("b", "", v), el("span", "", l));
    return f;
  };
  const streakAlive = p.lastDay != null && (Date.now() - new Date(p.lastDay).getTime()) / 864e5 < 2;
  facts.append(fact(fmt(rankedScore(p)), "Best score"), fact(String(lv), "Top level"), fact(String(p.runs), p.runs === 1 ? "Run" : "Runs"), fact(String(streakAlive ? p.streakDays : 0), "Day streak"));
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
        const c = h.m === "training" ? "var(--b-dim)" : tierOf(h.l || 0).color;
        return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(H - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="${c}"><title>Level ${h.l}, ${fmt(h.s)} pts${h.m === "training" ? " (practice)" : ""}</title></rect>`;
      })
      .join("");
    const chart = el("div", "chart");
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Level reached in your recent runs">${bars}</svg>`;
    box.append(chart);
  }
}

// ---------------------------------------------------------------- ranks page
function showDashboard() {
  token++;
  const main = page("me");
  const band = el("section", "band small");
  const inner = el("div", "band-inner");
  const o = overall();
  inner.append(el("div", "eyebrow", "Your ranks"));
  inner.append(rankCard(Math.floor(o.avg), playerName() || "Overall", `Rating ${fmt(o.rating)} · ${o.played}/6 games ranked`, overallNext(o)));
  band.append(inner);
  const panels = el("section", "panels one");
  const panel = el("div", "panel");
  panel.append(el("h2", "", "Every game"));
  const table = el("table", "scores");
  table.innerHTML = "<thead><tr><th>Game</th><th>Rank</th><th>Level</th><th>Best</th></tr></thead>";
  const tb = el("tbody");
  GAMES.forEach((g) => {
    const p = progressOf(g);
    const lv = rankedLevel(p);
    const t = tierOf(lv);
    const tr = el("tr");
    const name = el("td");
    const a = link(`#/${g.id}`, "row-link", "");
    const ic = el("span", "mini-icon");
    ic.style.setProperty("--tint", g.tint);
    ic.innerHTML = g.icon;
    a.append(ic, el("span", "", g.name));
    name.append(a);
    const rk = el("td");
    rk.innerHTML = `<span class="rank-cell">${badge(t, 24)}<span>${t.name}</span></span>`;
    tr.append(name, rk, el("td", "num", lv ? String(lv) : "–"), el("td", "num", lv ? fmt(rankedScore(p)) : "–"));
    tb.append(tr);
  });
  table.append(tb);
  panel.append(table);

  // Personal top runs: real runs from this device, best level first.
  const runs = GAMES.flatMap((g) => (progressOf(g)?.history || []).filter((h) => h.m !== "training").map((h) => ({ g, h })));
  runs.sort((a, b) => b.h.l - a.h.l || b.h.s - a.h.s);
  const top = el("div", "panel");
  top.append(el("h2", "", "Your top runs"));
  if (!runs.length) top.append(el("p", "empty", "No ranked runs yet."));
  else {
    const ol = el("ol", "top-runs");
    runs.slice(0, 10).forEach(({ g, h }, i) => {
      const li = el("li");
      const t = tierOf(h.l);
      li.innerHTML = `<span class="pos">${i + 1}</span>${badge(t, 22)}<span class="tr-game"></span><span class="tr-meta">Lv ${h.l} · ${fmt(h.s)}</span>`;
      (li.querySelector(".tr-game") as HTMLElement).textContent = `${g.name}${h.m === "daily" ? " · Daily" : ""}`;
      ol.append(li);
    });
    top.append(ol);
  }
  panels.append(panel, top);
  main.append(band, panels);
  document.title = "Ranks · Musical Memory";
}

// ---------------------------------------------------------------- router
function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [id, q = ""] = raw.split("?");
  if (id === "me") return showDashboard();
  if (id === "top") return showLeaderboard(new URLSearchParams(q).get("g"));
  const game = GAMES.find((g) => g.id === id);
  if (game) showGame(game, parseChallenge(q));
  else showHome();
}

window.addEventListener("hashchange", route);
preloadPiano();
route();

// ---------------------------------------------------------------- leaderboards
function boardRow(pos: number, name: string, tierLevel: number, right: string, me: boolean): HTMLElement {
  const row = el("div", "board-row" + (me ? " me" : "") + (pos <= 3 ? ` top${pos}` : ""));
  const t = tierOf(tierLevel);
  row.append(el("span", "b-pos", String(pos)));
  const b = el("span", "b-badge");
  b.innerHTML = badge(t, 26);
  row.append(b);
  const nm = el("span", "b-name", name);
  if (me) nm.append(el("span", "b-you", "you"));
  row.append(nm, el("span", "b-val", right));
  return row;
}
function emptyBoard(box: HTMLElement, rows: unknown[] | null) {
  box.innerHTML = "";
  if (rows === null) box.append(el("p", "empty", "The leaderboard can't be reached right now. Your scores are safe on this device."));
  else if (!rows.length) box.append(el("p", "empty", "No one on this board yet. Play a ranked run and take #1!"));
  return rows === null || !rows.length;
}
async function fillGame(box: HTMLElement, g: Game, n: number) {
  const [rows, me] = await Promise.all([topGame(g.id, n), myUid()]);
  if (!box.isConnected || emptyBoard(box, rows)) return;
  (rows as Entry[]).forEach((e, i) => box.append(boardRow(i + 1, e.name, e.level, `Lv ${e.level} · ${fmt(e.score)}`, e.uid === me)));
}
async function fillOverall(box: HTMLElement, n: number) {
  const [rows, me] = await Promise.all([topOverall(n), myUid()]);
  if (!box.isConnected || emptyBoard(box, rows)) return;
  (rows as OverallEntry[]).forEach((e, i) => box.append(boardRow(i + 1, e.name, Math.floor(e.rating / 100 / GAMES.length), `${fmt(e.rating)} · ${e.games}/6`, e.uid === me)));
}

function showLeaderboard(gameId: string | null) {
  token++;
  const main = page("top");
  const game = GAMES.find((g) => g.id === gameId) || null;
  const band = el("section", "band small");
  const inner = el("div", "band-inner");
  inner.append(el("div", "eyebrow", "Worldwide"), el("h1", "hero-title", "Leaderboard"));
  const place = el("p", "hero-sub", "Finding your place…");
  inner.append(place);
  band.append(inner);

  const tabs = el("nav", "board-tabs");
  const tab = (label: string, id: string | null) => {
    const a = link(id ? `#/top?g=${id}` : "#/top", "board-tab" + (id === (game?.id ?? null) ? " on" : ""), label);
    tabs.append(a);
  };
  tab("Overall", null);
  GAMES.forEach((g) => tab(g.name, g.id));

  const panels = el("section", "panels one");
  const panel = el("div", "panel");
  panel.append(tabs);
  const head = el("div", "board-head");
  head.append(el("span", "", "#"), el("span", "", ""), el("span", "", "Player"), el("span", "", game ? "Level · score" : "Rating · games"));
  const list = el("div", "board", "Loading…");
  panel.append(head, list, el("p", "fine", game ? "Each player's best Classic or Daily run. Ranked by level, then score." : "Rating = 100 points for every ranked level across all six games."));
  panels.append(panel);
  main.append(band, panels);
  document.title = "Leaderboard · Musical Memory";

  syncAllSoon(0);
  (game ? fillGame(list, game, 50) : fillOverall(list, 50)).then(async () => {
    const pl = await myPlace(game ? game.id : null);
    if (!place.isConnected) return;
    if (!pl) place.textContent = "Leaderboard offline right now.";
    else if (!pl.place) place.textContent = `${pl.total} player${pl.total === 1 ? "" : "s"} ranked. Play a ranked run to join them.`;
    else place.textContent = `You're #${pl.place} of ${pl.total} as ${ensureName()}.`;
  });
}
