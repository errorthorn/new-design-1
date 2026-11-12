// lib/speaking-club/pronunciation-rules.ts
//
// RULE-BASED pronunciation checking. Pure functions: the dictionary is passed in, so nothing here touches the
// network, a model or the database (the server loads the dictionary in lib/speaking-club/pronunciation-dict.ts).
//
// Why it exists: the model that listens to the student's audio only WRITES DOWN words it thought were pronounced
// wrongly, and a language model can be wrong or vague about that. Every note is therefore checked against the CMU
// Pronouncing Dictionary (standard American pronunciation of ~124,000 English words):
//   - if the model said what it heard ("sink" for "think") and both are dictionary words, the two pronunciations are
//     compared sound by sound; the DIFFERENCE decides the sound label ("th /θ/ → /s/"), not the model's wording;
//     a note whose two words sound the same is rejected as false;
//   - if what was heard is not a dictionary word, the model's claim is only kept when it is possible for that word
//     (a "th" problem in a word with no th sound is rejected; a "word stress" problem needs two or more syllables);
//   - the correct pronunciation (/θɪŋk/) and the practice tip come from tables here, never from the model.
// Notes that cannot be checked at all stay visible but are marked "unverified" and never count toward the estimate.
import { parseNote, type ParsedNote } from "@/lib/speaking-club/pronunciation-notes";

export type Dict = Readonly<Record<string, string>>;
export type NoteStatus = "confirmed" | "plausible" | "unverified";
export type VerifiedNote = {
  word: string;
  heard: string;
  /** Group label: the sound the student got wrong ("th /θ/", "word stress", "final sound", ...). */
  sound: string;
  /** What the student's sound was instead, when it could be worked out ("/s/"). */
  saidAs: string;
  /** Standard pronunciation of the word, e.g. "/θɪŋk/" (American, from the dictionary). */
  correct: string;
  /** Rule-based practice tip for this sound. */
  tip: string;
  /** What the model wrote about it (kept for context). */
  note: string;
  status: NoteStatus;
};

const OTHER = "Other";
const NOT_VERIFIED = "Not verified";

// ---- ARPAbet -> IPA / labels ------------------------------------------------

