// legal.ts: the Privacy, Terms and Credits pages (#/privacy, #/terms, #/credits).
// Plain language, short sections. Keep them true to what the code does:
// if the site starts storing or sending something new, say so here.

import { boardJoined, setBoardJoined, clearLocalData } from "./lib/stats";

export const DOCS = { privacy: "Privacy", terms: "Terms", credits: "Credits" } as const;
export type Doc = keyof typeof DOCS;

const UPDATED = "23 November 2026";
const REPO = "https://github.com/egsvi2508-debug/smartear-memory";
const CONTACT = `${REPO}/issues`;

const h = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
/** A paragraph; [text](url) becomes a link. */
function p(text: string) {
  const el = document.createElement("p");
  text.split(/(\[[^\]]+\]\([^)]+\))/).forEach((part) => {
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) return el.append(part);
    const a = Object.assign(document.createElement("a"), { textContent: m[1], href: m[2] });
    if (/^https?:/.test(m[2])) Object.assign(a, { target: "_blank", rel: "noopener" });
    el.append(a);
  });
  return el;
}
const list = (items: string[]) => {
  const ul = document.createElement("ul");
  items.forEach((t) => {
    const li = document.createElement("li");
    li.append(...p(t).childNodes);
    ul.append(li);
  });
  return ul;
};

function privacy(body: HTMLElement) {
  body.append(
    p("Human Ears has no accounts, no ads, no analytics and no cookies. Your settings and scores stay in your browser unless you choose to join the leaderboard."),
    h("h2", "Who runs this site"),
    p(`Human Ears is a free, non-commercial hobby project published by the GitHub user egsvi2508-debug. For any privacy question or request, [open an issue on GitHub](${CONTACT}).`),
    h("h2", "Stored on your device"),
    p("Your browser's local storage keeps: your settings (keys, speed, volumes, music on or off), your level, best level, best streak and rounds for each game, and, if you join the board, your board name. This never leaves your device on its own. You can delete it below at any time."),
    h("h2", "The leaderboard (only if you join)"),
    p("Anyone can look at the top players. To show them, your browser loads the board from Google Firebase (Cloud Firestore, run by Google Ireland Ltd. and Google LLC), which, like any server, sees your IP address. That does not sign you in or store anything about you. If you tap Join the board, Firebase (Authentication and Cloud Firestore) is also used to:"),
    list([
      "sign you in anonymously: a random ID, with no email, password or account,",
      "store, under that ID, the name you chose and your best level and best streak for each game, with the time of the last update. These are shown publicly on the board and kept until you leave it.",
    ]),
    p("To provide this, Google processes your IP address and basic device information, possibly in the USA (Google is certified under the EU-US Data Privacy Framework). Joining is based on your consent (Art. 6(1)(a) GDPR); showing the board to visitors is based on our legitimate interest in running the game (Art. 6(1)(f)). You can withdraw at any time with Leave the board below: it deletes your entries and the anonymous sign-in. See [Firebase privacy](https://firebase.google.com/support/privacy)."),
    h("h2", "Hosting"),
    p("The site is hosted on GitHub Pages (GitHub, Inc.). Like any web server, it receives your IP address when your browser loads a page, and may keep it in security logs. See the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The music, piano sounds and fonts are all served from this site. The only other company your browser contacts is Google, for the leaderboard (see above)."),
    h("h2", "Your rights"),
    p("Under the GDPR you can ask to see, correct or delete your data, object to its use, and complain to a data protection authority. Most of it you can do yourself, right here:"),
  );
  const row = document.createElement("div");
  row.className = "doc-actions";
  const status = Object.assign(document.createElement("p"), { className: "doc-status" });
  const btn = (label: string, run: () => Promise<string>) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "doc-btn", textContent: label });
    b.addEventListener("click", async () => {
      b.disabled = true;
      status.textContent = "Working…";
      status.textContent = await run().catch(() => "Something went wrong. Check your connection and try again.");
      b.disabled = false;
    });
    return b;
  };
  /** true when entries were deleted, false when there were none from this browser. */
  const leave = async () => {
    const { leaveAll } = await import("./lib/board");
    const r = await leaveAll();
    if (!r) throw new Error("leave failed");
    setBoardJoined(false);
    return r === "left";
  };
  row.append(
    btn("Leave the board", async () =>
      (await leave()) ? "Done. Your entries and anonymous sign-in are deleted." : "Nothing to delete: this browser never joined the board.",
    ),
    btn("Delete all my data", async () => {
      if (!confirm("Delete your settings, levels and scores on this device, and leave the board?")) return "Nothing was deleted.";
      await leave();
      clearLocalData();
      return "Done. Everything is deleted. Reload the page for a fresh start.";
    }),
  );
  body.append(row, status);
  if (!boardJoined()) status.textContent = "You haven't joined the board in this browser.";
  body.append(
    h("h2", "Children"),
    p("You don't need to give any personal information to play. On the board, please use a nickname, not your real name."),
    h("h2", "Changes"),
    p("If this policy changes, the date at the top changes with it."),
  );
}

