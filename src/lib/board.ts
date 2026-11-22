// board.ts: a small global leaderboard per game (Firebase, loaded only when
// needed). Players sign in anonymously, no account or email. One entry per
// player per game: their best level cleared, then their best streak.
// Firestore rules only let a player write their own entry, and it can only go up.

import type { Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDaksgCTP0Nm7us7pH-9tVHMaWIbDmERdM",
  authDomain: "smartear-ee265.firebaseapp.com",
  projectId: "smartear-ee265",
  storageBucket: "smartear-ee265.firebasestorage.app",
  messagingSenderId: "434588723633",
  appId: "1:434588723633:web:66dcc64016d290171eb590",
};
const K = 10000; // rank = level * K + streak

export interface Entry {
  uid: string;
  name: string;
  level: number;
  streak: number;
}

type FS = typeof import("firebase/firestore");
interface Conn {
  db: Firestore;
  fs: FS;
  uid: string;
}
let conn: Promise<Conn | null> | null = null;

function connect(): Promise<Conn | null> {
  if (!conn) {
    conn = (async () => {
      try {
        const [{ initializeApp }, authMod, fs] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
        const app = initializeApp(firebaseConfig, "human-ears");
        const auth = authMod.getAuth(app);
        await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
        await auth.authStateReady();
        const user = auth.currentUser ?? (await authMod.signInAnonymously(auth)).user;
        return { db: fs.getFirestore(app), fs, uid: user.uid };
      } catch (e) {
        console.warn("[Human Ears] leaderboard unavailable", e);
        conn = null; // try again later
        return null;
      }
    })();
  }
  return conn;
}

export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

const col = (c: Conn, game: string) => c.fs.collection(c.db, "earsBoards", game, "scores");

/** Save your best on a game's board (keeps the higher of old and new). */
export async function submit(game: string, name: string, level: number, streak: number): Promise<boolean> {
  const c = await connect();
  const n = cleanName(name);
  if (!c || !n || (level < 1 && streak < 1)) return false;
  const ref = c.fs.doc(col(c, game), c.uid);
  try {
    let lv = Math.min(99, Math.floor(level));
    let st = Math.min(K - 1, Math.max(0, Math.floor(streak)));
    const old = await c.fs.getDoc(ref);
    if (old.exists()) {
      const o = old.data() as { level: number; streak: number; name: string };
      lv = Math.max(lv, o.level);
      st = Math.max(st, o.streak);
      if (lv === o.level && st === o.streak && o.name === n) return true; // nothing new
    }
    await c.fs.setDoc(ref, { name: n, level: lv, streak: st, rank: lv * K + st, updatedAt: c.fs.serverTimestamp() });
    return true;
  } catch (e) {
    console.warn("[Human Ears] submit failed", e);
    return false;
  }
}

/** The top of a game's board, plus your own place (1-based) if you're on it. */
export async function top(game: string, n = 5): Promise<{ rows: Entry[]; me: string; myPlace: number | null; mine: Entry | null } | null> {
  const c = await connect();
  if (!c) return null;
  const { fs } = c;
  try {
    const snap = await fs.getDocs(fs.query(col(c, game), fs.orderBy("rank", "desc"), fs.limit(n)));
    const rows = snap.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, name: String(x.name), level: Number(x.level), streak: Number(x.streak) };
    });
    let myPlace: number | null = null;
    let mine: Entry | null = null;
    const i = rows.findIndex((r) => r.uid === c.uid);
    if (i >= 0) (myPlace = i + 1), (mine = rows[i]);
    else {
      const d = await fs.getDoc(fs.doc(col(c, game), c.uid));
      if (d.exists()) {
        const x = d.data();
        mine = { uid: c.uid, name: String(x.name), level: Number(x.level), streak: Number(x.streak) };
        const ahead = await fs.getCountFromServer(fs.query(col(c, game), fs.where("rank", ">", Number(x.rank))));
        myPlace = ahead.data().count + 1;
      }
    }
    return { rows, me: c.uid, myPlace, mine };
  } catch (e) {
    console.warn("[Human Ears] board read failed", e);
    return null;
  }
}

// Dev builds only (removed from the published site): lets tests clean up their entry.
if (import.meta.env && import.meta.env.DEV)
  (globalThis as unknown as { __board: unknown }).__board = {
    async remove(game: string) {
      const c = await connect();
      if (c) await c.fs.deleteDoc(c.fs.doc(col(c, game), c.uid));
    },
    top,
  };
