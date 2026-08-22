/**
 * Builds the contextual-vocabulary list fed to speech recognizers so
 * dictation gets project jargon right ("worktree", "pnpm", branch names,
 * identifiers from recent sessions).
 *
 * Apple's speech APIs accept at most 100 contextual phrases across all
 * tags and recommend short phrases, so extraction is aggressive about
 * filtering and the result is capped. The same list format works for the
 * legacy SFSpeechRecognizer `contextualStrings` and the macOS/iOS 26
 * `AnalysisContext` path.
 */

export interface VoiceVocabularySource {
  readonly text: string;
  /** Relative importance of this source; current-session text should outweigh history. */
  readonly weight?: number;
}

export interface ExtractVoiceVocabularyOptions {
  /** Maximum number of terms returned. Defaults to the Apple contextual-strings cap. */
  readonly limit?: number;
}

export const VOICE_VOCABULARY_LIMIT = 100;

const MIN_TERM_LENGTH = 3;
const MAX_TERM_LENGTH = 32;
const MIN_PLAIN_WORD_LENGTH = 4;
const MIN_PLAIN_WORD_COUNT = 2;

// Tokens that read as identifiers but are so generic every recognizer
// already handles them; spending contextual-phrase budget on them is waste.
const GENERIC_TECH_TERMS = new Set([
  "async",
  "await",
  "boolean",
  "class",
  "const",
  "constructor",
  "default",
  "double",
  "error",
  "export",
  "false",
  "float",
  "function",
  "github",
  "import",
  "index",
  "input",
  "interface",
  "javascript",
  "module",
  "null",
  "number",
  "object",
  "output",
  "private",
  "public",
  "python",
  "return",
  "static",
  "string",
  "test",
  "tests",
  "true",
  "type",
  "typescript",
  "undefined",
  "value",
  "void",
]);

// Compact list of frequent English words used to reject ordinary prose when
// considering plain lowercase tokens. Only unusual plain words (repeated at
// least twice) become vocabulary, so this does not need to be exhaustive.
const COMMON_ENGLISH_WORDS = new Set(
  "about above actually after again against almost along already also although always among another answer anything around asked away back because become been before began behind being below better between both bring called came cannot change check children close come could country course days did different does doing done down during each early enough even ever every everything example fact family far feel few find first follow found four from get give goes going good got great group hand hard has have head hear help her here high him his home house how however idea important into its just keep kind knew know large last later learn leave left let life light like line little live long look made make many may mean men might more most move much must name near need never new next night not now number of off often old once one only open other our out over own part people place point put question quite rather read really right room said same saw say school second see seem seen set she should show side since small some something sometimes soon start state still story such sure take tell than that the their them then there these they thing think this those though thought three through time today together told too took toward turn under until upon use used very want was water way well went were what when where which while white who whole why will with within without word work world would year yes yet you young your".split(
    " ",
  ),
);

const TOKEN_REGEX = /[A-Za-z][A-Za-z0-9]*(?:[-_./+][A-Za-z0-9]+)*/g;
const HAS_INNER_UPPERCASE_REGEX = /[a-z0-9][A-Z]/;
const HAS_SEPARATOR_REGEX = /[A-Za-z0-9][-_.][A-Za-z0-9]/;
const HAS_LETTER_DIGIT_MIX_REGEX = /(?:[A-Za-z][0-9]|[0-9][A-Za-z])/;
const ALL_CAPS_ACRONYM_REGEX = /^[A-Z][A-Z0-9]{1,7}$/;
const PLAIN_LOWERCASE_WORD_REGEX = /^[a-z]+$/;
const HEX_LIKE_REGEX = /^[0-9a-f]{7,}$/i;
const UUID_SEGMENT_REGEX = /^[0-9a-f]{8}(?:-[0-9a-f]{4,12})+$/i;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;

interface TermStats {
  score: number;
  count: number;
  casings: Map<string, number>;
}

function isIdentifierLike(token: string): boolean {
  return (
    HAS_INNER_UPPERCASE_REGEX.test(token) ||
    HAS_SEPARATOR_REGEX.test(token) ||
    HAS_LETTER_DIGIT_MIX_REGEX.test(token) ||
    ALL_CAPS_ACRONYM_REGEX.test(token)
  );
}

const TOKEN_SEPARATORS_REGEX = /[-_./+]/g;

