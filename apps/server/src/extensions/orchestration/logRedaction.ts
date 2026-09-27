/**
 * Host-side secret scrubbing for agent log tails, applied before contents
 * cross the `t3.orchestration/logs` contract. Deliberately over-redacts: a
 * false positive costs a log line, a miss leaks a credential.
 *
 * The scanner reads the text as JSON-ish lines. Every string holding an escape
 * is decoded (`\"`, `\\`, `\n`, `\uXXXX`, …) and scanned again as its own
 * text, so a transcript record quoting a tool result that quotes JSON is read
 * at each depth with escapes interpreted in their own string, never across
 * one. A redaction found in decoded text replaces the exact source span of the
 * characters it covers, re-escaped for that string. Each depth scans at most
 * the text of the one above it and depth is capped, so work stays linear.
 *
 * Raw line structure survives: a redaction at the top level that spans lines
 * keeps one marker per line, so `maxLines` counting still holds.
 */
export const LOG_REDACTED = "[REDACTED]";
const R = LOG_REDACTED;

/** Strings nested deeper than this are redacted whole instead of decoded. */
const MAX_DEPTH = 12;
/** Shortest bare base64 line read as key material with no marker in sight. */
const KEY_LINE_WIDTH = 40;

/**
 * A region to replace: rendered from its `kind` (`value` becomes the marker,
 * `json` a quoted marker, `lines` a key block) or carrying its `text`.
 */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly kind?: "value" | "json" | "lines";
  readonly text?: string;
}

/** Characters inspected by the current scan; see `measureLogRedaction`. */
let visits = 0;

/**
 * Whether a field or variable name carries a secret. The name is normalized
 * by splitting camelCase words with `_`, lowercasing, and reading `-`, `.`,
 * and spaces as `_`, so `apiKey`, `API_KEY`, `api-key`, and `api.key` all
 * read `api_key`. A keyword must not run on into more letters: `token` and
 * `GH_TOKEN_SCOPE` match, `input_tokens`, `tokenizer`, and `author` do not.
 */
const SECRET_NAME =
  /(?:api_?key|secret|token|passw(?:or)?d|credentials?|private_?key|access_?key|auth(?:orization)?|cookie|session_?id)(?![a-z])/;
const isSecretName = (name: string) => {
  visits += name.length;
  return SECRET_NAME.test(
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[-. ]/g, "_"),
  );
};

