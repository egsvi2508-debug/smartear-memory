// theory.ts — note maths, correct enharmonic spelling, keys and harmony
// tables. Everything is MIDI numbers (C4 = 60) plus spelled notes
// {letter, alter, octave}; a note is never named from its MIDI number alone.

export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export interface Spelled {
  midi: number;
  letter: Letter;
  alter: number;
  octave: number;
}
export type NoteSystem = "letter" | "solfege" | "german";
export type Mode = "major" | "minor";

export const LETTERS: Letter[] = ["C", "D", "E", "F", "G", "A", "B"];
export const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const mod = (n: number, m: number) => ((n % m) + m) % m;
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);

export function midiToName(midi: number): string {
  return NOTE_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
}

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
export function germanPitchName(n: { letter: Letter; alter: number }, octave: number): string {
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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const STRICHE = ["ein", "zwei", "drei", "vier", "fünf"];

/** A note's full German name, as a musician says it: Subkontra-A, Kontra-D,
 *  großes D, kleines fis, then d¹ (eingestrichenes d), d², … */
export function germanPitchNameLong(n: { letter: Letter; alter: number }, octave: number): string {
  const pc = noteLabel(n, "german");
  if (octave >= 4) return pc.toLowerCase() + [...String(octave - 3)].map((d) => SUPERSCRIPT[Number(d)]).join("");
  if (octave === 3) return `kleines ${pc.toLowerCase()}`;
  if (octave === 2) return `großes ${pc}`;
  if (octave === 1) return `Kontra-${pc}`;
  return `Subkontra-${pc}`;
}
/** How it is written: d (kleines), D (großes), D₁ (Kontra), A₂ (Subkontra), d¹… */
export function germanPitchWritten(n: { letter: Letter; alter: number }, octave: number): string {
  const pc = noteLabel(n, "german");
  if (octave >= 3) return germanPitchName(n, octave);
  if (octave === 2) return pc;
  return pc + SUBSCRIPT[2 - Math.max(0, octave)]; // Kontra: D₁, Subkontra: A₂
}
/** A German octave's full name: Subkontraoktave, Kontraoktave, große Oktave,
 *  kleine Oktave, eingestrichene Oktave (c¹) … fünfgestrichene Oktave (c⁵). */
export function germanOctaveLong(octave: number): string {
  if (octave >= 4) return `${STRICHE[octave - 4] ?? ""}gestrichene Oktave`;
  return ["Subkontraoktave", "Kontraoktave", "große Oktave", "kleine Oktave"][Math.max(0, octave)];
}

/** German name of a scientific octave, as a register: Subkontra, Kontra, Groß, Klein, c¹ … c⁵. */
export function germanOctaveName(octave: number): string {
  if (octave >= 4) return "c" + [...String(octave - 3)].map((d) => SUPERSCRIPT[Number(d)]).join("");
  return ["Subkontra", "Kontra", "Groß", "Klein"][Math.max(0, octave)];
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

/** Same, but the root's letter is already decided (e.g. by the key signature). */
export function spellFromRootLetter(rootMidi: number, rootLetter: Letter, rootAlter: number, offsets: number[], letterSteps: number[]): Spelled[] {
  return spellFromLetter(rootMidi, rootLetter, rootAlter, offsets, letterSteps).spelled;
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

/** Spell a MIDI note with a given letter (alteration computed). */
export function spellWithLetter(midi: number, letter: Letter): Spelled {
  let alter = mod(midi - LETTER_PC[letter], 12);
  if (alter > 6) alter -= 12;
  return { midi, letter, alter, octave: Math.floor((midi - alter) / 12) - 1 };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export const HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];

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

/** Number of sharps (>0) or flats (<0) in a key's signature. */
export function keySignatureCount(tonicPc: number, mode: Mode): number {
  const sp = keySpelling(tonicPc, mode);
  const sig = mode === "minor" ? sp.map((d, i) => (i === 6 ? { ...d, alter: d.alter - 1 } : d)) : sp;
  return sig.reduce((s, d) => s + d.alter, 0);
}

/** VexFlow key-signature name for a key ("Bb", "F#m" style → we use the major equivalent). */
export function vexKeySignature(tonicPc: number, mode: Mode): string {
  const majorPc = mode === "major" ? tonicPc : mod(tonicPc + 3, 12);
  const n = keySignatureCount(tonicPc, mode);
  const table: Record<string, string> = {
    "0": "C", "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#",
    "-1": "F", "-2": "Bb", "-3": "Eb", "-4": "Ab", "-5": "Db", "-6": "Gb", "-7": "Cb",
  };
  void majorPc;
  return table[String(n)] ?? "C";
}

/** Spell a MIDI note inside a key: diatonic letters first, then the usual
 *  chromatic preferences (major ♯1 ♯2 ♯4 ♯5 ♭7; minor ♭2 ♯3 ♯4 ♯6 ♯7). */
export function spellInKey(midi: number, tonicPc: number, mode: Mode): Spelled {
  const sp = keySpelling(tonicPc, mode);
  const rel = mod(midi - tonicPc, 12);
  const scale = mode === "major" ? MAJOR_SCALE : HARMONIC_MINOR_SCALE;
  const idx = scale.indexOf(rel);
  if (idx >= 0) return spellWithLetter(midi, sp[idx].letter);
  if (mode === "minor" && rel === 10) return spellWithLetter(midi, sp[6].letter); // natural ♭7
  const majorPref: Record<number, [number, number]> = { 1: [0, 1], 3: [1, 1], 6: [3, 1], 8: [4, 1], 10: [6, -1] };
  const minorPref: Record<number, [number, number]> = { 1: [1, -1], 4: [2, 1], 6: [3, 1], 9: [5, 1], 11: [6, 0] };
  const pref = (mode === "major" ? majorPref : minorPref)[rel];
  if (pref) return spellWithLetter(midi, sp[pref[0]].letter);
  return spellNote(midi);
}

// ---------------------------------------------------------------------------
// Diatonic harmony
// ---------------------------------------------------------------------------
export type Quality =
  | "major" | "minor" | "diminished" | "augmented"
  | "major7" | "dominant7" | "minor7" | "half-diminished7" | "diminished7" | "minor-major7";

export const TERTIAN: Record<Quality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  major7: [0, 4, 7, 11],
  dominant7: [0, 4, 7, 10],
  minor7: [0, 3, 7, 10],
  "half-diminished7": [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
  "minor-major7": [0, 3, 7, 11],
};

const MAJOR_DEGREES: { triad: Quality; seventh: Quality }[] = [
  { triad: "major", seventh: "major7" },
  { triad: "minor", seventh: "minor7" },
  { triad: "minor", seventh: "minor7" },
  { triad: "major", seventh: "major7" },
  { triad: "major", seventh: "dominant7" },
  { triad: "minor", seventh: "minor7" },
  { triad: "diminished", seventh: "half-diminished7" },
];
const MINOR_DEGREES: { triad: Quality; seventh: Quality | null }[] = [
  { triad: "minor", seventh: "minor-major7" },
  { triad: "diminished", seventh: "half-diminished7" },
  { triad: "augmented", seventh: null },
  { triad: "minor", seventh: "minor7" },
  { triad: "major", seventh: "dominant7" },
  { triad: "major", seventh: "major7" },
  { triad: "diminished", seventh: "diminished7" },
];
export const MODE_TABLE = {
  major: { scale: MAJOR_SCALE, degrees: MAJOR_DEGREES },
  minor: { scale: HARMONIC_MINOR_SCALE, degrees: MINOR_DEGREES },
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
export function romanFor(degree: number, quality: Quality): string {
  const base = ROMAN[degree];
  switch (quality) {
    case "major": return base;
    case "minor": return base.toLowerCase();
    case "diminished": return base.toLowerCase() + "°";
    case "augmented": return base + "+";
    case "major7": return base + "maj7";
    case "dominant7": return base + "7";
    case "minor7": return base.toLowerCase() + "7";
    case "half-diminished7": return base.toLowerCase() + "ø7";
    case "diminished7": return base.toLowerCase() + "°7";
    case "minor-major7": return base.toLowerCase() + "mM7";
  }
}

/** Fold a set of MIDI notes by whole octaves (as one group) into [low, high]. */
export function foldGroup(midis: number[], low: number, high: number): number[] {
  if (!midis.length) return [];
  const mn = Math.min(...midis);
  const mx = Math.max(...midis);
  if (mx - mn <= high - low) {
    const kMin = Math.ceil((low - mn) / 12);
    const kMax = Math.floor((high - mx) / 12);
    if (kMin <= kMax) {
      const k = Math.min(kMax, Math.max(kMin, 0));
      return midis.map((m) => m + 12 * k);
    }
  }
  return midis.map((m) => {
    const pc = mod(m - low, 12);
    let best = low + pc;
    for (let c = low + pc; c <= high; c += 12) if (Math.abs(c - m) < Math.abs(best - m)) best = c;
    return best;
  });
}

export const isBlackKey = (m: number) => [1, 3, 6, 8, 10].includes(mod(m, 12));
