// keys.ts: which computer key plays which note, shared by every game.
//   letters , A–G, hold Shift for sharp
//   piano   , piano rows: A S D F G H J = C D E F G A B, W E T Y U = black keys
//   custom  , any key for any note, set by the player
// Keys are matched by their physical position (KeyboardEvent.code), so a
// custom layout keeps working whatever the keyboard's language.

export type Scheme = "letters" | "piano" | "custom";
export const SCHEMES: Record<Scheme, string> = { letters: "Letters", piano: "Piano rows", custom: "My keys" };
export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

const KEY_SCHEME = "hears:keys";
const KEY_CUSTOM = "hears:customKeys";

/** Piano rows: pitch class (0 = C) per key, and +12 for the second octave. */
const PIANO_CODES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface CustomKey {
  code: string;
  label: string;
}
const DEFAULT_CUSTOM: CustomKey[] = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ"].map((code) => ({ code, label: code.slice(3) }));

function read<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function getScheme(): Scheme {
  const s = read<string>(KEY_SCHEME, "letters");
  return s === "piano" || s === "custom" ? s : "letters";
}
export function setScheme(s: Scheme) {
  write(KEY_SCHEME, s);
  window.dispatchEvent(new Event("hears:keys-changed"));
}
export function getCustom(): CustomKey[] {
  const c = read<CustomKey[]>(KEY_CUSTOM, DEFAULT_CUSTOM);
  return Array.isArray(c) && c.length === 12 && c.every((k) => k && typeof k.code === "string") ? c : DEFAULT_CUSTOM.map((k) => ({ ...k }));
}
/** Give a note a key (a key can only belong to one note). */
export function setCustomKey(pc: number, key: CustomKey) {
  const c = getCustom().map((k) => (k.code === key.code ? { code: "", label: "" } : k));
  c[pc] = key;
  write(KEY_CUSTOM, c);
  window.dispatchEvent(new Event("hears:keys-changed"));
}
export function resetCustom() {
  write(KEY_CUSTOM, DEFAULT_CUSTOM);
  window.dispatchEvent(new Event("hears:keys-changed"));
}

/** A key press → a note, as a pitch class (0–11) plus an octave step
 *  (0, or 1 for the piano rows' second octave). null if it isn't a note key. */
export function noteFromKey(e: KeyboardEvent): { pc: number; octave: number } | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const scheme = getScheme();
  if (scheme === "piano") {
    const v = PIANO_CODES[e.code];
    return v === undefined ? null : { pc: v % 12, octave: Math.floor(v / 12) };
  }
  if (scheme === "custom") {
    const pc = getCustom().findIndex((k) => k.code && k.code === e.code);
    return pc < 0 ? null : { pc, octave: 0 };
  }
  const k = (e.key || "").toUpperCase();
  if (k.length !== 1 || LETTER_PC[k] === undefined) return null;
  return { pc: (LETTER_PC[k] + (e.shiftKey ? 1 : 0)) % 12, octave: 0 };
}

/** Short hint for under a piano: what to press. */
export function keysHint(): string {
  const scheme = getScheme();
  if (scheme === "piano") return "Keys: A S D F G H J = C D E F G A B · W E T Y U = black keys";
  if (scheme === "custom") return "Keys: " + getCustom().map((k, i) => `${NOTE_NAMES[i]} ${k.label || "–"}`).join(" · ");
  return "Keys: A–G · Shift = ♯";
}

/** Ask the site to open the keyboard settings. */
export function openKeySettings() {
  window.dispatchEvent(new Event("hears:open-keys"));
}

/** The "Keys" choice for a game's start pop-up (same look as the other choices). */
export function renderKeysChoice(slot: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.className = "mk-choice";
  const label = document.createElement("div");
  label.className = "mk-section-label";
  label.textContent = "Keys";
  const seg = document.createElement("div");
  seg.className = "mk-seg";
  seg.setAttribute("role", "radiogroup");
  const btns: HTMLButtonElement[] = [];
  const paint = () => {
    const cur = getScheme();
    btns.forEach((b) => {
      b.classList.toggle("active", b.dataset.id === cur);
      b.setAttribute("aria-checked", String(b.dataset.id === cur));
    });
  };
  (Object.keys(SCHEMES) as Scheme[]).forEach((id) => {
    const b = document.createElement("button");
    b.className = "mk-seg-btn";
    b.type = "button";
    b.dataset.id = id;
    b.setAttribute("role", "radio");
    const t = document.createElement("span");
    t.className = "mk-seg-label";
    t.textContent = SCHEMES[id];
    b.append(t);
    b.addEventListener("click", () => {
      setScheme(id);
      if (id === "custom") openKeySettings();
    });
    btns.push(b);
    seg.append(b);
  });
  const edit = document.createElement("button");
  edit.className = "mk-link";
  edit.type = "button";
  edit.textContent = "Set my keys";
  edit.addEventListener("click", openKeySettings);
  wrap.append(label, seg, edit);
  slot.append(wrap);
  paint();
  const onChange = () => (wrap.isConnected ? paint() : window.removeEventListener("hears:keys-changed", onChange));
  window.addEventListener("hears:keys-changed", onChange);
}