const IPA: Record<string, string> = {
  AA: "ɑː", AE: "æ", AH: "ʌ", AO: "ɔː", AW: "aʊ", AY: "aɪ", B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "e", ER: "ɜːr",
  EY: "eɪ", F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "iː", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", OW: "oʊ",
  OY: "ɔɪ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "uː", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};
const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
const STOPS_FRIC = new Set(["P", "B", "T", "D", "K", "G", "F", "V", "TH", "SH"]);

/** Group label for a sound the student got wrong, keyed by the phoneme the word SHOULD have. */
const LABEL: Record<string, string> = {
  TH: "th /θ/", DH: "th /ð/", R: "/r/", L: "/l/", V: "/v/", W: "/w/", S: "/s/", Z: "/z/", SH: "/ʃ/", ZH: "/ʒ/", CH: "/tʃ/",
  JH: "/dʒ/", NG: "/ŋ/", F: "/f/", T: "/t/", D: "/d/", K: "/k/", G: "/ɡ/", P: "/p/", B: "/b/", HH: "/h/", M: "/m/", N: "/n/", Y: "/j/",
  IH: "/ɪ/", IY: "/iː/", EH: "/e/", AE: "/æ/", AA: "/ɑː/", AO: "/ɔː/", UH: "/ʊ/", UW: "/uː/", AH: "/ʌ/ /ə/", ER: "/ɜːr/",
  EY: "/eɪ/", AY: "/aɪ/", OW: "/oʊ/", OY: "/ɔɪ/", AW: "/aʊ/",
};

/** Practice tips (the physical rule for making each sound). Rule tables, not model output. */
const TIP: Record<string, string> = {
  TH: "Put the tip of your tongue lightly between your teeth and push air out, with no voice. Don't use /s/, /t/ or /f/. Practise: think–sink, three–tree.",
  DH: "Tongue in the same place as /θ/ (between the teeth) but switch your voice on: you should feel a buzz. Don't use /d/ or /z/. Practise: this, that, then.",
  R: "Curl the tongue back without touching the roof of the mouth and round your lips a little. Don't tap or roll it, and don't use /l/ or /w/. Practise: right–light, red–led.",
  L: "Touch the tip of the tongue to the ridge just behind your top teeth and let the voice flow around the sides. Practise: light–right, lake–rake.",
  V: "Touch your top teeth to your lower lip and add voice. Not /b/ and not /w/. Practise: very–berry, vine–wine.",
  W: "Round your lips (like 'oo') and open them quickly; your teeth should not touch your lip. Not /v/. Practise: west–vest, wine–vine.",
  S: "Tongue just behind the top teeth, push air, no voice. Say /s/ and /z/ by feeling the buzz: /z/ has voice, /s/ has none.",
  Z: "Same tongue place as /s/ but with voice: you should feel a buzz in your throat. Practise: zoo–sue, buzz–bus.",
  SH: "Round your lips a little, pull the tongue back and let air flow continuously. Not /s/ or /tʃ/. Practise: she–see, ship–sip.",
  ZH: "Same mouth shape as /ʃ/ (sh) but with voice. Practise: vision, measure.",
  CH: "Stop the air with the tongue at the ridge, then release it into /ʃ/. Practise: chair–share, cheap–sheep.",
  JH: "Like /tʃ/ (ch) but with voice. Practise: jam–yam, joke–choke.",
  NG: "Back of the tongue touches the soft palate and the air goes through the nose. Don't change it to /n/ and don't add /ɡ/ after it. Practise: sing–sin.",
  F: "Top teeth on the lower lip and push air, no voice. Not /p/ or /θ/. Practise: fan–pan, free–three.",
  P: "Close both lips, then release a small burst of air (stronger at the start of a word).",
  T: "Tongue tip on the ridge behind the top teeth, then release a small burst of air.",
  K: "Back of the tongue against the soft palate, then release a small burst of air.",
  B: "Close both lips and release the air with voice.",
  D: "Tongue tip on the ridge behind the top teeth, release with voice.",
  G: "Back of the tongue against the soft palate, release with voice.",
  HH: "A light breath from the throat. Don't drop it at the start of a word (except 'hour', 'honest').",
  M: "Close both lips and hum through the nose.",
  N: "Tongue tip on the ridge behind the top teeth and hum through the nose.",
  Y: "Start with the tongue high, as for 'ee', and glide into the next vowel.",
  IH: "Short, relaxed /ɪ/: lips loose and the mouth only slightly open. 'sit', not 'seat'.",
  IY: "Long /iː/: lips spread, tongue high, hold it a little longer. 'seat', not 'sit'.",
  EH: "/e/: mouth half open, tongue in the middle. 'bed'.",
  AE: "/æ/: mouth wide open, tongue low and forward. 'cat', not 'cut'.",
  AA: "/ɑː/: mouth wide open, tongue low and back. 'father'.",
  AO: "/ɔː/: lips rounded, tongue low-mid and back. 'thought'.",
  UH: "Short /ʊ/: lips slightly rounded, relaxed. 'book', not 'boot'.",
  UW: "Long /uː/: lips tightly rounded, hold it a little longer. 'food', not 'foot'.",
  AH: "/ʌ/ (stressed) or /ə/ (weak): relaxed mouth, short and quick. 'cup'.",
  ER: "Curl the tongue back while you say the vowel, with no separate /r/ at the end.",
  DIPHTHONG: "Glide smoothly from the first vowel sound to the second; don't flatten it into one sound.",
  "final sound": "Say the last sound of the word clearly and close the word with it (for example 'walked' ends in /t/). Dropping it can change the word.",
  "extra sound": "Don't add a vowel or consonant that is not in the word. Say only the sounds in the dictionary pronunciation, in order.",
  "dropped sound": "Say every sound in the word. Say it slowly first, one sound at a time, then speed up.",
  "word stress": "Say the stressed syllable louder, longer and higher; make the other syllables short and weak.",
};
const DIPHTHONGS = new Set(["EY", "AY", "OW", "OY", "AW"]);
const tipFor = (phoneme: string): string => TIP[DIPHTHONGS.has(phoneme) ? "DIPHTHONG" : phoneme] ?? "Listen to the word, then say it slowly, matching each sound.";

// ---- dictionary access -----------------------------------------------------

/** ARPAbet phonemes (with stress digits on vowels) for a word, or null when the word is not in the dictionary. */
export function phonemesOf(dict: Dict, word: string): string[] | null {
  const key = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!key) return null;
  const hit = dict[key];
  return hit ? hit.split(" ") : null;
}

const base = (p: string) => p.replace(/[0-9]/g, "");
const isVowel = (p: string) => VOWELS.has(base(p));

/** Syllables = vowels in the pronunciation. */
export function syllableCount(phonemes: readonly string[]): number {
  return phonemes.filter(isVowel).length;
}

/**
 * IPA for a word, e.g. /θɪŋk/ or /fəˈtɑːɡrəfi/. The stress mark goes before the stressed syllable's consonants.
 * American (CMU) pronunciation, approximate syllable breaks.
 */
