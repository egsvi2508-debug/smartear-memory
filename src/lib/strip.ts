// strip.ts: the small stats + leaderboard panel under each game.

import { getStats, playerName, setPlayerName, recordRound, boardJoined, setBoardJoined, GAME_IDS } from "./stats";
import { nameProblem } from "./names";
import { listenWhileShown } from "./listen";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const board = () => import("./board");

// Board reads are cached a little, so restarting a round doesn't refetch.
type Top = Awaited<ReturnType<Awaited<ReturnType<typeof board>>["top"]>>;
const cache = new Map<string, { at: number; data: Top }>();
async function loadTop(game: string, fresh = false): Promise<Top> {
  const key = game + (boardJoined() ? ":me" : "");
  const c = cache.get(key);
  if (!fresh && c && Date.now() - c.at < 60_000) return c.data;
  const data = await (await board()).top(game, 5, boardJoined());
  if (data) cache.set(key, { at: Date.now(), data });
  return data;
}

/** Test browsers (navigator.webdriver) never write to the real board,
 *  unless a test asks to with localStorage "hears:boardTest". */
function automated(): boolean {
  try {
    return !!navigator.webdriver && !localStorage.getItem("hears:boardTest");
  } catch {
    return false;
  }
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** Send your bests to the board (a moment after they change). Only once you joined. */
export function pushBest(game: string, delay = 1200) {
  if (!boardJoined() || automated()) return;
  const s = getStats(game);
  if (!s.bestLevel && !s.bestStreak) return;
  clearTimeout(pending.get(game));
  pending.set(
    game,
    setTimeout(async () => {
      pending.delete(game);
      if (await (await board()).submit(game, playerName(), s.bestLevel, s.bestStreak)) {
        cache.clear();
        window.dispatchEvent(new CustomEvent("hears:board", { detail: { game } }));
      }
    }, delay),
  );
}

/** Called by a game when a level or round ends. */
export function noteRound(game: string, o: { cleared: number; streak: number; round: boolean }) {
  if (recordRound(game, o)) pushBest(game);
}

/** "Best Lv 12 · Best streak 34", or "" before the first round. */
export function bestLine(game: string): string {
  const s = getStats(game);
  return [s.bestLevel && `Best Lv ${s.bestLevel}`, s.bestStreak && `Best streak ${s.bestStreak}`].filter(Boolean).join(" · ");
}

export function statsStrip(game: string, title: string): HTMLElement {
  const box = el("section", "hx-strip");
  box.setAttribute("aria-label", "Your stats and top players");
  const nums = el("div", "hx-nums");
  const panel = el("div", "hx-board");
  const head = el("div", "hx-board-h");
  const share = el("button", "hx-share", "Share");
  share.type = "button";
  share.title = "Make an image of your best (for stories and reels)";
  head.append(el("span", "", "Top players"), share);
  const list = el("ol", "hx-list");
  const you = el("div", "hx-you");
  panel.append(head, list, you);
  box.append(nums, panel);

  const stat = (label: string, v: number | string) => {
    const d = el("div", "hx-num");
    d.append(el("span", "hx-v mono", String(v)), el("span", "hx-l", label));
    return d;
  };
  const drawNums = () => {
    const s = getStats(game);
    nums.replaceChildren(stat("Best level", s.bestLevel || "–"), stat("Best streak", s.bestStreak || "–"), stat("Rounds", s.rounds));
    share.hidden = !s.bestLevel && !s.bestStreak;
  };
  share.addEventListener("click", async () => {
    const s = getStats(game);
    const tint = getComputedStyle(box).getPropertyValue("--tint").trim() || "#ffd400";
    const { shareBest } = await import("./share");
    shareBest({ title, tint, level: s.bestLevel, streak: s.bestStreak });
  });

  /** Name field, used to join and to rename. Typing here never plays notes. */
  const nameForm = (label: string, onDone: (name: string) => void) => {
    const form = el("form", "hx-join");
    const inp = el("input", "hx-name-in");
    inp.value = playerName();
    inp.placeholder = "Your name";
    inp.maxLength = 20;
    inp.setAttribute("autocomplete", "nickname");
    inp.setAttribute("aria-label", "Your name on the board");
    const ok = el("button", "hx-join-btn", label);
    ok.type = "submit";
    const cancel = el("button", "hx-link", "Cancel");
    cancel.type = "button";
    const note = el("div", "hx-note");
    note.innerHTML = `Your name and best scores are public. <a href="#/privacy">Privacy</a>`;
    form.append(inp, ok, cancel, note);
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") drawYou();
    });
    cancel.addEventListener("click", () => drawYou());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const n = inp.value.replace(/\s+/g, " ").trim();
      const problem = nameProblem(n);
      if (problem) {
        note.textContent = problem;
        note.classList.add("bad");
        inp.focus();
        return;
      }
      onDone(n);
    });
    you.replaceChildren(form);
    inp.focus();
  };

  const drawYou = (place: number | null = null) => {
    if (!boardJoined()) {
      const join = el("button", "hx-join-btn", "Join the board");
      join.type = "button";
      join.addEventListener("click", () =>
        nameForm("Join", (n) => {
          setPlayerName(n);
          setBoardJoined(true);
          for (const g of GAME_IDS) pushBest(g, 0);
          drawYou();
        }),
      );
      you.replaceChildren(join, el("span", "hx-note", "Optional. Your bests stay on this device until you join."));
      return;
    }
    const nameBtn = el("button", "hx-name", playerName());
    nameBtn.type = "button";
    nameBtn.title = "Change your name";
    nameBtn.addEventListener("click", () =>
      nameForm("Save", (n) => {
        if (n !== playerName()) {
          setPlayerName(n);
          pushBest(game, 0);
        }
        drawYou(place);
      }),
    );
    you.replaceChildren(el("span", "hx-you-l", "You"), nameBtn);
    if (place) you.append(el("span", "hx-place mono", ord(place)));
  };

  let reqId = 0;
  const drawBoard = async (fresh: boolean) => {
    const my = ++reqId;
    if (!list.children.length) list.replaceChildren(el("li", "hx-empty", "Loading…"));
    const data = await loadTop(game, fresh).catch(() => null);
    if (my !== reqId || !box.isConnected) return;
    list.replaceChildren();
    if (!data) list.append(el("li", "hx-empty", "Offline"));
    else if (!data.rows.length) list.append(el("li", "hx-empty", "No one yet. Be first!"));
    else
      data.rows.forEach((r, i) => {
        const li = el("li", "hx-row" + (r.uid === data.me ? " me" : ""));
        li.append(el("span", "hx-pos mono", String(i + 1)), el("span", "hx-who", r.name), el("span", "hx-lv mono", r.level ? `Lv ${r.level}` : `×${r.streak}`));
        list.append(li);
      });
    if (!you.querySelector("form")) drawYou(data?.myPlace ?? null);
  };

  drawNums();
  drawYou();
  requestAnimationFrame(() => drawBoard(false)); // once it's on the page
  const on = (type: string, f: (e: Event) => void) => listenWhileShown(box, type, f);
  on("hears:stats", (e) => (e as CustomEvent).detail?.id === game && drawNums());
  on("hears:board", (e) => (e as CustomEvent).detail?.game === game && drawBoard(true));
  on("hears:joined", () => drawBoard(true));
  return box;
}
