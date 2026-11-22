// card.ts, a portrait result image (1080×1350) to post or send. Drawn on a
// canvas with the app's own fonts, so it looks like the app.

import type { Tier } from "./rank";

export interface CardInfo {
  game: string;
  mode: string; // "Daily" | "Classic"
  headline: string; // "Rank up!", "New best!", …
  tier: Tier;
  level: number;
  score: string;
  place: string; // "Today #3 of 120 · All-time #18 of 940" (may be empty)
  player: string;
  vs?: { name: string; score: string } | null;
}

const W = 1080;
const H = 1350;
const DISPLAY = '"Fraunces Variable", Georgia, serif';
const MONO = '"Space Mono", ui-monospace, monospace';
const UI = '"Work Sans Variable", system-ui, sans-serif';

function hex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number) {
  let px = start;
  ctx.font = font(px);
  while (px > 20 && ctx.measureText(text).width > maxW) ctx.font = font((px -= 4));
  return px;
}

export async function makeCard(c: CardInfo): Promise<Blob> {
  await Promise.all(
    [`700 120px ${MONO}`, `400 40px ${MONO}`, `700 120px ${DISPLAY}`, `600 40px ${UI}`].map((f) => document.fonts.load(f).catch(() => [])),
  );
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;

  // flat page, thin rules, one accent colour
  ctx.fillStyle = "#141311";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#34312c";
  ctx.fillRect(80, 178, W - 160, 2);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ece7dd";
  ctx.font = `700 30px ${MONO}`;
  ctx.letterSpacing = "8px";
  ctx.fillText("MUSICAL MEMORY", W / 2, 96);
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#9d968a";
  ctx.font = `400 30px ${MONO}`;
  ctx.fillText(`${c.game} · ${c.mode}`.toUpperCase(), W / 2, 146);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = c.headline === "Defeat" ? "#cf5a43" : c.headline === "Victory" ? "#7fa356" : c.tier.name === "Unranked" ? "#ece7dd" : c.tier.color;
  fit(ctx, c.headline, (px) => `700 ${px}px ${DISPLAY}`, 128, W - 120);
  ctx.fillText(c.headline, W / 2, 312);

  // badge
  const cx = W / 2;
  const cy = 560;
  hex(ctx, cx, cy, 190);
  ctx.fillStyle = c.tier.color;
  ctx.fill();
  hex(ctx, cx, cy, 158);
  ctx.strokeStyle = c.tier.color2;
  ctx.lineWidth = 8;
  ctx.stroke();
  const letter = c.tier.name === "Unranked" ? "0" : c.tier.name === "Grandmaster" ? "GM" : c.tier.name[0];
  ctx.fillStyle = "#141210";
  ctx.font = `700 ${letter.length > 1 ? 110 : 140}px ${MONO}`;
  ctx.textBaseline = "middle";
  ctx.fillText(letter, cx, cy + 8);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = c.tier.color;
  ctx.font = `700 64px ${DISPLAY}`;
  ctx.fillText(c.tier.name, W / 2, 840);

  // numbers
  const box = (x: number, w: number, value: string, label: string) => {
    ctx.strokeStyle = "#34312c";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 891, w - 2, 188);
    ctx.fillStyle = "#ece7dd";
    fit(ctx, value, (px) => `700 ${px}px ${MONO}`, 92, w - 40);
    ctx.fillText(value, x + w / 2, 1000);
    ctx.fillStyle = "#9d968a";
    ctx.font = `600 30px ${UI}`;
    fit(ctx, label, (px) => `600 ${px}px ${UI}`, 30, w - 40);
    ctx.fillText(label, x + w / 2, 1050);
  };
  if (c.vs) {
    box(80, 445, c.score, c.player || "Me");
    box(555, 445, c.vs.score, c.vs.name);
  } else {
    box(80, 590, c.score, "Score");
    box(690, 310, String(c.level), "Level");
  }

  ctx.fillStyle = "#ece7dd";
  if (c.place) {
    fit(ctx, c.place, (px) => `600 ${px}px ${UI}`, 36, W - 120);
    ctx.fillText(c.place, W / 2, 1150);
  }
  ctx.fillStyle = "#9d968a";
  ctx.font = `600 34px ${UI}`;
  ctx.fillText(c.vs ? "Your turn. Can you beat us both?" : "Think you can beat me?", W / 2, 1222);
  ctx.fillStyle = "#d2491f";
  const host = (location.host + location.pathname).replace(/\/$/, "");
  fit(ctx, host, (px) => `700 ${px}px ${MONO}`, 32, W - 120);
  ctx.fillText(host, W / 2, 1282);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}

/** Share the image where the device can (phones), else download it. */
export async function saveCard(blob: Blob, filename: string): Promise<"shared" | "saved"> {
  const file = new File([blob], filename, { type: "image/png" });
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch {
      /* cancelled: download instead */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "saved";
}
