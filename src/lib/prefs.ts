import type { NoteSystem } from "./theory";

const KEY = "smem:noteNames";
export function getNoteSystem(): NoteSystem {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "letter" || v === "solfege" || v === "german") return v;
  } catch {
    /* storage blocked */
  }
  return "letter";
}
export function setNoteSystem(v: NoteSystem) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage blocked */
  }
}
