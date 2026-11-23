// theory.ts — note maths, correct enharmonic spelling, keys and harmony
// tables. Everything is MIDI numbers (C4 = 60) plus spelled notes
// {letter, alter, octave}; a note is never named from its MIDI number alone.

type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
interface Spelled {
  midi: number;
  letter: Letter;
  alter: number;
  octave: number;
}
export type NoteSystem = "letter" | "solfege" | "german";
export type Mode = "major" | "minor";

export const LETTERS: Letter[] = ["C", "D", "E", "F", "G", "A", "B"];
export const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------------------------------------------------------------------------
// Note names as text (user preference: letter, fixed-do solfège or German)
// ---------------------------------------------------------------------------
const SOLFEGE: Record<Letter, string> = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };
const GERMAN: Record<Letter, string> = { C: "C", D: "D", E: "E", F: "F", G: "G", A: "A", B: "H" };

export function accidental(alter: number): string {
  if (alter === 0) return "";
  if (alter === 2) return "𝄪";
  if (alter === -2) return "𝄫";
  return (alter > 0 ? "♯" : "♭").repeat(Math.abs(alter));
}

export function noteLabel(n: { letter: Letter; alter: number }, system: NoteSystem = "letter"): string {
  const { letter, alter } = n;
  if (system === "solfege") return SOLFEGE[letter] + accidental(alter);
  if (system === "german") {
    if (letter === "B") {
      if (alter === 0) return "H";
      if (alter === 1) return "His";
      if (alter === -1) return "B";
      if (alter === -2) return "Heses";
      return "H" + (alter > 0 ? "is" : "es").repeat(Math.abs(alter));
    }
    const base = GERMAN[letter];
    if (alter === 0) return base;
    if (alter > 0) return base + "is".repeat(alter);
    const flats = "es".repeat(-alter);
    return base + (letter === "E" || letter === "A" ? flats.slice(1) : flats);
  }
  return letter + accidental(alter);
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** German octave names: Subkontra-A, Kontra-C, großes C ("C"), kleines c
 *  ("c"), then c¹ (middle C) … c⁵. `octave` is the scientific octave (C4 = middle C). */
function germanPitchName(n: { letter: Letter; alter: number }, octave: number): string {
  const pc = noteLabel(n, "german");
  if (octave >= 4) return pc.toLowerCase() + [...String(octave - 3)].map((d) => SUPERSCRIPT[Number(d)]).join("");
  if (octave === 3) return pc.toLowerCase();
  if (octave === 2) return pc;
  if (octave === 1) return `Kontra-${pc}`;
  return `Subkontra-${pc}`;
}

/** A note with its octave in the user's system: "C4", "Do4", or German "c¹". */
export function pitchName(n: { letter: Letter; alter: number }, octave: number, system: NoteSystem = "letter"): string {
  return system === "german" ? germanPitchName(n, octave) : noteLabel(n, system) + octave;
}

export function keyLabel(root: { letter: Letter; alter: number }, isMajor: boolean, system: NoteSystem = "letter"): string {
  const r = noteLabel(root, system);
  if (system === "german") return isMajor ? `${r}-Dur` : `${r.toLowerCase()}-moll`;
  return `${r} ${isMajor ? "major" : "minor"}`;
}

/** "Ab4", "F##3" — ASCII, for VexFlow keys and debugging. */
export function spelledName(n: Spelled): string {
  return n.letter + (n.alter === 0 ? "" : (n.alter > 0 ? "#" : "b").repeat(Math.abs(n.alter))) + n.octave;
}

// ---------------------------------------------------------------------------
// Enharmonic spelling
// ---------------------------------------------------------------------------
const ROOT_CANDIDATES: Record<number, [Letter, number][]> = {
  0: [["C", 0]],
  1: [["C", 1], ["D", -1]],
  2: [["D", 0]],
  3: [["E", -1], ["D", 1]],
  4: [["E", 0]],
  5: [["F", 0]],
  6: [["F", 1], ["G", -1]],
  7: [["G", 0]],
  8: [["A", -1], ["G", 1]],
  9: [["A", 0]],
  10: [["B", -1], ["A", 1]],
  11: [["B", 0]],
};

function alterCost(alter: number): number {
  const a = Math.abs(alter);
  return a === 0 ? 0 : a === 1 ? 1 : a === 2 ? 5 : 100;
}

function spellFromLetter(rootMidi: number, rootLetter: Letter, rootAlter: number, offsets: number[], letterSteps: number[]) {
  const naturalRootMidi = rootMidi - rootAlter;
  const rootOct = Math.floor(naturalRootMidi / 12) - 1;
  const d0 = rootOct * 7 + LETTERS.indexOf(rootLetter);
  const spelled: Spelled[] = [];
  let cost = 0;
  for (let j = 0; j < offsets.length; j++) {
    const target = rootMidi + offsets[j];
    const d = d0 + letterSteps[j];
    const letter = LETTERS[mod(d, 7)];
    const oct = Math.floor(d / 7);
    const natural = (oct + 1) * 12 + LETTER_PC[letter];
    const alter = target - natural;
    cost += alterCost(alter);
    spelled.push({ midi: target, letter, alter, octave: oct });
  }
  return { spelled, cost };
}

/** Spell notes given their semitone offsets and letter distances from the first note. */
export function spellFromRoot(rootMidi: number, offsets: number[], letterSteps: number[]): Spelled[] {
  let best: Spelled[] | null = null;
  let bestCost = Infinity;
  for (const [L, a] of ROOT_CANDIDATES[mod(rootMidi, 12)]) {
    const { spelled, cost } = spellFromLetter(rootMidi, L, a, offsets, letterSteps);
    if (cost < bestCost) {
      bestCost = cost;
      best = spelled;
    }
  }
  return best!;
}

/** Spell one isolated note with the milder accidental (sharps on ties). */
export function spellNote(midi: number): Spelled {
  let best: Spelled | null = null;
  let bestCost = Infinity;
  for (const [letter, alter] of ROOT_CANDIDATES[mod(midi, 12)]) {
    const cost = alterCost(alter);
    if (cost < bestCost) {
      bestCost = cost;
      const natural = midi - alter;
      best = { midi, letter, alter, octave: Math.floor(natural / 12) - 1 };
    }
  }
  return best!;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Seven {letter, alter} for a key, chosen like a real key signature
 *  (natural minor decides the signature; harmonic minor raises degree 7). */
export function keySpelling(tonicPc: number, mode: Mode): { letter: Letter; alter: number }[] {
  const sig = mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  let best: { letter: Letter; alter: number }[] | null = null;
  let bestCost = Infinity;
  for (const [tonicLetter] of ROOT_CANDIDATES[mod(tonicPc, 12)]) {
    const ti = LETTERS.indexOf(tonicLetter);
    const degs: { letter: Letter; alter: number }[] = [];
    let cost = 0;
    for (let i = 0; i < 7; i++) {
      const letter = LETTERS[(ti + i) % 7];
      let alter = mod(tonicPc + sig[i], 12) - LETTER_PC[letter];
      if (alter > 6) alter -= 12;
      if (alter < -6) alter += 12;
      cost += alterCost(alter);
      degs.push({ letter, alter });
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = degs;
    }
  }
  const out = best!;
  if (mode === "minor") out[6] = { letter: out[6].letter, alter: out[6].alter + 1 };
  return out;
}
