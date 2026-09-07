/**
 * Query normalization for code-mixed (Hinglish/Hindi+English) queries.
 *
 * Produces a normalized English semantic query suitable for vector embedding,
 * keyword search, and graph entity extraction, while preserving the original
 * query for UI display, logging, and Explainable RAG.
 *
 * Flow:
 *   "Remote Work Policy kya hai" →
 *     originalQuery: "Remote Work Policy kya hai"
 *     normalizedQuery: "What is the Remote Work Policy?"
 *     detectedLanguage: "hinglish"
 *
 * DO NOT modify document content. Only normalize query strings.
 */

import { detectLanguage, isNonEnglish, HINGLISH_TO_ENGLISH, type DetectedLanguage } from "./languageDetect.js";

export interface NormalizedQuery {
  originalQuery: string;
  normalizedQuery: string;
  detectedLanguage: DetectedLanguage;
}

/** Devanagari → romanized mappings for common Hindi words. */
const DEVANAGARI_TO_LATIN: Record<string, string> = {
  "क्या": "kya",
  "है": "hai",
  "हैं": "hain",
  "था": "tha",
  "थी": "thi",
  "थे": "the",
  "कैसे": "kaise",
  "क्यों": "kyun",
  "किस": "kis",
  "कौन": "kaun",
  "कौनसे": "kaunse",
  "कौनसी": "kaunsi",
  "कितना": "kitna",
  "कितने": "kitne",
  "कब": "kab",
  "कहाँ": "kahan",
  "कहां": "kahan",
  "में": "mein",
  "पर": "par",
  "से": "se",
  "के": "ke",
  "की": "ki",
  "का": "ka",
  "को": "ko",
  "ने": "ne",
  "और": "aur",
  "या": "ya",
  "लेकिन": "lekin",
  "फिर": "phir",
  "भी": "bhi",
  "सिर्फ": "sirf",
  "बस": "bas",
  "दिखाओ": "dikhao",
  "बताओ": "batao",
  "समझाओ": "samjhao",
  "सभी": "sabhi",
  "सब": "sab",
  "कुछ": "kuch",
  "कोई": "koi",
  "हर": "har",
  "यह": "yeh",
  "वह": "vah",
  "अब": "ab",
  "तब": "tab",
  "नहीं": "nahi",
  "रिलेटेड": "related",
  "वर्क": "work",
  "पॉलिसी": "policy",
  "रिमोट": "remote",
  "कर्मचारी": "employees",
  "विभाग": "department",
  "जुड़े": "related",
  "साथ": "saath",
  "बारे": "baare",
  "रिक्वायरमेंट्स": "requirements",
  "क्वालिफिकेशन": "qualification",
};

/**
 * Normalize a Hinglish/Hindi+English code-mixed query into an English semantic query.
 *
 * Steps:
 * 1. Detect language
 * 2. For Devanagari queries: transliterate key words
 * 3. Replace Hinglish question phrases with English equivalents
 * 4. Capitalize the first word (proper English question format)
 * 5. Remove trailing punctuation artifacts
 *
 * The normalized query is used for:
 * - Vector embedding (better cosine similarity with English document embeddings)
 * - Keyword search (cleaner terms, no Hindi stopwords)
 * - Graph entity extraction (unchanged - already works via capitalized runs)
 *
 * The original query is preserved for:
 * - UI display
 * - Logging / audit
 * - Explainable RAG trace
 * - Answer language selection
 */
