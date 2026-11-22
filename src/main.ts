// SmartEar Memory, the six memory games from SmartEar as their own app.
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
import "./styles/plain.css";

import { loadVexFlow } from "./lib/vexflow";
import { mkHooks, todayKey } from "./games/memory-kit.js";
import { TIERS, UNRANKED, badge, tierOf, tierIndex, nextTier, tierProgress } from "./rank";
import { nameProblem } from "./names";
import { makeCard, saveCard } from "./card";
import { submitGame, submitOverall, topGame, topOverall, myPlace, myUid, removeMe, type Entry, type OverallEntry } from "./board";
import { preloadPiano, stopAllSound, playRewardFx } from "./lib/engine";
import { getNoteSystem, setNoteSystem } from "./lib/prefs";
import type { NoteSystem } from "./lib/theory";

type Handle = { destroy?: () => void } | void;
type Opener = (c: HTMLElement, o: { onExit: () => void; openModule: (id: string) => void; start?: string }) => Handle;

interface Game {
  id: string;
  name: string;
  line: string;
  storageKey: string;
  about: string[];
  load: () => Promise<{ open: Opener }>;
}

const GAMES: Game[] = [
  { id: "visual-memory", name: "Visual", line: "Remember notes on the staff", storageKey: "smartear_visual_memory_v2", about: ["Notes flash on the staff for a few seconds, then vanish. Nothing plays: eyes only.", "Tap the staff where each note was. Pick ♭ ♮ ♯ first if a note needs one.", "A perfect board adds one more note. Three misses and the run is over."], load: () => import("./games/visual-memory.js") },
  { id: "sequence-memory", name: "Sequence", line: "Play back a growing melody", storageKey: "smartear_sequence_memory_v1", about: ["A melody plays, with its notes, lit keys or sound alone (your choice).", "Play it back on the piano in the same order.", "Each success adds one note to the same melody. How long can you go?"], load: () => import("./games/sequence-memory.js") },
  { id: "pairs-memory", name: "Pairs", line: "Find matching sounds", storageKey: "smartear_pairs_memory_v1", about: ["Every card hides a sound, and every sound is on two cards.", "Tap a card to hear it, then find its twin. Nothing is timed.", "Clear every pair within the miss limit to move up a level."], load: () => import("./games/pairs-memory.js") },
  { id: "hold-memory", name: "Pitch Hold", line: "Hold one note in your head", storageKey: "smartear_hold_memory_v1", about: ["One tone plays. Keep it in mind, without singing it.", "A stream of other notes tries to knock it out of your head.", "Find your tone again on the strip and lock it in."], load: () => import("./games/hold-memory.js") },
  { id: "memory", name: "Compare", line: "Spot the note that changed", storageKey: "smartear_comparison_memory_v1", about: ["A melody plays while its notes light up on the staff.", "It plays again in the same key. Did any note change?", "If you heard a change, tap the note that changed."], load: () => import("./games/memory.js") },
  { id: "relative-memory", name: "Relative", line: "Same tune, new key", storageKey: "smartear_relative_memory_v1", about: ["A melody plays while its notes light up on the staff.", "It plays again in a new key. Same tune, or did a note change?", "If you heard a change, tap the note that changed."], load: () => import("./games/memory.js").then((m) => ({ open: m.openRelative as Opener })) },
];

