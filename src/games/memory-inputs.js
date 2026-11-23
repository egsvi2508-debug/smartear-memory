// memory-inputs.js, the playable piano for the Memory suite (Sequence
// Memory), plus the standard "musical typing" computer-keyboard mapping.
//
// AIM, THEN RELEASE. On a phone the keys are narrow, and a fat-finger
// press on the neighbouring key used to end a round the player actually
// knew. So a press doesn't answer, it AIMS: the key under the finger
// lights up, sounds, and a name bubble floats above the finger (which
// would otherwise hide the key). Slide to another key and the aim follows;
// lift to commit; slide well off the keyboard to cancel. The exercise and
// its grading are unchanged, only the moment of commitment moves from
// "finger down" to "finger up", which is exactly where a misclick can
// still be fixed.

import { noteLabel, pitchName } from "../lib/theory";
import { getNoteSystem } from "../lib/prefs";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const WHITE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const CANCEL_MARGIN = 44; // px beyond the keyboard's edge that cancels an aim

function isBlack(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

/** Plain name for a piano key (sharps for black keys), in the user's system. */
export function keyName(m) {
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  const white = WHITE_PCS.indexOf(pc);
  const spelled = white >= 0 ? { letter: WHITE_LETTERS[white], alter: 0 } : { letter: WHITE_LETTERS[WHITE_PCS.indexOf(pc - 1)], alter: 1 };
  return pitchName(spelled, octave, getNoteSystem());
}

/**
 * createPiano(host, { low, high, onPreview(m), onPress(m), labels })
 *   onPreview, a key was aimed at (play its sound here)
 *   onPress  , a key was committed (grade it here)
 */
export function createPiano(host, { low = 60, high = 77, onPress, onPreview, labels = true }) {
  const wrap = el("div", "mk-piano");
  const whitesCount = [...Array(high - low + 1)].map((_, i) => low + i).filter((m) => !isBlack(m)).length;
  const keys = new Map();
  let wi = 0;
  const system = getNoteSystem();
  for (let m = low; m <= high; m++) {
    if (isBlack(m)) continue;
    const k = el("button", "mk-key white");
    k.style.left = `${(wi / whitesCount) * 100}%`;
    k.style.width = `${100 / whitesCount}%`;
    if (labels) {
      const pc = m % 12;
      const name = noteLabel({ letter: WHITE_LETTERS[WHITE_PCS.indexOf(pc)], alter: 0 }, system);
      k.append(el("span", "mk-key-label" + (pc === 0 ? " c" : ""), pc === 0 ? pitchName({ letter: "C", alter: 0 }, Math.floor(m / 12) - 1, system) : name));
    }
    k.dataset.midi = m;
    k.tabIndex = -1;
    k.setAttribute("aria-label", keyName(m));
    wrap.appendChild(k);
    keys.set(m, k);
    wi++;
  }
  wi = 0;
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) {
      wi++;
      continue;
    }
    const k = el("button", "mk-key black");
    const w = (100 / whitesCount) * 0.64;
    k.style.left = `calc(${(wi / whitesCount) * 100}% - ${w / 2}%)`;
    k.style.width = `${w}%`;
    k.dataset.midi = m;
    k.tabIndex = -1;
    k.setAttribute("aria-label", keyName(m));
    wrap.appendChild(k);
    keys.set(m, k);
  }
  const bubble = el("div", "mk-key-bubble");
  wrap.appendChild(bubble);

  let enabled = true;
  let aim = null; // { id, midi, cancelled }

  function keyAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const k = t && t.closest ? t.closest(".mk-key") : null;
    return k && wrap.contains(k) ? Number(k.dataset.midi) : null;
  }
  function showBubble(m, text) {
    const k = keys.get(m);
    if (!k) return;
    const kr = k.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    bubble.textContent = text;
    bubble.style.left = `${kr.left + kr.width / 2 - wr.left}px`;
    bubble.classList.add("on");
  }
  function setAim(m) {
    if (!aim || aim.midi === m) return;
    if (aim.midi !== null) keys.get(aim.midi)?.classList.remove("aim");
    aim.midi = m;
    aim.cancelled = false;
    wrap.classList.remove("cancel");
    keys.get(m)?.classList.add("aim");
    showBubble(m, keyName(m));
    if (onPreview) onPreview(m);
  }
  function endAim() {
    if (aim && aim.midi !== null) keys.get(aim.midi)?.classList.remove("aim");
    aim = null;
    bubble.classList.remove("on");
    wrap.classList.remove("cancel");
  }
  function commit(a) {
    if (!a.cancelled && a.midi !== null && enabled) onPress(a.midi);
  }

  wrap.addEventListener("pointerdown", (e) => {
    if (!enabled) return;
    const m = keyAt(e.clientX, e.clientY);
    if (m === null) return;
    e.preventDefault();
    // A second finger landing while the first is still down (fast
    // two-thumb playing): the first note counts now, in order.
    if (aim && aim.id !== e.pointerId) {
      const prev = aim;
      endAim();
      commit(prev);
      if (!enabled) return;
    }
    aim = { id: e.pointerId, midi: null, cancelled: false };
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* some pointers can't be captured */
    }
    setAim(m);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const r = wrap.getBoundingClientRect();
    const outside = e.clientY < r.top - CANCEL_MARGIN || e.clientY > r.bottom + CANCEL_MARGIN || e.clientX < r.left - CANCEL_MARGIN || e.clientX > r.right + CANCEL_MARGIN;
    if (outside) {
      if (!aim.cancelled) {
        aim.cancelled = true;
        wrap.classList.add("cancel");
        if (aim.midi !== null) showBubble(aim.midi, "Release to cancel");
      }
      return;
    }
    if (aim.cancelled) {
      aim.cancelled = false;
      wrap.classList.remove("cancel");
      if (aim.midi !== null) showBubble(aim.midi, keyName(aim.midi));
    }
    const m = keyAt(e.clientX, e.clientY);
    if (m !== null) setAim(m);
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const prev = aim;
    endAim();
    commit(prev);
  });
  // Only the finger that owns the aim can drop it (an earlier finger lifting
  // must not cancel a newer one).
  const drop = (e) => {
    if (aim && e.pointerId === aim.id) endAim();
  };
  wrap.addEventListener("pointercancel", drop);
  wrap.addEventListener("lostpointercapture", drop);
  host.appendChild(wrap);

  return {
    el: wrap,
    has: (m) => keys.has(m),
    flash(m, cls = "lit", ms = 320) {
      const k = keys.get(m);
      if (!k) return;
      k.classList.remove("lit", "good", "bad", "hint");
      void k.offsetWidth;
      k.classList.add(cls);
      setTimeout(() => k.classList.remove(cls), ms);
    },
    clear() {
      keys.forEach((k) => k.classList.remove("lit", "good", "bad", "hint", "aim"));
    },
    setEnabled(on) {
      enabled = on;
      if (!on) endAim();
      wrap.classList.toggle("disabled", !on);
    },
  };
}