const isSpace = (char: string | undefined) => char === " " || char === "\t" || char === "\r";
const isBase64 = (char: string | undefined) =>
  char !== undefined &&
  ((char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "+" ||
    char === "/" ||
    char === "=");
const isWord = (char: string | undefined) =>
  char === "_" || (isBase64(char) && char !== "+" && char !== "/" && char !== "=");

/** Set by `stringEnd`: whether the contents it passed hold an escape. */
let escaped = false;
/**
 * End of a JSON string's contents starting at `from`: its closing quote, or
 * the line break or end of text that cuts it off. A quote directly followed
 * by a word character cannot close a well-formed string, so it is read as
 * contents, keeping the rest of a mis-escaped value inside it.
 */
function stringEnd(text: string, from: number): number {
  escaped = false;
  let at = from;
  while (at < text.length) {
    visits++;
    const char = text[at];
    if (char === "\n") return at;
    if (char === '"') {
      if (!isWord(text[at + 1])) return at;
      at++;
    } else if (char === "\\" && text[at + 1] !== "\n") {
      escaped = true;
      at += 2;
    } else at++;
  }
  return text.length;
}

const ESCAPES: Readonly<Record<string, string>> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const HEX4 = /^[0-9A-Fa-f]{4}$/;
/**
 * Decodes string contents `text[start, end)`. `offsets[i]` is where decoded
 * character `i` starts in `text`, and `offsets[length]` is `end`, so a decoded
 * span `[a, b)` covers `text[offsets[a], offsets[b])`. An escape cut off by
 * the end of the contents decodes to nothing and stays inside the last span.
 */
function decode(text: string, start: number, end: number) {
  let decoded = "";
  const offsets: number[] = [];
  let run = start;
  let at = start;
  const flush = (to: number) => {
    decoded += text.slice(run, to);
    for (let index = run; index < to; index++) offsets.push(index);
  };
  while (at < end) {
    visits++;
    if (text[at] !== "\\") {
      at++;
      continue;
    }
    flush(at);
    run = end;
    if (at + 1 >= end) break;
    const next = text[at + 1]!;
    let char = ESCAPES[next] ?? next;
    let width = 2;
    if (next === "u") {
      if (at + 6 > end) break;
      const hex = text.slice(at + 2, at + 6);
      if (HEX4.test(hex)) {
        char = String.fromCharCode(Number.parseInt(hex, 16));
        width = 6;
      }
    }
    decoded += char;
    offsets.push(at);
    at += width;
    run = at;
  }
  flush(end);
  offsets.push(end);
  return { decoded, offsets };
}

/** First index from `at` whose character fails `test`. */
function skip(text: string, at: number, test: (char: string | undefined) => boolean) {
  while (at < text.length && test(text[at])) {
    at++;
    visits++;
  }
  return at;
}
/** Lowest index down to `floor` such that every character from it to `at` passes `test`. */
function skipBack(
  text: string,
  at: number,
  floor: number,
  test: (char: string | undefined) => boolean,
) {
  while (at > floor && test(text[at - 1])) {
    at--;
    visits++;
  }
  return at;
}

const MARKER = /-----(BEGIN|END)[A-Z ]{0,40}PRIVATE KEY-----/g;
const END_AT = /-----END[A-Z ]{0,40}PRIVATE KEY-----/y;
const HEADER_AT = /[A-Za-z-]+:[ \t]/y;

/**
 * End of a BEGIN block whose marker ends at `from`, or -1 when the marker
 * does not end its line (prose that mentions it). The block takes whole
 * header lines, base64 lines (runs separated by spaces or tabs), and blank
 * lines, through END. Without END it stops after the last key line before
 * one that is not key material, or runs to the end of the text.
 */
function blockEnd(text: string, from: number): number {
  let at = from;
  at = skip(text, at, isSpace);
  if (at < text.length && text[at] !== "\n") return -1;
  let end = at;
  while (at < text.length) {
    let line = at + 1;
    line = skip(text, line, isSpace);
    HEADER_AT.lastIndex = line;
    let stop = line;
    if (HEADER_AT.test(text)) {
      stop = skip(text, stop, (char) => char !== "\n");
      end = at = stop;
      continue;
    }
    let key = false;
    for (; isBase64(text[stop]) || isSpace(text[stop]); stop++) {
      visits++;
      if (isBase64(text[stop])) key = true;
    }
    if (stop === text.length || text[stop] === "\n") {
      if (key) end = stop;
      at = stop;
      continue;
    }
    END_AT.lastIndex = stop;
    if (END_AT.test(text)) return END_AT.lastIndex;
    return end;
  }
  return text.length;
}

/**
 * Start of the key material above an END marker at `marker` whose BEGIN line
 * is not in the text, or -1. The marker must start its line, after spaces or
 * directly after base64, so prose that mentions it keeps its line. Walks back
 * over base64, spaces, and line breaks, never below `floor`.
 */
function tailStart(text: string, marker: number, floor: number): number {
  let start = marker;
  start = skipBack(text, start, floor, isSpace);
  if (start === marker) start = skipBack(text, start, floor, isBase64);
  if (start !== 0 && text[start - 1] !== "\n") return -1;
  let key = false;
  for (let at = start; at < marker && !key; at++) {
    visits++;
    key = isBase64(text[at]);
  }
  while (start > floor) {
    const char = text[start - 1];
    if (isBase64(char)) key = true;
    else if (!isSpace(char) && char !== "\n") break;
    start--;
    visits++;
  }
  return key ? start : -1;
}

/**
 * End of the key body opening a text whose start is unknown (a read that
 * began inside a key, so neither marker may be in it): lines of bare base64
 * at least `KEY_LINE_WIDTH` wide, plus one shorter final line. 0 if none.
 */
function keyBodyEnd(text: string): number {
  let at = 0;
  let end = 0;
  while (at < text.length) {
    const from = skip(text, at, isSpace);
    const base64End = skip(text, from, isBase64);
    const width = base64End - from;
    const stop = skip(text, base64End, isSpace);
    if ((stop < text.length && text[stop] !== "\n") || width === 0) break;
    if (width < KEY_LINE_WIDTH) {
      if (end > 0) end = stop;
      break;
    }
    end = stop;
    at = stop + 1;
  }
  return end;
}

/** PEM private keys: whole blocks, tails whose BEGIN is gone, bare bodies. */
function findKeys(text: string, spans: Span[], unknownStart: boolean) {
  let floor = unknownStart ? keyBodyEnd(text) : 0;
  if (floor > 0) spans.push({ start: 0, end: floor, kind: "lines" });
  visits += text.length;
  MARKER.lastIndex = floor;
  for (let match = MARKER.exec(text); match; match = MARKER.exec(text)) {
    const markerEnd = match.index + match[0].length;
    if (match[1] === "BEGIN") {
      const end = blockEnd(text, markerEnd);
      if (end !== -1) {
        spans.push({ start: match.index, end, kind: "lines" });
        floor = MARKER.lastIndex = Math.max(end, markerEnd);
        continue;
      }
    } else {
      const start = tailStart(text, match.index, floor);
      if (start !== -1) spans.push({ start, end: markerEnd, kind: "lines" });
    }
    floor = markerEnd;
  }
}

/**
 * A quoted name, then JSON whitespace, a colon, and more whitespace. The
 * name may hold escapes; a quote after a backslash is escaped and never
 * opens one.
 */
const FIELD = /(?<!\\)"((?:[^"\\\n]|\\[^\n]){1,128})"[ \t\r\n]*:[ \t\r\n]*/g;