// ---------------------------------------------------------------- saved progress
interface Progress {
  best: Record<string, { score: number; level: number }>;
  daily?: { date: string; score: number; level: number } | null;
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
/** Save a name if it's allowed; returns the problem otherwise. */
function setPlayerName(v: string): string | null {
  const problem = nameProblem(v);
  if (problem) return problem;
  try {
    localStorage.setItem(NAME_KEY, v.trim().replace(/\s+/g, " ").slice(0, 20));
  } catch {
    /* storage blocked */
  }
  return null;
}
/** A name input that only saves allowed names and says why otherwise. */
function nameField(onSaved?: () => void): { input: HTMLInputElement; msg: HTMLElement } {
  const input = el("input", "name-input");
  input.maxLength = 20;
  input.placeholder = "Your player name";
  input.setAttribute("autocomplete", "nickname");
  input.value = playerName();
  const msg = el("div", "name-msg");
  const save = () => {
    if (input.value.trim() === playerName()) return void (msg.textContent = "");
    const problem = setPlayerName(input.value);
    msg.textContent = problem ?? "Saved";
    msg.className = "name-msg " + (problem ? "bad" : "ok");
    if (!problem) onSaved?.();
  };
  input.addEventListener("change", save);
  input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
  return { input, msg };
}

// ---------------------------------------------------------------- global leaderboard sync
function ensureName(): string {
  let n = playerName().trim();
  if (!n || nameProblem(n)) {
    n = `Player${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage blocked */
    }
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
const OFF_KEY = "smem:offBoard";
function offBoard(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}
function setOffBoard(v: boolean) {
  try {
    if (v) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* private mode */
  }
}
async function syncGame(g: Game): Promise<boolean> {
  if (offBoard()) return false;
  const p = progressOf(g);
  const e = bestEntry(p);
  if (!e) return false;
  const ok = await submitGame(g.id, { name: ensureName(), ...e });
  // Today's Daily (the ranked first attempt) also goes on today's board.
  const d = p?.daily;
  if (d && d.date === todayKey() && d.level >= 1) await submitGame(g.id, { name: ensureName(), level: d.level, score: d.score, mode: "daily" }, d.date);
  return ok;
}
async function syncOverall(): Promise<boolean> {
  const o = overall();
  if (offBoard()) return false;
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

function page(active: string): HTMLElement {
  closeGame();
  app.innerHTML = "";
  const nav = el("header", "nav");
  const inner = el("div", "nav-inner");
  const logo = link("#/", "logo", "");
  logo.innerHTML = `<span class="logo-short">MM</span><span class="logo-full">Musical Memory</span>`;
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
  const foot = el("footer", "foot");
  const fi = el("div", "foot-inner");
  fi.append(el("span", "", "Musical Memory"), link("#/terms", "", "Terms"), link("#/privacy", "", "Privacy"));
  foot.append(fi);
  app.append(nav, main, foot);
  window.scrollTo(0, 0);
  return main;
}

function tiles(): HTMLElement {
  const wrap = el("section", "tiles-wrap");
  const grid = el("div", "tiles");
  GAMES.forEach((g, i) => {
    const a = link(`#/${g.id}`, "tile", "");
    const lv = rankedLevel(progressOf(g));
    const t = tierOf(lv);
    const text = el("span", "tile-text");
    text.append(el("span", "tile-name", g.name), el("span", "tile-line", g.line));
    const rk = el("span", "tile-rank");
    rk.innerHTML = `${badge(t, 26)}<span></span>`;
    (rk.querySelector("span") as HTMLElement).textContent = lv ? `${t.name} · Lv ${lv}` : "Unranked";
    a.append(el("span", "tile-num", String(i + 1).padStart(2, "0")), text, rk, el("span", "tile-go", "Play"));
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
  if (!playerName()) {
    const pick = el("div", "name-pick");
    pick.append(el("div", "name-pick-label", "Choose your player name"));
    const nf2 = nameField(() => {
      syncAllSoon(200);
      setTimeout(() => pick.remove(), 900);
    });
    const row = el("div", "name-pick-row");
    row.append(nf2.input, btn("Save", "name-save", () => nf2.input.dispatchEvent(new Event("change"))));
    pick.append(row, nf2.msg);
    inner.append(pick);
  }
  inner.append(link("#/visual-memory", "band-btn", o.played ? "Keep climbing" : "Start ranked"));
  hero.append(inner);
  main.append(hero, tiles());
  const prevWrap = el("section", "panels one");
  const prev = el("div", "panel");
  prev.append(el("h2", "", "Top players"));
  const prevList = loadingBoard(5);
  prev.append(prevList, link("#/top", "panel-link", "Full leaderboard"));
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
  const nf = nameField(() => syncAllSoon(200));
  const nameCol = el("div", "name-col");
  nameCol.append(nf.input, nf.msg);
  nameRow.append(nameCol);
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
  topHead.append(el("h2", "", "Top players"));
  const topLinks = el("div", "panel-links");
  topLinks.append(link(`#/top?g=${game.id}&t=today`, "panel-link", "Today's Daily"), link(`#/top?g=${game.id}`, "panel-link", "Full board"));
  topHead.append(topLinks);
  const topList = loadingBoard(6);
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
      const hasEntry = !!bestEntry(progressOf(game));
      const ok = await syncGame(game);
      await syncOverall();
      const place = ok ? await myPlace({ game: game.id }) : null;
      const today = ok && r.mode === "daily" && r.counted ? await myPlace({ game: game.id, day: todayKey() }) : null;
      if (globalEl) {
        const parts: string[] = [];
        if (today && today.place) parts.push(`Today #${today.place} of ${today.total}`);
        if (place && place.place) parts.push(`All-time #${place.place} of ${place.total}`);
        let msg = "";
        if (parts.length) msg = parts.join(" · ");
        else if (offBoard()) msg = "You're off the leaderboard. You can rejoin on the Privacy page.";
        else if (!hasEntry) msg = "Reach level 1 to get on the leaderboard.";
        else if (!ok) msg = "Leaderboard offline: your score is saved on this device.";
        globalEl.textContent = msg;
      }
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
  if (rankUp) card.append(el("div", "ov-tier", `${tierOf(oldLevel).name} to ${t.name}`));
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
  const nf = nameField(() => syncAllSoon(200));
  const nameCol = el("div", "name-col");
  nameCol.append(nf.input, nf.msg);
  nameRow.append(nameCol);
  const note = el("div", "ov-share-note");
  const actions = el("div", "ov-actions");
  const save = btn("Save image", "ov-btn ghost", async () => {
    save.disabled = true;
    const was = save.textContent;
    save.textContent = "Making…";
    try {
      const blob = await makeCard({
        game: g.name,
        mode: r.mode === "daily" ? "Daily" : "Classic",
        headline,
        tier: t,
        level: r.level,
        score: fmt(r.score),
        place: (card.querySelector(".ov-global") as HTMLElement).textContent?.includes("#") ? (card.querySelector(".ov-global") as HTMLElement).textContent! : "",
        player: playerName(),
        vs: ch ? { name: ch.name, score: fmt(ch.score) } : null,
      });
      const how = await saveCard(blob, `musical-memory-${g.id}-${todayKey()}.png`);
      note.textContent = how === "shared" ? "Shared!" : "Image saved. Post it with your video!";
    } catch (e) {
      console.warn(e);
      note.textContent = "Couldn't make the image on this device.";
    }
    save.textContent = was;
    save.disabled = false;
  });
  actions.append(
    btn("Close", "ov-btn ghost", () => ov.remove()),
    save,
    btn(ch ? "Challenge back" : "Challenge a friend", "ov-btn primary", () => {
      nf.input.dispatchEvent(new Event("change"));
      if (!nameProblem(nf.input.value) || !nf.input.value.trim()) shareChallenge(g, r, note);
    }),
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
  const colors = [color, "#efe9df"];
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
    a.append(el("span", "", g.name));
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
  if (id === "terms" || id === "privacy") return showDoc(id);
  if (id === "top") {
    const qs = new URLSearchParams(q);
    return showLeaderboard(qs.get("g"), qs.get("t") === "today");
  }
  const game = GAMES.find((g) => g.id === id);
  if (game) showGame(game, parseChallenge(q));
  else showHome();
}

window.addEventListener("hashchange", route);
preloadPiano();
route();

// ---------------------------------------------------------------- terms and privacy
function showDoc(kind: "terms" | "privacy") {
  // Kept inside: route() runs before top-level consts further down are set.
  const REPO = "https://github.com/egsvi2508-debug/smartear-memory";
  const UPDATED = "22 November 2026";
  const my = ++token;
  const main = page(kind);
  document.title = `${kind === "terms" ? "Terms" : "Privacy"} · Musical Memory`;
  const head = el("section", "band small");
  const hi = el("div", "band-inner");
  hi.append(el("div", "eyebrow", `Last updated ${UPDATED}`), el("h1", "hero-title", kind === "terms" ? "Terms of use" : "Privacy"));
  head.append(hi);
  const wrap = el("section", "panels one");
  const doc = el("div", "panel doc");
  const h = (t: string) => doc.append(el("h2", "", t));
  const p = (t: string) => doc.append(el("p", "", t));
  const contact = () => {
    const para = el("p", "");
    para.append("Questions or requests: open an issue on the ");
    const a = link(`${REPO}/issues`, "", "project's GitHub page");
    a.target = "_blank";
    a.rel = "noopener";
    para.append(a, ".");
    doc.append(para);
  };
  if (kind === "terms") {
    p("Musical Memory is a free set of ear training games. By playing, you agree to these terms.");
    h("Playing fair");
    p("Play the games yourself. Don't use scripts, edit saved data, or run several identities to push scores up the leaderboard. Entries that look faked can be removed, and boards can be reset, without notice.");
    h("Player names");
    p("Pick a nickname. No hateful, sexual or insulting names, and don't pretend to be someone else. The app blocks common offensive words, and other names that break this rule can be changed or removed.");
    h("No warranty");
    p("The games are provided as they are, with no guarantee that they work without errors or that scores and leaderboards are kept forever. Use them at your own risk.");
    h("Credits");
    p("Piano sound: Salamander Grand Piano by Alexander Holm, under CC BY 3.0, served by the Tone.js project. Music notation drawn with VexFlow.");
    h("Changes");
    p("These terms can change. The date at the top shows the latest version.");
    contact();
  } else {
    p("Short version: no account, no email, no ads, no tracking. Your progress lives on your device. The leaderboard shows the nickname you pick and your scores.");
    h("On your device");
    p("Your progress, best scores, settings and nickname are kept in this browser's local storage. Nothing leaves your device for this. Clearing the site's data removes it.");
    h("On the leaderboard");
    p("When you finish a ranked run, the app signs you in anonymously with Google Firebase (no email or password) and saves your nickname, your best level and score in each game, your Daily results, your overall rating, and when they were last updated. Anyone can see these on the leaderboard.");
    p("Firebase is run by Google, which handles your IP address and basic device information to provide the service. See Google's Firebase privacy page for details.");
    h("Sounds");
    p("The piano samples load from the Tone.js website, which sees your IP address like any website you visit.");
    h("What we don't do");
    p("No ads, no analytics, no tracking cookies, and nothing is sold or shared for marketing.");
    h("Remove your scores");
    const off = offBoard();
    p(off ? "You're off the leaderboard. Your scores stay on this device only. You can rejoin at any time." : "This deletes your entries from every leaderboard (all games, overall, and the Daily boards of the last 60 days) and stops this device from posting new ones. Your progress on this device stays.");
    const note = el("p", "doc-note");
    const b = btn(off ? "Rejoin the leaderboard" : "Remove my scores", off ? "doc-btn" : "doc-btn danger", async () => {
      b.disabled = true;
      if (off) {
        setOffBoard(false);
        await Promise.all(GAMES.map(syncGame));
        await syncOverall();
        note.textContent = "You're back on the leaderboard.";
      } else {
        if (!confirm("Remove your scores from every leaderboard? This can't be undone, but you can rejoin later with the scores on this device.")) {
          b.disabled = false;
          return;
        }
        setOffBoard(true);
        const ok = await removeMe(GAMES.map((g) => g.id));
        note.textContent = ok ? "Done. Your scores are off the leaderboard." : "Couldn't reach the leaderboard. Try again when you're online.";
        if (!ok) setOffBoard(false);
      }
      setTimeout(() => my === token && showDoc("privacy"), 1400);
    });
    doc.append(b, note);
    contact();
  }
  wrap.append(doc);
  main.append(head, wrap);
}

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
/** A board showing placeholder rows until the real ones arrive. */
function loadingBoard(rows: number): HTMLElement {
  const b = el("div", "board");
  b.setAttribute("aria-busy", "true");
  b.setAttribute("aria-label", "Loading leaderboard");
  for (let i = 0; i < rows; i++) {
    const r = el("div", "skel-row");
    r.append(el("i", "skel s1"), el("i", "skel s2"), el("i", "skel s3"), el("i", "skel s4"));
    b.append(r);
  }
  return b;
}
function emptyBoard(box: HTMLElement, rows: unknown[] | null) {
  box.innerHTML = "";
  box.removeAttribute("aria-busy");
  if (rows === null) box.append(el("p", "empty", "The leaderboard can't be reached right now. Your scores are safe on this device."));
  else if (!rows.length) box.append(el("p", "empty", "No one on this board yet. Play a ranked run and take #1!"));
  return rows === null || !rows.length;
}
async function fillGame(box: HTMLElement, g: Game, n: number, day?: string) {
  const [rows, me] = await Promise.all([topGame(g.id, n, day), myUid()]);
  if (!box.isConnected || emptyBoard(box, rows)) return;
  (rows as Entry[]).forEach((e, i) => box.append(boardRow(i + 1, e.name, e.level, `Lv ${e.level} · ${fmt(e.score)}`, e.uid === me)));
}
async function fillOverall(box: HTMLElement, n: number) {
  const [rows, me] = await Promise.all([topOverall(n), myUid()]);
  if (!box.isConnected || emptyBoard(box, rows)) return;
  (rows as OverallEntry[]).forEach((e, i) => box.append(boardRow(i + 1, e.name, Math.floor(e.rating / 100 / GAMES.length), `${fmt(e.rating)} · ${e.games}/6`, e.uid === me)));
}

function showLeaderboard(gameId: string | null, todayOnly = false) {
  token++;
  const main = page("top");
  const game = GAMES.find((g) => g.id === gameId) || null;
  const day = game && todayOnly ? todayKey() : undefined;
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
  const when = el("div", "board-when");
  if (game) {
    const w = (label: string, today: boolean) => when.append(link(`#/top?g=${game.id}${today ? "&t=today" : ""}`, "when-btn" + (today === !!day ? " on" : ""), label));
    w("All time", false);
    w("Today's Daily", true);
  }

  const panels = el("section", "panels one");
  const panel = el("div", "panel");
  panel.append(tabs);
  if (game) panel.append(when);
  const head = el("div", "board-head");
  head.append(el("span", "", "#"), el("span", "", ""), el("span", "", "Player"), el("span", "", game ? "Level · score" : "Rating · games"));
  const list = loadingBoard(8);
  panel.append(head, list, el("p", "fine", day ? "Today's Daily puzzle: everyone gets the same one, and only your first attempt counts. A fresh board every day." : game ? "Each player's best Classic or Daily run. Ranked by level, then score." : "Rating = 100 points for every ranked level across all six games."));
  panels.append(panel);
  main.append(band, panels);
  document.title = "Leaderboard · Musical Memory";

  syncAllSoon(0);
  (game ? fillGame(list, game, 50, day) : fillOverall(list, 50)).then(async () => {
    const pl = await myPlace(game ? { game: game.id, day } : null);
    if (!place.isConnected) return;
    if (!pl) place.textContent = "Leaderboard offline right now.";
    else if (!pl.place) place.textContent = `${pl.total} player${pl.total === 1 ? "" : "s"} ranked${day ? " today" : ""}. ${day ? "Play today's Daily" : "Play a ranked run"} to join them.`;
    else place.textContent = `You're #${pl.place} of ${pl.total} as ${ensureName()}.`;
  });
}
