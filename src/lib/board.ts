// board.ts: a small global leaderboard per game (Firebase, loaded only when
// needed). Reading the board needs no sign-in. Only players who choose to
// join sign in, anonymously (no account, no email), and post one entry per
// game: best level cleared, then best streak. Leaving deletes those entries
// and the anonymous sign-in. Firestore rules only let a player write or
// delete their own entry, and an entry can only go up.

import type { Firestore } from "firebase/firestore";
import type { Auth } from "firebase/auth";
import { GAME_IDS } from "./stats";

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

// ---- connections: read-only (no sign-in), and signed-in (only after joining)
let base: Promise<{ app: import("firebase/app").FirebaseApp; db: Firestore; fs: FS } | null> | null = null;
function open() {
  if (!base) {
    base = (async () => {
      try {
        const [{ initializeApp }, fs] = await Promise.all([import("firebase/app"), import("firebase/firestore")]);
        const app = initializeApp(firebaseConfig, "human-ears");
        return { app, db: fs.getFirestore(app), fs };
      } catch (e) {
        console.warn("[Human Ears] leaderboard unavailable", e);
        base = null;
        return null;
      }
    })();
  }
  return base;
}

let authed: Promise<{ auth: Auth; uid: string } | null> | null = null;
/** Sign in anonymously. Only called for players who joined the board. */
function signIn() {
  if (!authed) {
    authed = (async () => {
      const b = await open();
      if (!b) return null;
      try {
        const a = await import("firebase/auth");
        const auth = a.getAuth(b.app);
        await a.setPersistence(auth, a.browserLocalPersistence).catch(() => {});
        await auth.authStateReady();
        const user = auth.currentUser ?? (await a.signInAnonymously(auth)).user;
        return { auth, uid: user.uid };
      } catch (e) {
        console.warn("[Human Ears] sign-in failed", e);
        authed = null;
        return null;
      }
    })();
  }
  return authed;
}

export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

const scores = (b: { db: Firestore; fs: FS }, game: string) => b.fs.collection(b.db, "earsBoards", game, "scores");

/** Save your best on a game's board (keeps the higher of old and new). */
export async function submit(game: string, name: string, level: number, streak: number): Promise<boolean> {
  const n = cleanName(name);
  if (!n || (level < 1 && streak < 1)) return false;
  const [b, me] = await Promise.all([open(), signIn()]);
  if (!b || !me) return false;
  const ref = b.fs.doc(scores(b, game), me.uid);
  try {
    let lv = Math.min(99, Math.floor(level));
    let st = Math.min(K - 1, Math.max(0, Math.floor(streak)));
    const old = await b.fs.getDoc(ref);
    if (old.exists()) {
      const o = old.data() as { level: number; streak: number; name: string };
      lv = Math.max(lv, o.level);
      st = Math.max(st, o.streak);
      if (lv === o.level && st === o.streak && o.name === n) return true; // nothing new
    }
    await b.fs.setDoc(ref, { name: n, level: lv, streak: st, rank: lv * K + st, updatedAt: b.fs.serverTimestamp() });
    return true;
  } catch (e) {
    console.warn("[Human Ears] submit failed", e);
    return false;
  }
}

/** The top of a game's board. With `joined`, also your own place (1-based). */
export async function top(game: string, n: number, joined: boolean): Promise<{ rows: Entry[]; me: string | null; myPlace: number | null } | null> {
  const b = await open();
  if (!b) return null;
  const { fs } = b;
  try {
    const snap = await fs.getDocs(fs.query(scores(b, game), fs.orderBy("rank", "desc"), fs.limit(n)));
    if (snap.metadata.fromCache) return null; // the server couldn't be reached: offline, not an empty board
    const rows = snap.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, name: String(x.name), level: Number(x.level), streak: Number(x.streak) };
    });
    const me = joined ? (await signIn())?.uid ?? null : null;
    let myPlace: number | null = null;
    if (me) {
      const i = rows.findIndex((r) => r.uid === me);
      if (i >= 0) myPlace = i + 1;
      else {
        const d = await fs.getDoc(fs.doc(scores(b, game), me));
        if (d.exists()) myPlace = (await fs.getCountFromServer(fs.query(scores(b, game), fs.where("rank", ">", Number(d.data().rank))))).data().count + 1;
      }
    }
    return { rows, me, myPlace };
  } catch (e) {
    console.warn("[Human Ears] board read failed", e);
    return null;
  }
}

/** Leave every board: delete your entries, then the anonymous sign-in itself.
 *  Never signs in: with no earlier sign-in in this browser there is nothing to delete.
 *  "left", "none" (never joined here), or false (offline or failed). */
export async function leaveAll(): Promise<"left" | "none" | false> {
  const b = await open();
  if (!b) return false;
  try {
    const a = await import("firebase/auth");
    const auth = a.getAuth(b.app);
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return "none";
    // Offline, a delete would wait for the server forever: give up after a while instead.
    const deletes = Promise.all(GAME_IDS.map((g) => b.fs.deleteDoc(b.fs.doc(scores(b, g), user.uid))));
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 10_000));
    await Promise.race([deletes, timeout]);
    await user.delete().catch(() => a.signOut(auth));
    authed = null;
    return "left";
  } catch (e) {
    console.warn("[Human Ears] leave failed", e);
    return false;
  }
}

// Dev builds only (removed from the published site): lets tests clean up their entry.
if (import.meta.env && import.meta.env.DEV)
  (globalThis as unknown as { __board: unknown }).__board = { leaveAll, top: (g: string) => top(g, 5, true) };
