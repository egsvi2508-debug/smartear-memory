// names.ts: keep public leaderboard names clean. Catches common profanity
// and slurs, including simple disguises (l33t letters, repeats, dots and
// spaces between letters). Not perfect; the owner can still delete an entry
// in the Firebase console.

const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "bastard", "dick", "cock", "pussy", "penis", "vagina", "tits",
  "slut", "whore", "porn", "sex", "rape", "nazi", "hitler", "nigg", "nigga", "fag", "retard",
  "spic", "chink", "kike", "tranny", "wank", "twat", "asshole", "arse", "anal", "cum", "jizz", "dildo",
  "milf", "hentai", "isis", "pedo", "molest", "suicide", "killyourself", "kys",
];
// Words that contain a blocked piece but are fine.
const ALLOWED = ["scunthorpe", "dickens", "cocktail", "peacock", "hancock", "sussex", "essex", "analys", "cumbria", "document", "circum", "cucumber", "arsenal", "shitake", "therapist", "grape", "drape", "spice", "spicy", "assessment", "nigel", "analis",
  "mississippi", "dickson", "dickinson", "hitchcock", "analog", "sextant", "sexton", "cumberbatch", "cumberland", "cumulus", "accum"];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/v/g, "u")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** Why a name can't be used, or null when it's fine. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 20) return "Keep it to 20 characters.";
  if (/[<>\u0000-\u001f]/.test(name)) return "Letters, numbers and simple symbols only.";
  if (/k\W*k\W*k/i.test(name)) return "That name isn't allowed. Pick another one.";
  // Checked before letters are de-doubled below, which would turn it into "bob" and block every Bob.
  if (/b\W*[o0]\W*[o0]+\W*b/i.test(name)) return "That name isn't allowed. Pick another one.";
  let n = normalize(name);
  for (const ok of ALLOWED) n = n.split(normalize(ok)).join("");
  if (BLOCKED.some((w) => n.includes(normalize(w)))) return "That name isn't allowed. Pick another one.";
  return null;
}