function terms(body: HTMLElement) {
  body.append(
    p("Human Ears is a free set of ear training games. By using it you agree to these terms."),
    h("h2", "Use it for fun and practice"),
    p("The games are provided as they are, without any guarantee that they are error-free or always available. They may change or stop at any time."),
    h("h2", "Protect your hearing"),
    p("Keep the volume at a comfortable level, especially with headphones."),
    h("h2", "Fair play on the board"),
    list([
      "Play yourself: no bots, scripts or edited scores.",
      "Pick a name that is not offensive and does not pretend to be someone else.",
      "Entries that break these rules can be removed without notice.",
    ]),
    p("By joining the board you allow your chosen name and best scores to be shown publicly. You can leave at any time on the [Privacy page](#/privacy)."),
    h("h2", "The music"),
    p("All background music is CC0 (public domain): you may use it in your own videos and reels, no credit needed. Other parts of the site have their own licences, listed on the [Credits page](#/credits)."),
    h("h2", "Liability"),
    p("To the extent the law allows, the publisher is not liable for any loss arising from use of the site. Nothing here limits liability that cannot be limited by law, such as for intent or gross negligence."),
    h("h2", "Contact"),
    p(`Questions or problems: [open an issue on GitHub](${CONTACT}).`),
  );
}

function credits(body: HTMLElement) {
  const oga = "https://opengameart.org/content/";
  body.append(
    h("h2", "Music (CC0, public domain)"),
    p("Free to use anywhere, including your videos. No credit required, but the artists deserve it:"),
    list([
      `Holizna: [Retro Wave](${oga}retro-wave-collection), [Gamer Beats](${oga}gamer-beats-collection), [Funk](${oga}funk-collection), [Happy Pop Electronic](${oga}happy-pop-electronic-collection), [Lo-Fi and Chill](${oga}lo-fi-and-chill-collection), [Happy Lo-Fi](${oga}happy-lo-fi-lofi-collection), [Chill Beats](${oga}chill-beats-collection), [Sad Lo-Fi](${oga}sad-lo-fi-lofi-collectioni). [Support Holizna](https://www.buymeacoffee.com/holizna)`,
      `TAD: [lofi Compilation](${oga}lofi-compilation)`,
      `Umplix: [Dance Music Pack](${oga}dance-music-pack)`,
      `Rami99: [Piano hip hop tune](${oga}piano-hip-hop-tune)`,
      `Fupi: [Funky Disco Beats to Boogie/Woogie to](${oga}funky-disco-beats-to-boogiewoogie-to)`,
    ]),
    p("The files were re-encoded and their volume levelled; the music itself is unchanged."),
    h("h2", "Piano"),
    p("[Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Samples as prepared by the Tone.js project, unchanged."),
    h("h2", "Fonts"),
    list(["Work Sans and Space Mono: SIL Open Font License 1.1", "Bravura (music notation, via VexFlow): SIL Open Font License 1.1"]),
    h("h2", "Software"),
    list(["[Tone.js](https://tonejs.github.io): MIT License", "[VexFlow](https://www.vexflow.com): MIT License", "[Firebase JavaScript SDK](https://github.com/firebase/firebase-js-sdk): Apache License 2.0", "[Vite](https://vite.dev) and TypeScript: MIT and Apache 2.0"]),
    h("h2", "This site"),
    p(`Built from the SmartEar ear training games. Source code: [GitHub](${REPO}).`),
  );
}

export function renderDoc(app: HTMLElement, kind: Doc) {
  const main = document.createElement("main");
  main.className = "doc";
  const back = Object.assign(document.createElement("a"), { href: "#/", className: "doc-back", textContent: "← Games" });
  const title = h("h1", kind === "privacy" ? "Privacy" : kind === "terms" ? "Terms of use" : "Credits");
  const meta = Object.assign(h("div", kind === "credits" ? "Thank you to everyone who made this possible." : `Last updated ${UPDATED}`), { className: "doc-meta" });
  const body = document.createElement("div");
  body.className = "doc-body";
  ({ privacy, terms, credits })[kind](body);
  main.append(back, title, meta, body);
  app.append(main);
}