export function toIpa(phonemes: readonly string[]): string {
  const poly = syllableCount(phonemes) > 1;
  let out = "";
  const marks = new Map<number, string>(); // phoneme index -> mark placed BEFORE it
  if (poly) {
    phonemes.forEach((p, i) => {
      const stress = /[12]$/.exec(p)?.[0];
      if (!stress || !isVowel(p)) return;
      // onset = the consonants since the previous vowel
      let start = i;
      while (start > 0 && !isVowel(phonemes[start - 1])) start--;
      const onset = phonemes.slice(start, i).map(base);
      let take = Math.min(onset.length, 1);
      if (onset.length >= 2) {
        const [a, b, c] = onset.slice(-3);
        const last = onset[onset.length - 1];
        if (onset.length >= 3 && a === "S" && ["P", "T", "K"].includes(b) && ["R", "L", "W"].includes(c)) take = 3;
        else if (onset.length >= 2 && onset[onset.length - 2] === "S" && ["P", "T", "K", "M", "N", "L", "W", "F"].includes(last)) take = 2;
        else if (["R", "L", "W", "Y"].includes(last) && STOPS_FRIC.has(onset[onset.length - 2])) take = 2;
      }
      const at = i - take;
      if (!marks.has(at)) marks.set(at, stress === "1" ? "ˈ" : "ˌ");
    });
  }
  phonemes.forEach((p, i) => {
    out += marks.get(i) ?? "";
    const b = base(p);
    const stress = /[0-9]$/.exec(p)?.[0];
    if (b === "AH") out += stress === "0" ? "ə" : "ʌ";
    else if (b === "ER") out += stress === "0" ? "ɚ" : "ɜːr";
    else out += IPA[b] ?? b.toLowerCase();
  });
  return `/${out}/`;
}

// ---- alignment (sound-by-sound comparison) ------------------------------------

type Diff = { kind: "sub" | "del" | "ins"; expected?: string; said?: string; index: number; finalPos: boolean };

/** Levenshtein alignment on phonemes (stress ignored); returns the differences, in word order. */
function diffPhonemes(expected: readonly string[], heard: readonly string[]): Diff[] {
  const e = expected.map(base);
  const h = heard.map(base);
  const n = e.length;
  const m = h.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (e[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  const out: Diff[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (e[i - 1] === h[j - 1] ? 0 : 1)) {
      if (e[i - 1] !== h[j - 1]) out.push({ kind: "sub", expected: e[i - 1], said: h[j - 1], index: i - 1, finalPos: i === n });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ kind: "del", expected: e[i - 1], index: i - 1, finalPos: i === n });
      i--;
    } else {
      out.push({ kind: "ins", said: h[j - 1], index: i, finalPos: false });
      j--;
    }
  }
  return out.reverse();
}

const ipaOf = (p?: string) => (p ? `/${IPA[p] ?? p.toLowerCase()}/` : "");

/** The label for one difference ("th /θ/", "final sound", "extra sound", "dropped sound") and the tip key. */
function describeDiff(df: Diff): { label: string; tipKey: string; saidAs: string } {
  if (df.kind === "ins") return { label: "extra sound", tipKey: "extra sound", saidAs: ipaOf(df.said) };
  const exp = df.expected as string;
  if (df.kind === "del") {
    if (df.finalPos && !VOWELS.has(exp)) return { label: "final sound", tipKey: "final sound", saidAs: "" };
    return { label: LABEL[exp] ?? "dropped sound", tipKey: LABEL[exp] ? exp : "dropped sound", saidAs: "" };
  }
  return { label: LABEL[exp] ?? OTHER, tipKey: exp, saidAs: ipaOf(df.said) };
}

// ---- verifying one note -----------------------------------------------------

/** IPA symbols written in a model label ("th /θ/", "/ɪ/ vs /iː/") -> ARPAbet phonemes they refer to. */
const IPA_TO_ARPA: Record<string, string[]> = Object.entries(IPA).reduce((acc, [arpa, ipa]) => {
  (acc[ipa] ??= []).push(arpa);
  return acc;
}, {} as Record<string, string[]>);
IPA_TO_ARPA["ɛ"] = ["EH"];
IPA_TO_ARPA["i"] = ["IY"];
IPA_TO_ARPA["u"] = ["UW"];
IPA_TO_ARPA["ə"] = ["AH"];
IPA_TO_ARPA["ɜː"] = ["ER"];
IPA_TO_ARPA["ɑ"] = ["AA"];
IPA_TO_ARPA["ɔ"] = ["AO"];
IPA_TO_ARPA["g"] = ["G"];

