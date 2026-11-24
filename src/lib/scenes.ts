// scenes.ts: the animated backgrounds behind the exercises. Six scenes, each
// with its own sound (see music.ts): beach, forest, rainy city, snowy peaks,
// desert, deep space. Pure SVG + CSS, drawn here, nothing to download.

export type SceneId = "beach" | "forest" | "city" | "snow" | "desert" | "space";

const KEY = "smem:scene";

// A fixed random sequence, so a scene looks the same every time.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const svg = (defs: string, body: string) =>
  `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
const grad = (id: string, stops: [number, string, number?][], vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`)
    .join("")}</linearGradient>`;
const glow = (id: string, c: string, a: number) =>
  `<radialGradient id="${id}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;

function stars(seed: number, n: number, maxY: number, cls = "") {
  const r = rng(seed);
  let out = `<g class="${cls}" fill="#fff">`;
  for (let i = 0; i < n; i++) out += `<circle cx="${(r() * 1440).toFixed(0)}" cy="${(r() * maxY).toFixed(0)}" r="${(0.6 + r() * 1.3).toFixed(1)}" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
  return out + "</g>";
}

/** A pine: three stacked triangles on a trunk. */
function pine(x: number, base: number, h: number, fill: string) {
  const w = h * 0.42;
  let d = `M${x - w * 0.12} ${base} h${w * 0.24} v${-h * 0.12} h${-w * 0.24} Z`;
  for (let k = 0; k < 3; k++) {
    const top = base - h + k * h * 0.22;
    const bot = base - h * 0.1 - (2 - k) * h * 0.2;
    const ww = w * (0.55 + k * 0.25);
    d += `M${x} ${top} L${x + ww / 2} ${bot} L${x - ww / 2} ${bot} Z`;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}
function pineRow(seed: number, base: number, hMin: number, hMax: number, step: number, fill: string, cls = "") {
  const r = rng(seed);
  let out = `<g class="${cls}">`;
  for (let x = -20; x < 1480; x += step * (0.7 + r() * 0.6)) out += pine(x, base + r() * 14, hMin + r() * (hMax - hMin), fill);
  return out + "</g>";
}

/** Things that fall (rain, snow): drawn twice, one screen apart, so the loop is seamless. */
function falling(seed: number, n: number, draw: (x: number, y: number, r: () => number) => string, cls: string) {
  const r = rng(seed);
  let one = "";
  for (let i = 0; i < n; i++) one += draw(r() * 1700 - 130, r() * 900, r);
  return `<g class="${cls}"><g>${one}</g><g transform="translate(0 -900)">${one}</g></g>`;
}

// ---------------------------------------------------------------- the scenes
const BEACH = svg(
  grad("bh-sky", [[0, "#0b1026"], [0.45, "#2a2f7a"], [0.75, "#c8507a"], [1, "#ffab5e"]]) +
    `<radialGradient id="bh-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3b0"/><stop offset=".6" stop-color="#ffd166"/><stop offset="1" stop-color="#ff9f43"/></radialGradient>` +
    glow("bh-glow", "#ffcf70", 0.55) +
    grad("bh-sea", [[0, "#3a3f8f"], [0.4, "#1e4f8f"], [1, "#0f6f8c"]]) +
    grad("bh-sand", [[0, "#e8b97a"], [1, "#c98f55"]]),
  `<rect width="1440" height="560" fill="url(#bh-sky)"/>${stars(3, 6, 240)}
  <circle cx="720" cy="540" r="330" fill="url(#bh-glow)"/>
  <circle class="bh-sun" cx="720" cy="540" r="120" fill="url(#bh-sun)"/>
  <rect y="540" width="1440" height="360" fill="url(#bh-sea)"/>
  <g class="bh-glint" fill="#ffd98a">
    <rect x="640" y="560" width="160" height="5" rx="2.5" opacity=".75"/><rect x="665" y="585" width="110" height="4" rx="2" opacity=".6"/>
    <rect x="690" y="610" width="60" height="4" rx="2" opacity=".5"/><rect x="700" y="634" width="40" height="3" rx="1.5" opacity=".4"/>
  </g>
  <g class="bh-swell bh-s1" fill="none" stroke="#9fd8ff" stroke-width="3" stroke-linecap="round" opacity=".35">
    <path d="M-200 600 q60 -10 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0"/>
  </g>
  <g class="bh-swell bh-s2" fill="none" stroke="#bfe7ff" stroke-width="4" stroke-linecap="round" opacity=".4">
    <path d="M-200 660 q80 -14 160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0"/>
  </g>
  <path d="M0 760 C 240 730 480 770 720 752 S 1200 730 1440 756 V900 H0 Z" fill="url(#bh-sand)"/>
  <g class="bh-wash">
    <path d="M0 742 C 240 712 480 752 720 734 S 1200 712 1440 738 V770 C 1200 744 960 766 720 760 S 240 744 0 772 Z" fill="#7fd3e6" opacity=".55"/>
    <path d="M0 742 C 240 712 480 752 720 734 S 1200 712 1440 738" fill="none" stroke="#f4fbff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
  </g>`,
);

function forest() {
  const r = rng(11);
  let motes = "";
  for (let i = 0; i < 26; i++) motes += `<circle cx="${(r() * 1440).toFixed(0)}" cy="${(420 + r() * 380).toFixed(0)}" r="${(1.5 + r() * 2.2).toFixed(1)}" style="animation-delay:-${(r() * 6).toFixed(1)}s"/>`;
  return svg(
    grad("fo-sky", [[0, "#12203f"], [0.45, "#2f5d6e"], [0.8, "#d99a5b"], [1, "#f4c27a"]]) +
      glow("fo-glow", "#ffd88a", 0.7) +
      grad("fo-mist", [[0, "#fff", 0], [0.5, "#fff", 0.22], [1, "#fff", 0]]) +
      grad("fo-ray", [[0, "#ffe7b0", 0.35], [1, "#ffe7b0", 0]]),
    `<rect width="1440" height="900" fill="url(#fo-sky)"/>
    <circle cx="1040" cy="470" r="360" fill="url(#fo-glow)"/>
    <circle cx="1040" cy="470" r="70" fill="#ffe3a0"/>
    <g class="fo-rays" fill="url(#fo-ray)">
      <path d="M1040 470 L620 900 L760 900 Z"/><path d="M1040 470 L880 900 L960 900 Z"/><path d="M1040 470 L1120 900 L1230 900 Z"/><path d="M1040 470 L1360 900 L1440 860 Z"/>
    </g>
    <path d="M0 520 C 200 460 380 500 560 470 S 900 430 1100 480 S 1340 450 1440 470 V900 H0 Z" fill="#3c6a6a" opacity=".75"/>
    ${pineRow(5, 600, 170, 260, 70, "#2a4f50")}
    <rect class="fo-mist" x="-400" y="560" width="2240" height="140" fill="url(#fo-mist)"/>
    ${pineRow(7, 720, 220, 330, 95, "#183a33")}
    <g class="fo-birds" fill="none" stroke="#1b2a33" stroke-width="3" stroke-linecap="round">
      <path d="M0 0 q10 -8 20 0 q10 -8 20 0"/><path d="M60 -26 q8 -6 16 0 q8 -6 16 0"/><path d="M40 30 q7 -5 14 0 q7 -5 14 0"/>
    </g>
    <path d="M0 800 C 300 770 600 810 900 790 S 1300 780 1440 800 V900 H0 Z" fill="#0c2219"/>
    ${pineRow(9, 860, 300, 420, 260, "#0c2219", "fo-sway")}
    <g class="fo-motes" fill="#ffe9a8">${motes}</g>`,
  );
}

function city() {
  const r = rng(21);
  const block = (x0: number, base: number, hMin: number, hMax: number, fill: string, lit: number, cls: string) => {
    let out = "";
    for (let x = x0; x < 1480; ) {
      const w = 70 + r() * 90;
      const h = hMin + r() * (hMax - hMin);
      out += `<rect x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${fill}"/>`;
      for (let wy = base - h + 16; wy < base - 20; wy += 22)
        for (let wx = x + 10; wx < x + w - 14; wx += 18)
          if (r() < lit) out += `<rect class="${r() < 0.08 ? cls : ""}" x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="11" fill="${r() < 0.8 ? "#ffd27a" : "#9fe3ff"}" opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
      x += w + 4 + r() * 16;
    }
    return out;
  };
  return svg(
    grad("ct-sky", [[0, "#05071a"], [0.55, "#1a1c48"], [1, "#4a2a62"]]) +
      grad("ct-street", [[0, "#151634"], [1, "#07081a"]]) +
      glow("ct-pink", "#ff4fd8", 0.5) +
      glow("ct-cyan", "#3fe0ff", 0.45) +
      `<filter id="ct-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>`,
    `<rect width="1440" height="900" fill="url(#ct-sky)"/>
    <g opacity=".35" fill="#2c2d5c"><ellipse cx="300" cy="140" rx="380" ry="70"/><ellipse cx="1100" cy="90" rx="460" ry="80"/><ellipse cx="760" cy="220" rx="300" ry="50"/></g>
    <g>${block(-30, 690, 220, 420, "#161a3f", 0.22, "ct-blink")}</g>
    <g>${block(-60, 770, 160, 330, "#0c0f2c", 0.3, "ct-blink")}</g>
    <g class="ct-neon">
      <rect x="205" y="560" width="150" height="46" rx="12" fill="none" stroke="#ff4fd8" stroke-width="6" filter="url(#ct-blur)"/>
      <rect x="205" y="560" width="150" height="46" rx="12" fill="none" stroke="#ffc2f3" stroke-width="3"/>
      <rect x="1060" y="600" width="46" height="120" rx="10" fill="none" stroke="#3fe0ff" stroke-width="6" filter="url(#ct-blur)"/>
      <rect x="1060" y="600" width="46" height="120" rx="10" fill="none" stroke="#c9f6ff" stroke-width="3"/>
    </g>
    <rect y="770" width="1440" height="130" fill="url(#ct-street)"/>
    <g class="ct-reflect">
      <ellipse cx="280" cy="830" rx="120" ry="40" fill="url(#ct-pink)"/><ellipse cx="1083" cy="840" rx="70" ry="50" fill="url(#ct-cyan)"/>
      <ellipse cx="700" cy="850" rx="260" ry="26" fill="url(#ct-cyan)" opacity=".4"/>
    </g>
    ${falling(23, 150, (x, y, rr) => `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 7).toFixed(0)}" y2="${(y + 26 + rr() * 16).toFixed(0)}"/>`, "ct-rain")}`,
  );
}

