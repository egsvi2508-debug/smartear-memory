// rank.ts — competitive ranks. A game's rank comes from the highest level
// reached in a ranked run (Classic or Daily; Practice doesn't count).
// Overall rank comes from the average across all six games, so playing
// every game is how you climb.

export interface Tier {
  name: string;
  min: number; // level needed
  color: string;
  color2: string;
}

export const UNRANKED: Tier = { name: "Unranked", min: 0, color: "#4a4452", color2: "#2e2a35" };
export const TIERS: Tier[] = [
  { name: "Bronze", min: 1, color: "#e0915a", color2: "#8a4a22" },
  { name: "Silver", min: 3, color: "#dfe6ee", color2: "#7d8a99" },
  { name: "Gold", min: 5, color: "#ffd75e", color2: "#c58a12" },
  { name: "Platinum", min: 7, color: "#7ff0dc", color2: "#1f9c8c" },
  { name: "Diamond", min: 9, color: "#8ec5ff", color2: "#3462d9" },
  { name: "Master", min: 11, color: "#d9a6ff", color2: "#8a3fd1" },
  { name: "Grandmaster", min: 13, color: "#ff7a90", color2: "#c4123a" },
];

export function tierOf(level: number): Tier {
  let t = UNRANKED;
  for (const x of TIERS) if (level >= x.min) t = x;
  return t;
}
export function tierIndex(level: number): number {
  return TIERS.indexOf(tierOf(level));
}
/** The next tier and how many levels it needs, or null at the top. */
export function nextTier(level: number): { tier: Tier; need: number } | null {
  const n = TIERS.find((x) => x.min > level);
  return n ? { tier: n, need: n.min - level } : null;
}
/** 0–1 progress from this tier's floor to the next tier's floor. */
export function tierProgress(level: number): number {
  const t = tierOf(level);
  const n = nextTier(level);
  if (!n) return 1;
  const lo = t === UNRANKED ? 0 : t.min;
  return Math.max(0, Math.min(1, (level - lo) / (n.tier.min - lo)));
}

/** A hexagonal badge. `size` in px. */
export function badge(t: Tier, size = 48, label?: string): string {
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  const letter = label ?? (t === UNRANKED ? "–" : t.name === "Grandmaster" ? "GM" : t.name[0]);
  return `<svg class="badge" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${t.name}">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.color}"/><stop offset="1" stop-color="${t.color2}"/></linearGradient></defs>
  <path d="M24 2 43 13v22L24 46 5 35V13z" fill="url(#${id})"/>
  <path d="M24 7 38.5 15.5v17L24 41 9.5 32.5v-17z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/>
  <text x="24" y="29.5" text-anchor="middle" font-family="Space Mono, monospace" font-weight="700" font-size="${letter.length > 1 ? 13 : 16}" fill="#1a1020">${letter}</text>
</svg>`;
}
