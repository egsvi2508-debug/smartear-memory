// stats.ts: your own numbers per game, kept on this device.
//   bestLevel  , highest level you cleared
//   bestStreak , most right answers in a row
//   rounds     , rounds played

export interface Stats {
  bestLevel: number;
  bestStreak: number;
  rounds: number;
}

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
export function playerName(): string {
  try {
    let n = localStorage.getItem(NAME_KEY);
    if (!n) {
      n = "Player" + String(Math.floor(1000 + Math.random() * 9000));
      localStorage.setItem(NAME_KEY, n);
    }
    return n;
  } catch {
    return "Player";
  }
}
export function setPlayerName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}