/** A ridge (x, y points) as a filled range, with snow caps that follow each peak. */
function range(pts: [number, number][], fill: string, cap: string) {
  let d = `M0 900 L${pts.map((p) => p.join(" ")).join(" L")} L1440 900 Z`;
  let caps = "";
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    if (y >= pts[i - 1][1] || y >= pts[i + 1][1]) continue; // not a peak
    const at = (q: [number, number], f: number) => [x + (q[0] - x) * f, y + (q[1] - y) * f];
    const [lx, ly] = at(pts[i - 1], 0.3);
    const [rx, ry] = at(pts[i + 1], 0.3);
    const [mx1, my1] = at(pts[i - 1], 0.16);
    const [mx2, my2] = at(pts[i + 1], 0.2);
    caps += `M${x} ${y} L${rx.toFixed(0)} ${ry.toFixed(0)} L${(mx2 - 6).toFixed(0)} ${(my2 + 10).toFixed(0)} L${((x + mx2) / 2).toFixed(0)} ${(my2 + 2).toFixed(0)} L${(x - 4).toFixed(0)} ${(my1 + 12).toFixed(0)} L${(mx1 + 4).toFixed(0)} ${(my1 + 6).toFixed(0)} L${lx.toFixed(0)} ${ly.toFixed(0)} Z`;
  }
  return `<path d="${d}" fill="${fill}"/><path d="${caps}" fill="${cap}"/>`;
}

