// Text matching shared by the transcript formatter, the sheet checks and the item matcher. Pure.
// Hindi and Hinglish are first-class here: normalisation keeps Devanagari letters and digits, and
// the number words cover both scripts, because "dhai lakh" is a number even though it has no digit.

/** NFC, lowercase, punctuation removed (letters and digits of any script kept), single spaces. */
export function normaliseText(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokensOf(value: string): string[] {
  const n = normaliseText(value);
  return n ? n.split(" ") : [];
}

/** Levenshtein distance; small strings only (names and short token lists). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 1 : (total - editDistance(a, b)) / total;
}

/**
 * Token-set ratio in [0, 1], the fuzzywuzzy idea: shared tokens count fully, so "Rakesh ji" and
 * "Rakesh Sharma" score 0.8 while "Speaker 2" and "Priya Nair" score near 0.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(tokensOf(a));
  const tb = new Set(tokensOf(b));
  if (!ta.size || !tb.size) return 0;
  const shared = [...ta].filter((t) => tb.has(t)).sort().join(" ");
  const onlyA = [...ta].filter((t) => !tb.has(t)).sort().join(" ");
  const onlyB = [...tb].filter((t) => !ta.has(t)).sort().join(" ");
  const t1 = [shared, onlyA].filter(Boolean).join(" ");
  const t2 = [shared, onlyB].filter(Boolean).join(" ");
  if (!shared) return ratio(t1, t2);
  return Math.max(ratio(shared, t1), ratio(shared, t2), ratio(t1, t2));
}

/** Share of `needle`'s tokens that occur in `haystack` (0 when the needle is empty). */
export function tokenOverlap(needle: string, haystack: string): number {
  const n = tokensOf(needle);
  if (!n.length) return 0;
  const h = new Set(tokensOf(haystack));
  return n.filter((t) => h.has(t)).length / n.length;
}

/** Best fuzzy match of `label` among `candidates`, or null below the threshold. */
export function bestMatch<T>(label: string, candidates: T[], nameOf: (c: T) => string | null | undefined, threshold = 0.8): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const name = nameOf(c);
    if (!name) continue;
    const score = tokenSetRatio(label, name);
    if (score >= threshold && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Number words in English, Hinglish (Latin script) and Hindi (Devanagari), for money and quantity checks. */
export const NUMBER_WORDS = new Set([
  // English
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "half", "quarter", "dozen", "percent", "lakh", "lakhs", "lac", "lacs", "crore", "crores",
  // Hinglish
  "ek", "do", "teen", "char", "chaar", "paanch", "panch", "chhe", "che", "saat", "aath", "nau", "das", "dus", "gyarah", "barah", "pandrah", "bees", "pachees", "tees", "chalis", "pachas", "pachaas", "saath", "sattar", "assi", "nabbe", "sau", "hazaar", "hazar", "hajaar", "hajar", "dhai", "adha", "aadha", "saade", "sadhe", "pauna", "sawa", "dedh", "derh", "guna",
  // Devanagari
  "एक", "दो", "तीन", "चार", "पाँच", "पांच", "छह", "छे", "सात", "आठ", "नौ", "दस", "बीस", "पचास", "सौ", "हज़ार", "हजार", "लाख", "करोड़", "करोड", "ढाई", "साढ़े", "आधा", "डेढ़", "प्रतिशत",
]);

/** True when the text carries a digit (Latin or Devanagari) or a number word in any of the three forms. */
export function hasNumber(value: string): boolean {
  if (/[0-9०-९]/.test(value)) return true;
  return tokensOf(value).some((t) => NUMBER_WORDS.has(t));
}

const DEVANAGARI = /[ऀ-ॿ]/g;
const LETTERS = /\p{L}/gu;

/** Words that mark Hinglish when written in Latin script. Kept short and common on purpose. */
export const HINGLISH_WORDS = new Set([
  "hai", "hain", "nahi", "nahin", "kar", "karna", "karo", "karenge", "kiya", "theek", "thik", "haan", "bhai", "ji", "kal", "parso", "lakh", "crore", "aaj", "abhi", "kyun", "kya", "kaise", "kab", "yeh", "woh", "toh", "aur", "lekin", "matlab", "bilkul", "zaroor", "jaldi", "dekho", "bata", "batao", "bhejo", "bhej", "milega", "chahiye", "hoga", "hogi", "raha", "rahi", "tha", "thi", "mein", "humne", "aapne", "unka", "hamara", "apna", "sab", "bahut", "accha", "acha", "samajh", "pata", "wala", "wale", "tak", "se", "ko", "ka", "ki", "ke", "par", "pe",
]);

export interface LanguageProfile {
  hint: "english" | "hindi" | "hinglish";
  devanagariShare: number;
  hinglishWordShare: number;
}

/** Quick language read from script and vocabulary, enough to tell the routine what to expect. */
export function detectLanguage(text: string): LanguageProfile {
  const letters = text.match(LETTERS)?.length ?? 0;
  const devanagari = text.match(DEVANAGARI)?.length ?? 0;
  const devanagariShare = letters ? devanagari / letters : 0;
  // Only Latin-script tokens count for the Hinglish word share; Devanagari is already counted above.
  const latinTokens = tokensOf(text).filter((t) => /^[a-z]+$/.test(t));
  const hinglishWordShare = latinTokens.length ? latinTokens.filter((t) => HINGLISH_WORDS.has(t)).length / latinTokens.length : 0;
  let hint: LanguageProfile["hint"] = "english";
  if (devanagariShare >= 0.5) hint = "hindi";
  else if (devanagariShare >= 0.05 || hinglishWordShare >= 0.08) hint = "hinglish";
  return { hint, devanagariShare: round(devanagariShare), hinglishWordShare: round(hinglishWordShare) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