/** The complete JSON value (string, number, literal, array, object) at `at`. */
function valueSpan(text: string, at: number): Span {
  const char = text[at];
  if (char === '"') return { start: at + 1, end: stringEnd(text, at + 1), kind: "value" };
  if (char === "{" || char === "[") {
    let depth = 0;
    for (let stop = at; stop < text.length;) {
      visits++;
      const next = text[stop]!;
      if (next === '"') {
        stop = stringEnd(text, stop + 1);
        if (text[stop] === '"') stop++;
        continue;
      }
      if (next === "{" || next === "[") depth++;
      else if ((next === "}" || next === "]") && --depth === 0)
        return { start: at, end: stop + 1, kind: "json" };
      stop++;
    }
    return { start: at, end: text.length, kind: "json" };
  }
  const end = skip(text, at, (char) => !/[\s,}\]"\\]/.test(char!));
  return { start: at, end, kind: "json" };
}

/** JSON fields with a secret-bearing name: the whole value. */
function findFields(text: string, spans: Span[]) {
  visits += text.length;
  FIELD.lastIndex = 0;
  for (let match = FIELD.exec(text); match; match = FIELD.exec(text)) {
    const name = match[1]!;
    if (!isSecretName(name.includes("\\") ? decode(name, 0, name.length).decoded : name)) continue;
    const span = valueSpan(text, match.index + match[0].length);
    spans.push(span);
    FIELD.lastIndex = Math.max(FIELD.lastIndex, span.end);
  }
}

