// stats.ts: your own numbers per game, kept on this device.
//   bestLevel  , highest level you cleared
//   bestStreak , most right answers in a row
//   rounds     , rounds played

interface Stats {
  bestLevel: number;
  bestStreak: number;
  rounds: number;
}

export const GAME_IDS = ["note-rush", "interval-rush", "visual-memory", "sequence-memory", "pairs-memory", "hold-memory", "memory", "relative-memory"];

const key = (id: string) => `hears:stats:${id}`;

export function getStats(id: string): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(key(id)) || "{}");
    return { bestLevel: Number(s.bestLevel) || 0, bestStreak: Number(s.bestStreak) || 0, rounds: Number(s.rounds) || 0 };
  } catch {
    return { bestLevel: 0, bestStreak: 0, rounds: 0 };
  }
}

/** Count a round. Returns true when a best went up. */
export function recordRound(id: string, o: { cleared: number; streak: number; round: boolean }): boolean {
  const s = getStats(id);
  let better = false;
  if (o.cleared > s.bestLevel) (s.bestLevel = o.cleared), (better = true);
  if (o.streak > s.bestStreak) (s.bestStreak = o.streak), (better = true);
  if (o.round) s.rounds++;
  try {
    localStorage.setItem(key(id), JSON.stringify(s));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("hears:stats", { detail: { id, better } }));
  return better;
}

const NAME_KEY = "hears:name";
const JOIN_KEY = "hears:board";

function get(k: string): string {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function put(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Your public leaderboard name ("" until you join). */
export const playerName = () => get(NAME_KEY);
export const setPlayerName = (n: string) => put(NAME_KEY, n);
/** Did you choose to be on the leaderboards? */
export const boardJoined = () => get(JOIN_KEY) === "on";
export function setBoardJoined(on: boolean) {
  put(JOIN_KEY, on ? "on" : null);
  window.dispatchEvent(new Event("hears:joined"));
}

/** Wipe everything this site keeps in this browser. */
export function clearLocalData() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("hears:") || k.startsWith("smem:") || k.startsWith("smartear_"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
