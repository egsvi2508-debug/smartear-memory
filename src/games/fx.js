// fx.js, in-game effects built to read well on camera: a big stamp on a
// hit or a miss, a particle burst, a floating "+points", a counting score
// and combo banners. Purely visual: nothing here touches a game's rules.
// Everything sits in a layer with pointer-events: none and removes itself.

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** The effects layer inside a card (created once). */
function layerOf(host) {
  let l = host.querySelector(":scope > .fx-layer");
  if (!l) {
    l = node("div", "fx-layer");
    l.setAttribute("aria-hidden", "true");
    host.appendChild(l);
  }
  return l;
}

function selfRemove(n, ms) {
  setTimeout(() => n.remove(), ms);
}

/** A big centred stamp: "PERFECT" with "+250 ×3" under it. kind: good | bad | gold */
export function stamp(host, title, sub, kind = "good", ms = 760) {
  const l = layerOf(host);
  l.querySelectorAll(".fx-stamp").forEach((s) => s.remove());
  const s = node("div", `fx-stamp ${kind}`);
  s.style.setProperty("--fx-ms", `${ms}ms`);
  s.append(node("div", "fx-stamp-title", title));
  if (sub) s.append(node("div", "fx-stamp-sub", sub));
  l.appendChild(s);
  selfRemove(s, ms + 60);
}

/** A full-card colour flash. */
export function flash(host, kind = "good") {
  const l = layerOf(host);
  const f = node("div", `fx-flash ${kind}`);
  l.appendChild(f);
  selfRemove(f, 520);
}

/** Particles flying out from a point (default: the centre). */
export function burst(host, { x = 0.5, y = 0.5, count = 22, kind = "good", glyphs = false } = {}) {
  if (reduced()) return;
  const l = layerOf(host);
  const marks = ["♪", "♫", "♩", "♬"];
  for (let i = 0; i < count; i++) {
    const p = node("i", `fx-p ${kind}${glyphs && i % 3 === 0 ? " glyph" : ""}`);
    if (glyphs && i % 3 === 0) p.textContent = marks[i % marks.length];
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const d = 70 + Math.random() * 120;
    p.style.left = `${x * 100}%`;
    p.style.top = `${y * 100}%`;
    p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    p.style.setProperty("--r", `${Math.random() * 540 - 270}deg`);
    p.style.animationDelay = `${Math.random() * 60}ms`;
    l.appendChild(p);
    selfRemove(p, 900);
  }
}

/** Restart a CSS animation class on an element. */
export function kick(elm, cls, ms = 600) {
  if (!elm) return;
  elm.classList.remove(cls);
  void elm.offsetWidth;
  elm.classList.add(cls);
  if (ms) setTimeout(() => elm.classList.remove(cls), ms);
}

/** A sweeping banner across the card for streak milestones. */
function banner(host, title, sub) {
  const l = layerOf(host);
  const b = node("div", "fx-banner");
  b.append(node("div", "fx-banner-title", title));
  if (sub) b.append(node("div", "fx-banner-sub", sub));
  l.appendChild(b);
  selfRemove(b, 1300);
}
