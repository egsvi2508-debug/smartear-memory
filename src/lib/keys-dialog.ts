// keys-dialog.ts: the "Keys" settings pop-up. Pick a layout, or tap a note
// and press any key to give it that key.

import { SCHEMES, NOTE_NAMES, getScheme, setScheme, getCustom, setCustomKey, resetCustom, type Scheme } from "./keys";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A readable name for a key (e.code KeyQ → Q, Digit1 → 1, Semicolon → ;). */
function keyLabel(e: KeyboardEvent): string {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return "Num " + c.slice(6);
  const sym: Record<string, string> = { Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`", Space: "Space" };
  if (sym[c]) return sym[c];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

let open = false;

function showKeysDialog() {
  if (open) return;
  open = true;
  const back = el("div", "keys-back");
  const box = el("div", "keys-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Keys");
  const head = el("div", "keys-head");
  const close = el("button", "keys-x", "Done");
  close.type = "button";
  head.append(el("span", "keys-title", "Keys"), close);

  const seg = el("div", "keys-seg");
  const grid = el("div", "keys-grid");
  const tip = el("div", "keys-tip");
  const reset = el("button", "keys-reset", "Reset my keys");
  reset.type = "button";
  let waiting = -1; // note waiting for a key

  const draw = () => {
    const scheme = getScheme();
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.id === scheme));
    const custom = getCustom();
    grid.classList.toggle("dim", scheme !== "custom");
    grid.querySelectorAll<HTMLButtonElement>(".keys-note").forEach((b, pc) => {
      b.classList.toggle("wait", pc === waiting);
      b.querySelector(".keys-key")!.textContent = pc === waiting ? "…" : custom[pc].label || "–";
    });
    tip.textContent =
      waiting >= 0 ? `Press any key for ${NOTE_NAMES[waiting]}` : scheme === "custom" ? "Tap a note, then press a key" : scheme === "piano" ? "A S D F G H J = C D E F G A B · W E T Y U = black keys" : "Type the note letter · Shift = ♯";
    reset.hidden = scheme !== "custom";
  };

  (Object.keys(SCHEMES) as Scheme[]).forEach((id) => {
    const b = el("button", "", SCHEMES[id]);
    b.type = "button";
    b.dataset.id = id;
    b.addEventListener("click", () => {
      waiting = -1;
      setScheme(id);
      draw();
    });
    seg.append(b);
  });
  NOTE_NAMES.forEach((n, pc) => {
    const b = el("button", "keys-note" + (n.length > 1 ? " sharp" : ""));
    b.type = "button";
    b.append(el("span", "keys-name", n), el("span", "keys-key mono"));
    b.addEventListener("click", () => {
      if (getScheme() !== "custom") setScheme("custom");
      waiting = waiting === pc ? -1 : pc;
      draw();
    });
    grid.append(b);
  });
  reset.addEventListener("click", () => {
    waiting = -1;
    resetCustom();
    draw();
  });

  // Keys go to this pop-up while it is open, not to the game behind it.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (waiting >= 0) {
        waiting = -1;
        draw();
      } else done();
      return;
    }
    if (waiting < 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        done();
      }
      return;
    }
    if (["Shift", "Control", "Alt", "Meta", "Tab", "Enter"].includes(e.key)) return;
    e.preventDefault();
    setCustomKey(waiting, { code: e.code, label: keyLabel(e) });
    waiting = waiting < 11 ? waiting + 1 : -1; // move on to the next note
    draw();
  };
  const done = () => {
    window.removeEventListener("keydown", onKey, true);
    back.remove();
    open = false;
  };
  window.addEventListener("keydown", onKey, true);
  close.addEventListener("click", done);
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) done();
  });

  box.append(head, seg, grid, tip, reset);
  back.append(box);
  document.body.append(back);
  draw();
  close.focus();
}

window.addEventListener("hears:open-keys", showKeysDialog);