function isNoise(token: string): boolean {
  if (token.length < MIN_TERM_LENGTH || token.length > MAX_TERM_LENGTH) return true;
  if (HEX_LIKE_REGEX.test(token) || UUID_SEGMENT_REGEX.test(token)) return true;
  // UUID and hash fragments survive the plain hex checks when the tokenizer
  // starts mid-value (e.g. "da-4946-8df8-79daa38d20f8" from a numeric-leading
  // UUID); stripping separators exposes them.
  if (HEX_LIKE_REGEX.test(token.replace(TOKEN_SEPARATORS_REGEX, ""))) return true;
  return GENERIC_TECH_TERMS.has(token.toLowerCase());
}

function recordTerm(terms: Map<string, TermStats>, token: string, score: number): void {
  const key = token.toLowerCase();
  const stats = terms.get(key) ?? { score: 0, count: 0, casings: new Map() };
  stats.score += score;
  stats.count += 1;
  stats.casings.set(token, (stats.casings.get(token) ?? 0) + 1);
  terms.set(key, stats);
}

function dominantCasing(casings: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [casing, count] of casings) {
    if (count > bestCount) {
      best = casing;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Extracts a ranked, capped list of dictation vocabulary terms from free
 * text (thread transcripts, titles, file paths, branch names).
 *
 * Identifier-shaped tokens (camelCase, kebab-case, dotted, acronyms,
 * letter-digit mixes) qualify on first sight. Plain lowercase words only
 * qualify when they are not common English, not generic tech vocabulary,
 * and repeat across the sources, which is what lets project jargon like
 * "worktree" in while keeping ordinary prose out.
 */
export function extractVoiceVocabulary(
  sources: ReadonlyArray<VoiceVocabularySource>,
  options?: ExtractVoiceVocabularyOptions,
): string[] {
  const limit = options?.limit ?? VOICE_VOCABULARY_LIMIT;
  const identifierTerms = new Map<string, TermStats>();
  const plainTerms = new Map<string, TermStats>();

  for (const source of sources) {
    const weight = source.weight ?? 1;
    if (weight <= 0 || !source.text) continue;

    const inlineCodeTokens = new Set<string>();
    for (const match of source.text.matchAll(INLINE_CODE_REGEX)) {
      for (const token of match[1]?.match(TOKEN_REGEX) ?? []) {
        inlineCodeTokens.add(token);
      }
    }

    for (const rawToken of source.text.match(TOKEN_REGEX) ?? []) {
      // Path-like tokens contribute their basename; saying a full path is
      // unrealistic, but the file's name is high-value vocabulary.
      const token = rawToken.includes("/")
        ? (rawToken.split("/").findLast((segment) => segment.length > 0) ?? rawToken)
        : rawToken;
      if (isNoise(token)) continue;

      const codeBoost = inlineCodeTokens.has(rawToken) ? 2 : 1;
      if (isIdentifierLike(token)) {
        recordTerm(identifierTerms, token, weight * codeBoost * 2);
      } else if (
        PLAIN_LOWERCASE_WORD_REGEX.test(token) &&
        token.length >= MIN_PLAIN_WORD_LENGTH &&
        !COMMON_ENGLISH_WORDS.has(token)
      ) {
        recordTerm(plainTerms, token, weight * codeBoost);
      }
    }
  }

  const ranked: Array<{ term: string; score: number }> = [];
  for (const stats of identifierTerms.values()) {
    ranked.push({ term: dominantCasing(stats.casings), score: stats.score });
  }
  for (const stats of plainTerms.values()) {
    if (stats.count >= MIN_PLAIN_WORD_COUNT) {
      ranked.push({ term: dominantCasing(stats.casings), score: stats.score });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  return ranked.slice(0, limit).map(({ term }) => term);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let col = 1; col < cols; col += 1) {
      current[col] = Math.min(
        (previous[col] ?? 0) + 1,
        (current[col - 1] ?? 0) + 1,
        (previous[col - 1] ?? 0) + (a[row - 1] === b[col - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

function canonicalize(value: string): string {
  return value.toLowerCase().replace(/[-_./\s]/g, "");
}

interface TranscriptWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

const TRANSCRIPT_WORD_REGEX = /[A-Za-z0-9][A-Za-z0-9'-]*/g;

function correctionDistanceBudget(canonical: string): number {
  return canonical.length >= 10 ? 2 : canonical.length >= 4 ? 1 : 0;
}

/** Fuzzy single-word repair only applies to acronym- or identifier-shaped words. */
const SINGLE_WORD_FUZZY_ELIGIBLE_REGEX = /[A-Z0-9]/;

/**
 * Rewrites near-miss recognitions back to vocabulary terms: "word tree" with
 * "worktree" in the vocabulary becomes "worktree", "PNP" becomes "pnpm",
 * and exact matches adopt the term's casing ("fable" to "Fable").
 *
 * Deliberately conservative: a run of one to three transcript words must
 * match a term within a small edit distance after stripping separators, and
 * must share the term's first letter. All candidate spans at a position are
 * evaluated before anything is chosen: an exact canonical match (longest
 * span first) always beats a fuzzy one, an exact match whose surface already
 * equals the term consumes the span untouched, and fuzzy repair of a single
 * word requires an uppercase letter or digit in that word so ordinary
 * lowercase prose is never rewritten. Replaced ranges never overlap.
 */
export function applyVoiceVocabularyCorrections(
  text: string,
  vocabulary: ReadonlyArray<string>,
): string {
  if (!text || vocabulary.length === 0) return text;

  const terms = vocabulary
    .map((term) => ({ term, canonical: canonicalize(term) }))
    .filter(({ canonical }) => canonical.length >= 3);
  if (terms.length === 0) return text;

  const words: TranscriptWord[] = [];
  for (const match of text.matchAll(TRANSCRIPT_WORD_REGEX)) {
    words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }

  interface Replacement {
    readonly start: number;
    readonly end: number;
    readonly term: string;
    readonly span: number;
  }
  const replacements: Replacement[] = [];

  for (let index = 0; index < words.length; index += 1) {
    // Evaluate every (span, term) candidate at this position first, then
    // rank: an exact canonical match (longest span wins) always beats fuzzy,
    // so a span-3 fuzzy can never absorb words beside a span-2 exact match.
    let bestExact: (Replacement & { readonly sameSurface: boolean }) | null = null;
    let bestFuzzy: { readonly replacement: Replacement; readonly distance: number } | null = null;

    for (let span = 1; span <= 3; span += 1) {
      const first = words[index];
      const last = words[index + span - 1];
      if (!first || !last) break;
      const candidate = canonicalize(
        words
          .slice(index, index + span)
          .map(({ word }) => word)
          .join(""),
      );
      for (const { term, canonical } of terms) {
        if (candidate === canonical) {
          if (bestExact === null || span > bestExact.span) {
            const surface = text.slice(first.start, last.end);
            bestExact = {
              start: first.start,
              end: last.end,
              term,
              span,
              sameSurface: surface === term,
            };
          }
          continue;
        }
        if (candidate[0] !== canonical[0]) continue;
        if (Math.abs(candidate.length - canonical.length) > 2) continue;
        // A lone lowercase word is legitimate dictation ("provide" must not
        // become "provider"); fuzzy repair of a single word needs the shape
        // of a misread identifier or acronym. Split compounds (span >= 2)
        // stay eligible: that is the "word tree" -> "worktree" case.
        if (span === 1 && !SINGLE_WORD_FUZZY_ELIGIBLE_REGEX.test(first.word)) continue;
        const distance = levenshtein(candidate, canonical);
        if (distance > correctionDistanceBudget(canonical)) continue;
        // Spans ascend, so a strict-inequality update keeps the shorter span
        // on distance ties.
        if (bestFuzzy === null || distance < bestFuzzy.distance) {
          bestFuzzy = {
            replacement: { start: first.start, end: last.end, term, span },
            distance,
          };
        }
      }
    }

    if (bestExact !== null) {
      // An exact match that already reads as the term consumes its span with
      // no replacement, so a fuzzy term can never rewrite correct text.
      if (!bestExact.sameSurface) {
        replacements.push({
          start: bestExact.start,
          end: bestExact.end,
          term: bestExact.term,
          span: bestExact.span,
        });
      }
      index += bestExact.span - 1;
    } else if (bestFuzzy !== null) {
      replacements.push(bestFuzzy.replacement);
      index += bestFuzzy.replacement.span - 1;
    }
  }

  let result = "";
  let cursor = 0;
  for (const { start, end, term } of replacements) {
    result += text.slice(cursor, start) + term;
    cursor = end;
  }
  return result + text.slice(cursor);
}

/**
 * Merges vocabulary lists in priority order (earlier lists win), removing
 * case-insensitive duplicates and enforcing the recognizer cap. Used to put
 * current-session terms ahead of learned history.
 */
export function mergeVoiceVocabulary(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  limit: number = VOICE_VOCABULARY_LIMIT,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const term of list) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(term);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}
