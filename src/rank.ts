// rank.ts, competitive ranks. A game's rank comes from the highest level
// reached in a ranked run (Classic or Daily; Practice doesn't count).
// Overall rank comes from the average across all six games, so playing
// every game is how you climb.

export interface Tier {
  name: string;
  min: number; // level needed
  color: string;
  color2: string;
}

export const UNRANKED: Tier = { name: "Unranked", min: 0, color: "#7a746b", color2: "#45413b" };
// Muted metal and stone colours: flat fills, no neon, no pastel.
export const TIERS: Tier[] = [
  { name: "Bronze", min: 1, color: "#a8693a", color2: "#5e3a1f" },
  { name: "Silver", min: 3, color: "#a9adb1", color2: "#5d6166" },
  { name: "Gold", min: 5, color: "#c79a2b", color2: "#6f5414" },
  { name: "Platinum", min: 7, color: "#8fa39c", color2: "#4a5c56" },
  { name: "Diamond", min: 9, color: "#5d87b3", color2: "#2c4866" },
  { name: "Master", min: 11, color: "#3f8466", color2: "#1e4636" },
  { name: "Grandmaster", min: 13, color: "#b8432f", color2: "#5f1f14" },
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

/** A hexagonal badge: one flat fill and a darker inner outline. `size` in px. */
export function badge(t: Tier, size = 48, label?: string): string {
  const letter = label ?? (t === UNRANKED ? "0" : t.name === "Grandmaster" ? "GM" : t.name[0]);
  return `<svg class="badge" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${t.name}">
  <path d="M24 2 43 13v22L24 46 5 35V13z" fill="${t.color}"/>
  <path d="M24 7 38.5 15.5v17L24 41 9.5 32.5v-17z" fill="none" stroke="${t.color2}" stroke-width="2"/>
  <text x="24" y="29.5" text-anchor="middle" font-family="Space Mono, monospace" font-weight="700" font-size="${letter.length > 1 ? 13 : 16}" fill="#141210">${letter}</text>
</svg>`;
}
