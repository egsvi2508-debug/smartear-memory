// beach.ts: the animated beach behind the exercises (sunset sky, sun, sea,
// rolling foam, sand). Pure SVG + CSS, nothing to download.

const SCENE = `
<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="bh-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1026"/><stop offset=".45" stop-color="#2a2f7a"/>
      <stop offset=".75" stop-color="#c8507a"/><stop offset="1" stop-color="#ffab5e"/>
    </linearGradient>
    <radialGradient id="bh-sun" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff3b0"/><stop offset=".6" stop-color="#ffd166"/><stop offset="1" stop-color="#ff9f43"/>
    </radialGradient>
    <radialGradient id="bh-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#ffcf70" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf70" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bh-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3f8f"/><stop offset=".4" stop-color="#1e4f8f"/><stop offset="1" stop-color="#0f6f8c"/>
    </linearGradient>
    <linearGradient id="bh-sand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8b97a"/><stop offset="1" stop-color="#c98f55"/>
    </linearGradient>
  </defs>
  <rect width="1440" height="560" fill="url(#bh-sky)"/>
  <circle cx="1080" cy="120" r="1.6" fill="#fff" opacity=".7"/><circle cx="300" cy="90" r="1.3" fill="#fff" opacity=".6"/>
  <circle cx="620" cy="60" r="1.2" fill="#fff" opacity=".5"/><circle cx="1290" cy="200" r="1.4" fill="#fff" opacity=".5"/>
  <circle cx="160" cy="220" r="1.1" fill="#fff" opacity=".5"/>
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
  </g>
</svg>`;

/** Put the beach behind the page (once). */
export function showBeach(app: HTMLElement) {
  if (app.querySelector(":scope > .beach-bg")) return;
  const d = document.createElement("div");
  d.className = "beach-bg";
  d.innerHTML = SCENE;
  app.append(d);
}
