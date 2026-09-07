/**
 * Lightweight language detection for code-mixed (Hinglish/Hindi+English) queries.
 *
 * Supports detection of:
 * - "en" (English only)
 * - "hi" (Hindi/Devanagari script only)
 * - "hinglish" (mixed Hindi romanized + English)
 * - "hi-en" (mixed Devanagari + English)
 * - "other" (unrecognized)
 *
 * This is NOT a full NLP language detector. It uses script-based heuristic
 * detection tuned for the Hinglish/Indian-language query patterns this system
 * is expected to handle.
 */

export type DetectedLanguage = "en" | "hi" | "hinglish" | "hi-en" | "other";

/** Unicode ranges for Devanagari script (Hindi, Sanskrit, Marathi, etc.). */
const DEVANAGARI_PATTERN = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F]/g;

/** Common Hindi/Hinglish words (romanized) used as auxiliary/stopword signals.
 *  Only words that are unambiguous Hindi/Hinglish markers are included - words
 *  that also appear as common English tokens ("the", "do", "de", "me", "men",
 *  "related", etc.) are EXCLUDED so pure-English queries never mis-detect. */
const HINDI_ROMAN_KEYWORDS = new Set([
  "kya", "kaise", "kyun", "kyon", "kis", "kaun", "kaunse", "kaunsi",
  "kitna", "kitne", "kab", "kahan", "kia",
  "hai", "hain", "tha", "thi", "ho", "hoga", "hogi", "honge",
  "karo", "karna", "kiya", "kiye",
  "se", "ke", "ki", "ka", "ko",
  "mein", "par", "pe", "ne",
  "wala", "wali", "wale", "walon",
  "aur", "ya", "lekin", "magar", "phir", "bhi", "sirf", "bas",
  "dikhao", "batao", "samjhao", "bataen", "sunao",
  "sabhi", "sab", "kuch", "koi", "har",
  "ye", "yeh", "vo", "wo", "yah", "vah",
  "ab", "tab", "tabse",
  "dikhao", "dikhaye",
  "nahi", "na", "mat",
  "kar", "ker", "karo",
  "chahiye", "samajh", "samjho",
  "dekh", "dekhao",
  "bata", "batao",
  "bol", "bolo",
  "le", "lo",
  "ja", "jao",
  "aa", "aao",
  "saath", "sath",
  "baare", "bare",
  "karte", "karta",
]);

/** Unambiguous Hindi/Hinglish markers. A single hit reliably flags a non-English query. */
const STRONG_HINDI_MARKERS = new Set([
  "kya", "kaise", "kyun", "kyon", "kaun", "kaunse", "kaunsi", "kis",
  "kitna", "kitne", "kab", "kahan",
  "batao", "dikhao", "samjhao", "bataen", "dikhaye", "sunao",
  "chahiye", "sabhi",
]);

/** Common Hinglish → English question-word translations. */
const HINGLISH_TO_ENGLISH: Record<string, string> = {
  "kya hai": "what is",
  "kya hain": "what are",
  "kya hai?": "what is",
  "kya hain?": "what are",
  "kya re": "what",
  "kya": "what",
  "kaise": "how",
  "kaise hai": "how is",
  "kyun": "why",
  "kyon": "why",
  "kis": "which",
  "kaun": "who",
  "kaunse": "which",
  "kaunsi": "which",
  "kitna": "how much",
  "kitne": "how many",
  "kab": "when",
  "kahan": "where",
  "ke requirements": "requirements of",
  "ki requirements": "requirements of",
  "ka requirement": "requirement of",
  "se related": "related to",
  "se kaun": "who is related to",
  "saath kaunse": "which are associated with",
  "ke saath kaunse": "which are associated with",
  "kis department": "which department",
  "ke saath": "related to",
  "se": "related to",
  "dikhao": "show",
  "dikhaye": "show",
  "dikha": "show",
  "batao": "tell me",
  "bataen": "tell me",
  "samjhao": "explain",
  "samjho": "explain",
  "sabhi employees": "all employees",
  "sabhi": "all",
  "chahiye": "want",
  "samajh": "understand",
  "sab": "all",
  "ke baare mein": "about",
  "ke bare mein": "about",
  "baare mein": "about",
  "bare mein": "about",
  "mein kaun kaam karta hai": "who works in",
  "mein kaun kaam karte hain": "who works in",
  "mein kaun kaam karta": "who works in",
  "mein kaun kaam karte": "who works in",
  "kaam karta hai": "works",
  "kaam karte hain": "work",
  "kahaan": "where",
  "saath": "related to",
};

/** Detect the language of a query string. */
export function detectLanguage(query: string): DetectedLanguage {
  const trimmed = query.trim();
  if (!trimmed) return "other";

  const hasDevanagari = DEVANAGARI_PATTERN.test(trimmed);
  const latinTokens = trimmed
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const hindiRomanCount = latinTokens.filter((t) =>
    HINDI_ROMAN_KEYWORDS.has(t.toLowerCase())
  ).length;
  const strongMarkerCount = latinTokens.filter((t) =>
    STRONG_HINDI_MARKERS.has(t.toLowerCase())
  ).length;

  const totalLatinTokens = latinTokens.length;
  const hindiRatio = totalLatinTokens > 0 ? hindiRomanCount / totalLatinTokens : 0;

  if (hasDevanagari && totalLatinTokens > 0) {
    return "hi-en";
  }
  if (hasDevanagari && totalLatinTokens === 0) {
    return "hi";
  }
  // A single unambiguous Hindi question word / imperative ("batao", "kya",
  // "kaise"...) reliably marks a Hinglish query even in short code-mixed text.
  if (strongMarkerCount > 0) {
    return "hinglish";
  }
  // Hinglish when Hindi markers are a meaningful fraction of the query, or
  // when there are at least 2 unambiguous Hindi words (covers short queries
  // like "kya hai" / "batao"). A single stray Hindi word amid long English
  // text stays English.
  if (hindiRomanCount >= 2 || (hindiRatio > 0.3 && hindiRomanCount > 0)) {
    return "hinglish";
  }
  return "en";
}

/** Check whether the detected language is non-English. */
export function isNonEnglish(lang: DetectedLanguage): boolean {
  return lang === "hinglish" || lang === "hi" || lang === "hi-en";
}

export { HINGLISH_TO_ENGLISH, HINDI_ROMAN_KEYWORDS };
