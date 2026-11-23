// share.ts: a 9:16 image of your best in a game, for stories and reels.
// Shared through the phone's share sheet when it can take files; otherwise
// downloaded as a PNG.

const SITE = "egsvi2508-debug.github.io/smartear-memory";

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

export async function makeCard(o: { title: string; tint: string; level: number; streak: number }): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080, H = 1920;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  const ui = getComputedStyle(document.documentElement).getPropertyValue("--font-ui") || "system-ui, sans-serif";
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace";

  // background: deep blue, a glow in the game's colour
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101a44");
  bg.addColorStop(1, "#070b1d");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W / 2, 820, 40, W / 2, 820, 760);
  glow.addColorStop(0, o.tint + "55");
  glow.addColorStop(1, o.tint + "00");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  // Everything sits between y 270 and 1650: Instagram story bars cover the top and bottom ~250px.
  // brand, centred
  c.font = `800 64px ${ui}`;
  const bw = 142 + c.measureText("Human Ears").width;
  c.save();
  c.translate((W - bw) / 2 - 90, 150);
  const band = c.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, "#1f5bff");
  band.addColorStop(1, "#00c2ff");
  c.fillStyle = band;
  roundRect(c, 90, 150, 110, 110, 30);
  c.fill();
  c.strokeStyle = "#fff";
  c.lineWidth = 9;
  c.lineCap = "round";
  c.beginPath(); // a small beamed note
  c.moveTo(130, 232); c.lineTo(130, 180); c.lineTo(172, 172); c.lineTo(172, 222);
  c.stroke();
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(121, 232, 11, 0, 7); c.fill();
  c.beginPath(); c.arc(163, 222, 11, 0, 7); c.fill();
  c.font = `800 64px ${ui}`;
  c.textBaseline = "middle";
  c.fillText("Human Ears", 232, 208);
  c.restore();

  // the game
  c.textAlign = "center";
  c.fillStyle = o.tint;
  c.font = `800 92px ${ui}`;
  c.fillText(o.title, W / 2, 545);

  // the big number
  const main = o.level ? { v: `Lv ${o.level}`, l: "BEST LEVEL" } : { v: `${o.streak}`, l: "BEST STREAK" };
  c.fillStyle = "#ffffff";
  c.font = `800 ${main.v.length > 5 ? 250 : 300}px ${ui}`;
  c.fillText(main.v, W / 2, 875);
  c.fillStyle = "#9aa6d6";
  c.font = `700 44px ${mono}`;
  c.fillText(main.l, W / 2, 1025);

  if (o.level && o.streak) {
    c.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(c, 240, 1100, 600, 170, 40);
    c.fill();
    c.fillStyle = "#ffd400";
    c.font = `800 96px ${ui}`;
    c.fillText(String(o.streak), W / 2, 1170);
    c.fillStyle = "#9aa6d6";
    c.font = `700 32px ${mono}`;
    c.fillText("RIGHT IN A ROW", W / 2, 1240);
  }

  // call to action
  c.fillStyle = "#ffd400";
  roundRect(c, 190, 1390, 700, 120, 60);
  c.fill();
  c.fillStyle = "#0b1026";
  c.font = `800 52px ${ui}`;
  c.fillText("Can you beat it?", W / 2, 1452);
  c.fillStyle = "#9aa6d6";
  c.font = `400 34px ${mono}`;
  c.fillText(SITE, W / 2, 1590);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}

export async function shareBest(o: { title: string; tint: string; level: number; streak: number }) {
  const blob = await makeCard(o);
  const file = new File([blob], `human-ears-${o.title.toLowerCase().replace(/\W+/g, "-")}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Human Ears · ${o.title}` });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // closed the share sheet
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