function snow() {
  const flake = (x: number, y: number, r: () => number) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1.2 + r() * 2.6).toFixed(1)}" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
  return svg(
    grad("sn-sky", [[0, "#040818"], [0.5, "#0e2546"], [1, "#2b5878"]]) +
      grad("sn-aur", [[0, "#3dffb0", 0], [0.3, "#3dffb0", 0.55], [0.7, "#4fd2ff", 0.4], [1, "#a77bff", 0]], false) +
      grad("sn-ground", [[0, "#eef4fb"], [1, "#b7c8de"]]) +
      `<filter id="sn-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>`,
    `<rect width="1440" height="900" fill="url(#sn-sky)"/>
    ${stars(31, 60, 420, "sn-tw")}
    <g class="sn-aurora" filter="url(#sn-blur)" fill="none" stroke="url(#sn-aur)" stroke-linecap="round">
      <path d="M-100 260 C 200 140 420 300 720 190 S 1200 120 1540 230" stroke-width="70"/>
      <path d="M-100 330 C 260 250 520 360 820 270 S 1260 230 1540 300" stroke-width="40" opacity=".7"/>
    </g>
    ${range([[0, 600], [180, 430], [300, 520], [470, 360], [640, 540], [800, 420], [980, 560], [1150, 400], [1300, 520], [1440, 450]], "#2c4b70", "#e3edf8")}
    ${range([[0, 690], [220, 560], [380, 650], [560, 540], [760, 680], [940, 580], [1120, 690], [1290, 590], [1440, 660]], "#1c3556", "#d3e1f0")}
    ${pineRow(33, 770, 120, 190, 60, "#0b1d33")}
    <path d="M0 770 C 260 740 520 790 780 762 S 1240 750 1440 772 V900 H0 Z" fill="url(#sn-ground)"/>
    <g class="sn-sway">${falling(35, 110, flake, "sn-fall sn-f1")}${falling(37, 60, flake, "sn-fall sn-f2")}</g>`,
  );
}