export function normalizeQuery(query: string): NormalizedQuery {
  const detectedLanguage = detectLanguage(query);
  let normalized = query.trim();

  if (!isNonEnglish(detectedLanguage)) {
    return { originalQuery: query.trim(), normalizedQuery: normalized, detectedLanguage };
  }

  // Step 1: Transliterate Devanagari words to Latin
  if (detectedLanguage === "hi" || detectedLanguage === "hi-en") {
    normalized = transliterateDevanagari(normalized);
  }

  // Step 2: Apply Hinglish → English phrase replacements (longest match first)
  normalized = replaceHinglishPhrases(normalized);

  // Step 2a: Drop dangling Hindi auxiliaries that survive phrase replacement
  // (e.g. "connected hain" → "connected"). These carry tense only, not content,
  // and have no English equivalent in the document corpus.
  normalized = stripDanglingAuxiliaries(normalized);

  // Step 2b: Restructure "X what is" → "What is X" (Hinglish subject-first order)
  normalized = restructureTrailingQuestion(normalized);

  // Step 3: Capitalize first letter for proper English question format
  if (normalized.length > 0) {
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  // Step 4: Ensure it ends with proper punctuation
  normalized = normalized.replace(/[?\s]+$/, "").trimEnd();
  if (!normalized.endsWith("?") && !normalized.endsWith(".")) {
    normalized += "?";
  }

  return { originalQuery: query.trim(), normalizedQuery: normalized, detectedLanguage };
}

/**
 * Transliterate Devanagari script words to Latin characters.
 * Handles common Hindi words; unknown words are kept as-is.
 */
function transliterateDevanagari(text: string): string {
  let result = text;
  // Replace known Devanagari words with Latin equivalents
  for (const [deva, latin] of Object.entries(DEVANAGARI_TO_LATIN)) {
    result = result.replaceAll(deva, latin);
  }
  // Remove any remaining Devanagari characters that weren't transliterated
  result = result.replace(/[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F]+/g, " ");
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Replace Hinglish question phrases with English equivalents.
 * Applies longest-match-first to avoid partial replacements.
 */
function replaceHinglishPhrases(text: string): string {
  let result = text;

  // Sort by length descending for longest-match-first
  const sortedEntries = Object.entries(HINGLISH_TO_ENGLISH).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [hinglish, english] of sortedEntries) {
    // Case-insensitive replacement
    const pattern = new RegExp(`\\b${escapeRegex(hinglish)}\\b`, "gi");
    result = result.replace(pattern, english);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Restructure Hinglish subject-first question order ("Remote Work Policy kya
 * hai" → "kya hai Remote Work Policy") into English question order
 * ("What is the Remote Work Policy?"). Also moves trailing imperative verbs
 * ("show"/"tell me"/"explain") that appear after an entity phrase to the front
 * ("Remote Work Policy dikhao" → "show Remote Work Policy").
 */
function restructureTrailingQuestion(text: string): string {
  let result = text.trim();
  // Handle trailing imperative verbs: "<subject> show/tell me/explain"
  const trailingImperative = /^(.*?)\s+(show|tell me|explain)\s*([!.?]*)$/i;
  const imp = result.match(trailingImperative);
  if (imp && imp[1].trim().length > 0) {
    const subject = imp[1].trim();
    const verb = imp[2].trim().toLowerCase();
    // Only restructure if the subject is a noun phrase (no leading question word).
    if (!/^(what|which|who|where|when|how|why)\b/i.test(subject)) {
      return `${verb} ${subject}`.trim();
    }
  }
  // Handle trailing "what is"/"what are"/"which" forms: "<subject> kya hai"
  const trailingQuestion = /^(.*?)\s+(what is|what are|which|who|where|when|how|why)\s*([!.?]*)$/i;
  const m = result.match(trailingQuestion);
  if (m && m[1].trim().length > 0) {
    const subject = m[1].trim();
    const q = m[2].trim().toLowerCase();
    // Skip if the subject already looks like a full question (contains a verb).
    if (!/\b(is|are|does|do|have|has)\b/i.test(subject)) {
      return `${q} ${subject}`;
    }
  }
  return result;
}

/** Hindi auxiliaries that add tense only and should be dropped from the normalized query. */
const AUXILIARIES = new Set(["hai", "hain", "tha", "thi", "ho", "hoga", "hogi", "honge", "hoon"]);

/** Remove dangling Hindi auxiliary verbs that remain after phrase replacement. */
function stripDanglingAuxiliaries(text: string): string {
  return text
    .split(/\s+/)
    .filter((t) => !AUXILIARIES.has(t.toLowerCase()))
    .join(" ");
}

/**
 * Extract the English-only content from a Hinglish query for entity extraction.
 * Strips Hindi stopwords while preserving English entity names.
 *
 * Example: "Remote Work Policy kya hai" → ["remote", "work", "policy"]
 */
export function extractLatinTokens(query: string): string[] {
  return query
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && /^[\x20-\x7E]+$/.test(t)) // ASCII-only (Latin)
    .map((t) => t.toLowerCase());
}