function claimedPhonemes(label: string): string[] {
  const out: string[] = [];
  for (const m of label.matchAll(/\/([^/]+)\//g)) out.push(...(IPA_TO_ARPA[m[1]] ?? []));
  return out;
}

/**
 * Checks one note from the listening model. Returns null when the note is wrong (rejected), otherwise the note with
 * its rule-based label, correct pronunciation and tip, and a status:
 *   confirmed  - what was heard is a different dictionary word and the two differ in the way the label says
 *   plausible  - what was heard is not a dictionary word, but the claimed problem is possible in this word
 *   unverified - the word is unknown to the dictionary or the note has no usable claim: shown, never counted
 */
export function verifyNote(dict: Dict, raw: ParsedNote): VerifiedNote | null {
  const word = raw.word.trim();
  const expected = phonemesOf(dict, word);
  const heardWord = raw.heard.replace(/^[/'"“”\s]+|[/'"“”\s]+$/g, "");
  const claimedLabel = raw.sound && raw.sound !== OTHER ? raw.sound : "";
  const mk = (over: Partial<VerifiedNote>): VerifiedNote => ({
    word, heard: heardWord, sound: OTHER, saidAs: "", correct: expected ? toIpa(expected) : "", tip: "", note: raw.note, status: "unverified", ...over,
  });

  if (!expected) return mk({ sound: NOT_VERIFIED, status: "unverified" });
  if (heardWord && heardWord.toLowerCase() === word.toLowerCase()) return null; // "heard X" with X the same word: nothing wrong

  // 1) what was heard is another dictionary word: compare the sounds
  const heardPh = heardWord ? phonemesOf(dict, heardWord) : null;
  const diffs = heardPh ? diffPhonemes(expected, heardPh) : [];
  if (heardPh && diffs.length === 0) return null; // the two words sound the same: the note is false
  // A mispronunciation is a SMALL change (one or two sounds). A word that differs more is simply a different word,
  // so it says nothing about how this one was pronounced: fall through to the claim check below.
  if (heardPh && diffs.length <= 2) {
    const described = diffs.map(describeDiff);
    const claimed = new Set(claimedPhonemes(claimedLabel));
    const pick = diffs.findIndex((df) => df.expected && claimed.has(df.expected));
    const chosen = described[pick >= 0 ? pick : 0];
    return mk({ sound: chosen.label, saidAs: chosen.saidAs, tip: TIP[chosen.tipKey] ?? tipFor(chosen.tipKey), status: "confirmed" });
  }

  // 2) not a dictionary word: only keep a claim that is possible for THIS word
  const claim = claimedLabel.toLowerCase();
  if (claim === "word stress") {
    if (syllableCount(expected) < 2) return null;
    return mk({ sound: "word stress", tip: `${TIP["word stress"]} Say it as ${toIpa(expected)}.`, status: "plausible" });
  }
  if (claim === "final sound") {
    const last = base(expected[expected.length - 1]);
    if (VOWELS.has(last) && syllableCount(expected) < 2) return null;
    return mk({ sound: "final sound", tip: TIP["final sound"], status: "plausible" });
  }
  if (claim === "extra sound" || claim === "dropped sound") return mk({ sound: claim, tip: TIP[claim], status: "plausible" });
  const wanted = claimedPhonemes(claimedLabel);
  if (wanted.length > 0) {
    const present = wanted.find((p) => expected.map(base).includes(p));
    if (!present) return null; // e.g. a "th" problem in a word that has no th sound
    return mk({ sound: LABEL[present] ?? claimedLabel, tip: tipFor(present), status: "plausible" });
  }
  return mk({ sound: NOT_VERIFIED, status: "unverified" });
}

/** Parses and checks every note; also reports how many were rejected as wrong. Duplicates (same word + sound) are dropped. */
export function analyzeNotes(dict: Dict, lines: readonly string[]): { notes: VerifiedNote[]; rejected: number } {
  const notes: VerifiedNote[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const line of lines) {
    const parsed = parseNote(line);
    if (!parsed) continue;
    const v = verifyNote(dict, parsed);
    if (!v) {
      rejected++;
      continue;
    }
    const key = `${v.word.toLowerCase()}|${v.sound.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(v);
  }
  return { notes, rejected };
}

export type PronunciationGroup = { sound: string; words: VerifiedNote[] };

/** Groups checked notes by sound, biggest first; "unverified" ones last. */
export function groupVerified(notes: readonly VerifiedNote[]): PronunciationGroup[] {
  const map = new Map<string, PronunciationGroup>();
  for (const n of notes) {
    const g = map.get(n.sound) ?? { sound: n.sound, words: [] };
    g.words.push(n);
    map.set(n.sound, g);
  }
  const weak = (s: string) => s === NOT_VERIFIED || s === OTHER;
  return [...map.values()].sort((a, b) => (weak(a.sound) !== weak(b.sound) ? (weak(a.sound) ? 1 : -1) : b.words.length - a.words.length));
}