function desert() {
  const cactus = (x: number, base: number, s: number) =>
    `<path transform="translate(${x} ${base}) scale(${s})" d="M-9 0 V-120 a9 9 0 0 1 18 0 V0 Z M-9 -60 h-22 a8 8 0 0 1 -8 -8 v-34 a8 8 0 0 1 16 0 v26 h14 Z M9 -46 h22 a8 8 0 0 0 8 -8 v-30 a8 8 0 0 0 -16 0 v22 h-14 Z" fill="#2a1024"/>`;
  return svg(
    grad("de-sky", [[0, "#150d33"], [0.4, "#4d2466"], [0.72, "#d8643f"], [1, "#f6b45c"]]) +
      glow("de-glow", "#ffb46a", 0.6) +
      grad("de-tail", [[0, "#fff", 0], [1, "#fff", 0.9]], false),
    `<rect width="1440" height="900" fill="url(#de-sky)"/>
    ${stars(41, 40, 300, "de-tw")}
    <g class="de-shoot"><line x1="0" y1="0" x2="160" y2="0" stroke="url(#de-tail)" stroke-width="3" stroke-linecap="round"/></g>
    <circle cx="460" cy="600" r="380" fill="url(#de-glow)"/>
    <circle class="de-sun" cx="460" cy="610" r="130" fill="#ffd07a"/>
    <path d="M0 600 H120 L150 560 H300 L330 600 H760 L790 540 H1010 L1050 600 H1440 V900 H0 Z" fill="#6a2c52"/>
    <path d="M0 660 C 260 600 520 650 760 620 S 1180 600 1440 650 V900 H0 Z" fill="#a9493f"/>
    <g class="de-dust" stroke="#ffd6a0" stroke-width="2" stroke-linecap="round" opacity=".35"><line x1="100" y1="700" x2="190" y2="700"/><line x1="520" y1="740" x2="580" y2="740"/><line x1="900" y1="690" x2="1010" y2="690"/><line x1="1250" y1="760" x2="1320" y2="760"/></g>
    <path d="M0 740 C 300 690 560 760 860 720 S 1260 700 1440 740 V900 H0 Z" fill="#7e3138"/>
    <path d="M0 820 C 340 780 700 840 1000 800 S 1340 790 1440 812 V900 H0 Z" fill="#4a1a2e"/>
    ${cactus(1120, 790, 1.1)}${cactus(1290, 805, 0.7)}${cactus(180, 825, 0.85)}`,
  );
}

