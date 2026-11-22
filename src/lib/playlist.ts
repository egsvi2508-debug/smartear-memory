// Background music. All CC0 (public domain): free to use anywhere, including
// videos, no credit required. Sources are listed in public/music/CREDITS.txt.
export interface Track {
  file: string;
  title: string;
  artist: string;
  /** How many times to play it in a row (these are seamless loops). */
  loops: number;
}

export const PLAYLIST: Track[] = [
  { file: "junkala-level-1.mp3", title: "Level 1", artist: "Juhani Junkala", loops: 2 },
  { file: "junkala-level-2.mp3", title: "Level 2", artist: "Juhani Junkala", loops: 2 },
  { file: "junkala-level-3.mp3", title: "Level 3", artist: "Juhani Junkala", loops: 2 },
  { file: "junkala-ending.mp3", title: "Ending", artist: "Juhani Junkala", loops: 3 },
];
