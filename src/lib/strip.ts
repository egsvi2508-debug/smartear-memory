// strip.ts: the small stats + leaderboard panel under each game.

import { getStats, playerName, setPlayerName, recordRound } from "./stats";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const ord = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${s}`;
};

// Board reads are cached a little, so restarting a round doesn't refetch.
type Top = Awaited<ReturnType<typeof import("./board").top>>;
const cache = new Map<string, { at: number; data: Top }>();
async function loadTop(game: string, fresh = false): Promise<Top> {
  const c = cache.get(game);
  if (!fresh && c && Date.now() - c.at < 60_000) return c.data;
  const { top } = await import("./board");
  const data = await top(game, 5);
  if (data) cache.set(game, { at: Date.now(), data });
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
/** Send your bests to the board (a moment after they change). */
export function pushBest(game: string, delay = 1200) {
  if (automated()) return;
  const s = getStats(game);
  if (!s.bestLevel && !s.bestStreak) return;
  clearTimeout(pending.get(game));
  pending.set(
    game,
    setTimeout(async () => {
      pending.delete(game);
      const { submit } = await import("./board");
      if (await submit(game, playerName(), s.bestLevel, s.bestStreak)) {
        cache.delete(game);
        window.dispatchEvent(new CustomEvent("hears:board", { detail: { game } }));
      }
    }, delay),
  );
}

/** Called by a game when a round ends or a level is cleared. */
export function noteRound(game: string, o: { cleared: number; streak: number; round: boolean }) {
  if (recordRound(game, o)) pushBest(game);
}

/** "Best Lv 12 · Streak 34", or "" before the first round. */
export function bestLine(game: string): string {
  const s = getStats(game);
  const parts = [];
  if (s.bestLevel) parts.push(`Best Lv ${s.bestLevel}`);
  if (s.bestStreak) parts.push(`Best streak ${s.bestStreak}`);
  return parts.join(" · ");
}

export function statsStrip(game: string): HTMLElement {
  const box = el("section", "hx-strip");
  const nums = el("div", "hx-nums");
  const board = el("div", "hx-board");
  const head = el("div", "hx-board-h");
  head.append(el("span", "", "Top players"));
  const list = el("ol", "hx-list");
  const you = el("div", "hx-you");
  board.append(head, list, you);
  box.append(nums, board);

  const stat = (label: string, v: number | string) => {
    const d = el("div", "hx-num");
    d.append(el("span", "hx-v mono", String(v)), el("span", "hx-l", label));
    return d;
  };
  const drawNums = () => {
    const s = getStats(game);
    nums.replaceChildren(stat("Best level", s.bestLevel || "–"), stat("Best streak", s.bestStreak || "–"), stat("Rounds", s.rounds));
  };

  const nameBtn = () => {
    const b = el("button", "hx-name", playerName());
    b.type = "button";
    b.title = "Change your name";
    b.addEventListener("click", () => {
      const inp = el("input", "hx-name-in");
      inp.value = playerName();
      inp.maxLength = 20;
      inp.setAttribute("aria-label", "Your name");
      const save = async () => {
        const { cleanName } = await import("./board");
        const n = cleanName(inp.value);
        if (n && n !== playerName()) {
          setPlayerName(n);
          pushBest(game, 0);
        }
        drawBoard(false);
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation(); // typing a name must not play notes
        if (e.key === "Enter") inp.blur();
        if (e.key === "Escape") (inp.value = playerName()), inp.blur();
      });
      inp.addEventListener("blur", save, { once: true });
      b.replaceWith(inp);
      inp.focus();
      inp.select();
    });
    return b;
  };

  let reqId = 0;
  const drawBoard = async (fresh: boolean) => {
    const my = ++reqId;
    if (!list.children.length) list.replaceChildren(el("li", "hx-empty", "Loading…"));
    const data = await loadTop(game, fresh).catch(() => null);
    if (my !== reqId || !box.isConnected) return;
    list.replaceChildren();
    if (!data) {
      list.append(el("li", "hx-empty", "Offline"));
    } else if (!data.rows.length) {
      list.append(el("li", "hx-empty", "No one yet. Be first!"));
    } else {
      data.rows.forEach((r, i) => {
        const li = el("li", "hx-row" + (r.uid === data.me ? " me" : ""));
        li.append(el("span", "hx-pos mono", String(i + 1)), el("span", "hx-who", r.name), el("span", "hx-lv mono", r.level ? `Lv ${r.level}` : `×${r.streak}`));
        list.append(li);
      });
    }
    you.replaceChildren(el("span", "hx-you-l", "You"), nameBtn());
    if (data?.myPlace) you.append(el("span", "hx-place mono", ord(data.myPlace)));
  };

  drawNums();
  // Wait until it's on the page before asking the board.
  requestAnimationFrame(() => drawBoard(false));
  const onStats = (e: Event) => {
    if (!box.isConnected) return window.removeEventListener("hears:stats", onStats);
    if ((e as CustomEvent).detail?.id === game) drawNums();
  };
  const onBoard = (e: Event) => {
    if (!box.isConnected) return window.removeEventListener("hears:board", onBoard);
    if ((e as CustomEvent).detail?.game === game) drawBoard(true);
  };
  window.addEventListener("hears:stats", onStats);
  window.addEventListener("hears:board", onBoard);
  return box;
}