function space() {
  const r = rng(51);
  let craters = "";
  for (let i = 0; i < 9; i++) craters += `<ellipse cx="${(r() * 1440).toFixed(0)}" cy="${(800 + r() * 80).toFixed(0)}" rx="${(20 + r() * 50).toFixed(0)}" ry="${(6 + r() * 12).toFixed(0)}" fill="#0f0b22" opacity=".8"/>`;
  return svg(
    glow("sp-n1", "#8a3ad6", 0.55) +
      glow("sp-n2", "#1fa6c9", 0.45) +
      glow("sp-n3", "#ff4f9a", 0.35) +
      `<radialGradient id="sp-planet" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffc58a"/><stop offset=".5" stop-color="#d0607a"/><stop offset="1" stop-color="#3a1a5e"/></radialGradient>` +
      grad("sp-ground", [[0, "#2a2048"], [1, "#120d26"]]) +
      grad("sp-tail", [[0, "#9fe8ff", 0], [1, "#e9fbff", 1]], false),
    `<rect width="1440" height="900" fill="#03030f"/>
    <g class="sp-neb"><circle cx="360" cy="260" r="420" fill="url(#sp-n1)"/><circle cx="1100" cy="520" r="380" fill="url(#sp-n2)"/><circle cx="760" cy="120" r="300" fill="url(#sp-n3)"/></g>
    ${stars(53, 90, 820, "sp-tw1")}${stars(57, 50, 820, "sp-tw2")}
    <g class="sp-comet"><line x1="0" y1="0" x2="200" y2="0" stroke="url(#sp-tail)" stroke-width="3" stroke-linecap="round"/><circle cx="200" cy="0" r="4" fill="#fff"/></g>
    <g transform="rotate(-14 1060 330)">
      <path d="M800 330 A260 56 0 0 1 1320 330" fill="none" stroke="#f3c9a0" stroke-width="10" opacity=".55"/>
      <circle cx="1060" cy="330" r="150" fill="url(#sp-planet)"/>
      <path d="M800 330 A260 56 0 0 0 1320 330" fill="none" stroke="#ffe0bd" stroke-width="10" opacity=".8"/>
    </g>
    <g class="sp-orbit"><circle cx="1290" cy="200" r="16" fill="#cfd6ff"/></g>
    <path d="M0 790 C 300 750 700 770 1000 760 S 1340 770 1440 780 V900 H0 Z" fill="url(#sp-ground)"/>
    ${craters}`,
  );
}

export const SCENES: { id: SceneId; name: string; swatch: string; draw: () => string }[] = [
  { id: "beach", name: "Beach", swatch: "linear-gradient(180deg,#2a2f7a,#c8507a 55%,#1e4f8f 56%,#e8b97a)", draw: () => BEACH },
  { id: "forest", name: "Forest", swatch: "linear-gradient(180deg,#2f5d6e,#d99a5b 55%,#183a33 56%,#0c2219)", draw: forest },
  { id: "city", name: "Rainy city", swatch: "linear-gradient(180deg,#05071a,#4a2a62 55%,#161a3f 56%,#07081a)", draw: city },
  { id: "snow", name: "Snowy peaks", swatch: "linear-gradient(180deg,#040818,#3dffb0 30%,#2c4b70 56%,#eef4fb)", draw: snow },
  { id: "desert", name: "Desert", swatch: "linear-gradient(180deg,#4d2466,#d8643f 50%,#a9493f 60%,#4a1a2e)", draw: desert },
  { id: "space", name: "Deep space", swatch: "radial-gradient(circle at 70% 35%,#d0607a 0 18%,transparent 19%),linear-gradient(180deg,#03030f,#3a1a6e 70%,#2a2048 71%)", draw: space },
];

function read(): SceneId {
  try {
    const v = localStorage.getItem(KEY);
    if (SCENES.some((s) => s.id === v)) return v as SceneId;
  } catch {
    /* ignore */
  }
  return "beach";
}
let current: SceneId = read();
const listeners = new Set<() => void>();
const cache = new Map<SceneId, string>();

export function sceneId(): SceneId {
  return current;
}
export function sceneName(id: SceneId = current): string {
  return SCENES.find((s) => s.id === id)!.name;
}
export function onSceneChange(f: () => void) {
  listeners.add(f);
}
export function setScene(id: SceneId) {
  if (id === current) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  const host = document.querySelector<HTMLElement>(".scene-bg");
  if (host) paint(host);
  listeners.forEach((f) => f());
}

function paint(host: HTMLElement) {
  if (!cache.has(current)) cache.set(current, SCENES.find((s) => s.id === current)!.draw());
  host.dataset.scene = current;
  host.innerHTML = cache.get(current)!;
}

/** Put the chosen scene behind the page (once). */
export function showScene(app: HTMLElement) {
  if (app.querySelector(":scope > .scene-bg")) return;
  const d = document.createElement("div");
  d.className = "scene-bg";
  paint(d);
  app.append(d);
}