/** Line-local shapes, each yielding the span of the secret in a match. */
const RULES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => Span | null]> = [
  // Assignments and flags: OPENAI_API_KEY=…, export GH_TOKEN="…", --password=….
  [
    /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,128})[ \t]*=[ \t]*("(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?|[^\s"'\\,;&|)]+)/g,
    (match) => {
      if (!isSecretName(match[1]!)) return null;
      const value = match[2]!;
      const end = match.index + match[0].length;
      const quote = value[0] === '"' || value[0] === "'" ? 1 : 0;
      const closed = quote && value.length > 1 && value.endsWith(value[0]!) ? 1 : 0;
      return { start: end - value.length + quote, end: end - closed, kind: "value" };
    },
  ],
  // Authorization-style headers, keeping the scheme.
  [
    /(?<![A-Za-z0-9-])(?:(?:proxy-)?authorization|x-api-key|api-key|x-auth-token|(?:set-)?cookie)[ \t]*:[ \t]*(?:(?:bearer|basic|token|bot|digest)[ \t]+)?([^\n"\\]+)/gi,
    (match) => tail(match, match[1]!),
  ],
  // Bearer credentials and well-known token shapes anywhere.
  [/\bBearer[ \t]+([A-Za-z0-9._~+/=-]{8,})/g, (match) => tail(match, match[1]!)],
  [
    /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    (match) => tail(match, match[0]),
  ],
  // Credentials embedded in URLs: scheme://user:pass@host. Anchored on the
  // `://` delimiter rather than the scheme, so a long run of scheme-like
  // words is not rescanned from every word boundary.
  [
    /(?<=[a-z0-9+.-]):\/\/([^/\s:@"'\\]+:[^/\s@"'\\]+)@/gi,
    (match) => ({ start: match.index + 3, end: match.index + match[0].length - 1, kind: "value" }),
  ],
];
/** The span of `part`, which ends `match`. */
const tail = (match: RegExpExecArray, part: string): Span => {
  const end = match.index + match[0].length;
  return { start: end - part.length, end, kind: "value" };
};

const perLine = (text: string) =>
  text
    .split("\n")
    .map((line) => (line.trim() ? R : line))
    .join("\n");

function render(text: string, depth: number, span: Span): string {
  if (span.text !== undefined) return span.text;
  const lines = depth === 0 && text.slice(span.start, span.end).includes("\n");
  if (span.kind === "lines" || lines)
    return depth === 0 ? perLine(text.slice(span.start, span.end)) : R;
  return span.kind === "json" ? `"${R}"` : R;
}

/**
 * Redactions for `text` at `depth`, as sorted, disjoint replacements in its
 * own coordinates. `unknownStart` marks text that may begin inside a string
 * or key (the start of a read, or a string whose opening quote is gone).
 */
function redactText(text: string, depth: number, unknownStart: boolean): Span[] {
  const spans: Span[] = [];
  findKeys(text, spans, unknownStart);
  findFields(text, spans);
  for (const [pattern, toSpan] of RULES) {
    visits += text.length;
    for (const match of text.matchAll(pattern)) {
      const span = toSpan(match);
      if (span) spans.push(span);
    }
  }
  const nested = (start: number, end: number, unknown: boolean) => {
    if (end <= start) return;
    if (depth >= MAX_DEPTH) return void spans.push({ start, end, text: R });
    const { decoded, offsets } = decode(text, start, end);
    for (const span of redactText(decoded, depth + 1, unknown))
      spans.push({
        start: offsets[span.start]!,
        end: offsets[span.end]!,
        text: JSON.stringify(span.text).slice(1, -1),
      });
  };
  // Strings with escapes are scanned again, decoded. `open` is where a string
  // would have opened if the last quote closing one was really an opening
  // quote: an escaped quote outside any string shows the pairing is off by
  // one, so the string is re-read from there. Where the start is unknown, an
  // escape before the first quote means the text began inside a string.
  let at = 0;
  let open = 0;
  if (unknownStart) {
    const end = stringEnd(text, 0);
    if (escaped) {
      nested(0, end, true);
      open = at = text[end] === '"' ? end + 1 : end;
    }
  }
  while (at < text.length) {
    visits++;
    const char = text[at];
    if (char === "\n") open = ++at;
    else if (char === '"' || (char === "\\" && text[at + 1] === '"')) {
      const from = char === '"' ? at + 1 : open;
      const end = stringEnd(text, from);
      if (escaped) nested(from, end, false);
      open = at = text[end] === '"' ? end + 1 : end;
    } else at++;
  }
  // Overlapping spans merge; one containing the rest keeps its rendering.
  const sorted = spans
    .filter((span) => span.end > span.start)
    .toSorted((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (let index = 0; index < sorted.length;) {
    const first = sorted[index]!;
    let end = first.end;
    for (index++; index < sorted.length && sorted[index]!.start < end; index++)
      end = Math.max(end, sorted[index]!.end);
    const span = end === first.end ? first : { start: first.start, end, kind: "lines" as const };
    merged.push({ start: span.start, end, text: render(text, depth, span) });
  }
  return merged;
}

/** `redactLogSecrets`, also reporting the characters the scan inspected. */
export function measureLogRedaction(text: string): {
  readonly text: string;
  readonly visits: number;
} {
  visits = 0;
  let result = "";
  let at = 0;
  for (const span of redactText(text, 0, true)) {
    result += text.slice(at, span.start) + span.text;
    at = span.end;
  }
  return { text: result + text.slice(at), visits };
}

export function redactLogSecrets(text: string): string {
  return measureLogRedaction(text).text;
}
