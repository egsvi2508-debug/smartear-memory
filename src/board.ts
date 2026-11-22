// board.ts, global leaderboards in the SmartEar Firebase project.
// Players sign in anonymously (no account, no email). Each player has one
// entry per game (their best ranked run) and one overall entry (rating).
// Firestore rules only let a player write their own entry, with sane
// values, and an entry can only go up. Loaded lazily; the app works
// without it.

import type { Firestore } from "firebase/firestore";
import type { Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDaksgCTP0Nm7us7pH-9tVHMaWIbDmERdM",
  authDomain: "smartear-ee265.firebaseapp.com",
  projectId: "smartear-ee265",
  storageBucket: "smartear-ee265.firebasestorage.app",
  messagingSenderId: "434588723633",
  appId: "1:434588723633:web:66dcc64016d290171eb590",
};

const RANK_K = 10_000_000;

export interface Entry {
  uid: string;
  name: string;
  level: number;
  score: number;
  mode?: string;
}
export interface OverallEntry {
  uid: string;
  name: string;
  rating: number;
  games: number;
}

type FS = typeof import("firebase/firestore");
interface Conn {
  db: Firestore;
  auth: Auth;
  fs: FS;
  uid: string;
}

let conn: Promise<Conn | null> | null = null;

/** Connect and sign in anonymously; null if Firebase can't be reached. */
export function connect(): Promise<Conn | null> {
  if (!conn) {
    conn = (async () => {
      try {
        const [{ initializeApp }, authMod, fs] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
        const app = initializeApp(firebaseConfig, "musical-memory");
        const auth = authMod.getAuth(app);
        await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
        await auth.authStateReady();
        const user = auth.currentUser ?? (await authMod.signInAnonymously(auth)).user;
        return { db: fs.getFirestore(app), auth, fs, uid: user.uid };
      } catch (e) {
        console.warn("[Musical Memory] leaderboard unavailable", e);
        conn = null; // allow a retry later
        return null;
      }
    })();
  }
  return conn;
}

export async function myUid(): Promise<string | null> {
  return (await connect())?.uid ?? null;
}

/** Clean a display name: one line, no control characters, 1–20 chars. */
export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

/** Which board: a game's all-time board, a game's board for one Daily, or overall. */
export type Board = { game: string; day?: string } | null;

function colPath(b: Board): string[] {
  if (!b) return ["memoryOverall"];
  return b.day ? ["memoryDaily", b.day, b.game] : ["memoryBoards", b.game, "scores"];
}

/** Save a player's entry on a board. Keeps the higher of the old and new entry. */
export async function submitGame(game: string, e: { name: string; level: number; score: number; mode: string }, day?: string): Promise<boolean> {
  const c = await connect();
  const name = cleanName(e.name);
  if (!c || !name || e.level < 1) return false;
  if (day && e.mode !== "daily") return false;
  const { fs, db, uid } = c;
  const [c1, ...rest] = colPath({ game, day });
  const ref = fs.doc(db, c1, ...rest, uid);
  try {
    const old = await fs.getDoc(ref);
    let level = Math.min(60, Math.floor(e.level));
    let score = Math.min(RANK_K - 1, Math.max(0, Math.floor(e.score)));
    let mode = e.mode === "daily" ? "daily" : "classic";
    if (old.exists()) {
      const o = old.data() as { level: number; score: number; mode: string; rank: number; name: string };
      if (o.rank > level * RANK_K + score) ({ level, score, mode } = o);
      if (o.rank === level * RANK_K + score && o.name === name) return true; // nothing new
    }
    await fs.setDoc(ref, { name, level, score, mode, rank: level * RANK_K + score, updatedAt: fs.serverTimestamp() });
    return true;
  } catch (err) {
    console.warn("[Musical Memory] submit failed", err);
    return false;
  }
}

export async function submitOverall(name: string, rating: number, games: number): Promise<boolean> {
  const c = await connect();
  const n = cleanName(name);
  if (!c || !n || rating < 100 || games < 1) return false;
  try {
    await c.fs.setDoc(c.fs.doc(c.db, "memoryOverall", c.uid), {
      name: n,
      rating: Math.min(60000, Math.floor(rating)),
      games: Math.min(12, games),
      updatedAt: c.fs.serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn("[Musical Memory] overall submit failed", err);
    return false;
  }
}

export async function topGame(game: string, n = 50, day?: string): Promise<Entry[] | null> {
  const c = await connect();
  if (!c) return null;
  const { fs, db } = c;
  const [c1, ...rest] = colPath({ game, day });
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, c1, ...rest), fs.orderBy("rank", "desc"), fs.limit(n)));
    return snap.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, name: String(x.name), level: Number(x.level), score: Number(x.score), mode: String(x.mode) };
    });
  } catch (err) {
    console.warn("[Musical Memory] board read failed", err);
    return null;
  }
}

export async function topOverall(n = 50): Promise<OverallEntry[] | null> {
  const c = await connect();
  if (!c) return null;
  const { fs, db } = c;
  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, "memoryOverall"), fs.orderBy("rating", "desc"), fs.limit(n)));
    return snap.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, name: String(x.name), rating: Number(x.rating), games: Number(x.games) };
    });
  } catch (err) {
    console.warn("[Musical Memory] overall read failed", err);
    return null;
  }
}

/** Your position on a board (1 = top; 0 = not on it) and how many players it has. */
export async function myPlace(board: Board): Promise<{ place: number; total: number } | null> {
  const c = await connect();
  if (!c) return null;
  const { fs, db, uid } = c;
  const [c1, ...rest] = colPath(board);
  try {
    const col = fs.collection(db, c1, ...rest);
    const field = board ? "rank" : "rating";
    const mine = await fs.getDoc(fs.doc(db, c1, ...rest, uid));
    const total = (await fs.getCountFromServer(col)).data().count;
    if (!mine.exists()) return { place: 0, total };
    const above = (await fs.getCountFromServer(fs.query(col, fs.where(field, ">", mine.data()[field])))).data().count;
    return { place: above + 1, total };
  } catch (err) {
    console.warn("[Musical Memory] place lookup failed", err);
    return null;
  }
}

/** Delete this player's entries: every game board, the overall board, and
 *  the Daily boards of the last `days` days. Returns false if it failed. */
export async function removeMe(games: string[], days = 60): Promise<boolean> {
  const c = await connect();
  if (!c) return false;
  const { fs, db, uid } = c;
  try {
    const batch = fs.writeBatch(db);
    batch.delete(fs.doc(db, "memoryOverall", uid));
    const d = new Date();
    for (const g of games) {
      batch.delete(fs.doc(db, "memoryBoards", g, "scores", uid));
      for (let i = 0; i < days; i++) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
        const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
        batch.delete(fs.doc(db, "memoryDaily", key, g, uid));
      }
    }
    await batch.commit();
    return true;
  } catch (err) {
    console.warn("[Musical Memory] remove failed", err);
    return false;
  }
}
