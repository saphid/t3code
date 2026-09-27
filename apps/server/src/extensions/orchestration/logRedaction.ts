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

/**
 * Where a text begins in its source. By default it may begin inside a JSON
 * string, and outside any private key. `lineStart` says it begins a line;
 * `key` whether that is inside a key (its BEGIN line came earlier), or may be.
 */
export interface LogTextStart {
  readonly lineStart?: boolean;
  readonly key?: KeyStart;
}
type KeyStart = "outside" | "inside" | "unknown";

/** Strings nested deeper than this are redacted whole instead of decoded. */
const MAX_DEPTH = 12;

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
  /(?:api_?key|secret|token|passw(?:or)?d|passphrase|credentials?|private_?key|access_?key|auth(?:orization)?|cookie|session)(?![a-z])/;
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

/** Set by `stringEnd`: whether the contents it passed hold an escape. */
let escaped = false;
/**
 * End of a JSON string's contents starting at `from`: its closing quote, or
 * the line break or end of text that cuts it off. A quote followed by
 * anything but JSON punctuation cannot close a well-formed string, so it is
 * read as contents, keeping the rest of a mis-escaped value inside it. A
 * `strict` string (a secret value) fails closed further: only a quote
 * followed by valid JSON structure closes it (`closesValue`).
 */
function stringEnd(text: string, from: number, strict = false): number {
  escaped = false;
  let at = from;
  while (at < text.length) {
    visits++;
    const char = text[at];
    if (char === "\n") return at;
    if (char === '"') {
      if (strict ? closesValue(text, at + 1) : closesString(text, at + 1)) return at;
      at++;
    } else if (char === "\\" && text[at + 1] !== "\n") {
      escaped = true;
      at += 2;
    } else at++;
  }
  return text.length;
}

/** Whether the text from `at`, just after a quote, can follow a JSON string. */
function closesString(text: string, at: number): boolean {
  const char = text[skip(text, at, isSpace)];
  return (
    char === undefined ||
    char === "\n" ||
    char === "," ||
    char === ":" ||
    char === "}" ||
    char === "]"
  );
}
/**
 * Whether the text from `at`, just after a quote ending an object member's
 * value, continues as JSON: closing brackets, then the end of the line, or a
 * comma before the next element. Directly after the value that element is a
 * member of the same object (`"name":`); after a closing bracket it may be
 * any value. Anything else fails closed.
 */
function closesValue(text: string, at: number): boolean {
  let member = true;
  for (;;) {
    at = skip(text, at, isSpace);
    const char = text[at];
    if (char === "}" || char === "]") {
      member = false;
      at++;
    } else if (char === ",") {
      at = skip(text, at + 1, isSpace);
      if (at === text.length || text[at] === "\n") return true;
      return member ? startsMember(text, at) : startsValue(text, at);
    } else return char === undefined || char === "\n";
  }
}
/** Whether an object member (`"name":`) starts at `at`. */
function startsMember(text: string, at: number): boolean {
  if (text[at] !== '"') return false;
  for (let stop = at + 1; stop < text.length && stop <= at + 130; stop++) {
    visits++;
    const char = text[stop];
    if (char === "\n") return false;
    if (char === "\\") stop++;
    else if (char === '"') return text[skip(text, stop + 1, isSpace)] === ":";
  }
  return false;
}
const LITERAL_AT = /(?:true|false|null|-?[0-9])/y;
/**
 * Whether a JSON value starts at `at`: an array opening onto a value or
 * closing empty, an object opening onto a member or closing empty, a string,
 * a number, or a literal.
 */
function startsValue(text: string, at: number): boolean {
  while (text[at] === "[") {
    at = skip(text, at + 1, isSpace);
    if (text[at] === "]") return true;
  }
  if (text[at] === '"') return true;
  if (text[at] === "{") {
    const next = text[skip(text, at + 1, isSpace)];
    return next === '"' || next === "}";
  }
  LITERAL_AT.lastIndex = at;
  return LITERAL_AT.test(text);
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

const MARKER = /-----(BEGIN|END)[A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
const END = /-----END[A-Z0-9 ]{0,40}PRIVATE KEY-----/g;

/**
 * Start of the key material above an END marker at `marker` whose BEGIN line
 * is not in the text, or -1. The marker must start its line, after spaces or
 * directly after base64, so prose that mentions it keeps its line. Walks back
 * over base64, spaces, and line breaks, never below `floor`; `keyAbove` says
 * key material already redacted ends at `floor`.
 */
function tailStart(text: string, marker: number, floor: number, keyAbove: boolean): number {
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
  return key || (keyAbove && start === floor) ? start : -1;
}

const KEY_HEADER_AT = /[ \t]*(?:Proc-Type|DEK-Info):/y;
/**
 * End of the leading lines that could be key material (base64, spaces, blank
 * lines, PEM headers) in a text that begins at a line whose key state is
 * unknown. They are withheld whatever their width; the first other line ends
 * them.
 */
function keyLinesEnd(text: string): number {
  let end = 0;
  for (let at = 0; at < text.length;) {
    let stop = skip(text, at, (char) => isBase64(char) || isSpace(char));
    if (stop < text.length && text[stop] !== "\n") {
      KEY_HEADER_AT.lastIndex = at;
      if (!KEY_HEADER_AT.test(text)) break;
      stop = skip(text, stop, (char) => char !== "\n");
    }
    end = stop;
    at = stop + 1;
  }
  return end;
}

/**
 * PEM private keys. A BEGIN marker in any form (its own line, after a word,
 * inside a string, escaped at any depth) opens a key that runs through the
 * next END marker, or to the end of the text: prose that merely mentions a
 * marker loses the rest of its text rather than risk a key. Also tails whose
 * BEGIN is gone, and the lines opening a text that begins inside a key
 * (through its END) or may (`keyLinesEnd`).
 */
function findKeys(text: string, spans: Span[], key: KeyStart) {
  const endAfter = (from: number) => {
    END.lastIndex = from;
    const end = END.exec(text);
    visits += (end ? END.lastIndex : text.length) - from;
    return end ? END.lastIndex : text.length;
  };
  let floor = 0;
  if (key === "inside") floor = endAfter(0);
  else if (key === "unknown") floor = keyLinesEnd(text);
  const keyFloor = floor;
  if (floor > 0) spans.push({ start: 0, end: floor, kind: "lines" });
  visits += text.length;
  MARKER.lastIndex = floor;
  for (let match = MARKER.exec(text); match; match = MARKER.exec(text)) {
    const markerEnd = match.index + match[0].length;
    if (match[1] === "BEGIN") {
      const end = endAfter(markerEnd);
      spans.push({ start: match.index, end, kind: "lines" });
      floor = MARKER.lastIndex = end;
      continue;
    }
    const start = tailStart(text, match.index, floor, floor > 0 && floor === keyFloor);
    if (start !== -1) spans.push({ start, end: markerEnd, kind: "lines" });
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
  if (char === '"') return { start: at + 1, end: stringEnd(text, at + 1, true), kind: "value" };
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
    /(?<![A-Za-z0-9-])(?:(?:proxy-)?authorization|x-api-key|api-key|x-auth-token|(?:set-)?cookie)[ \t]*:[ \t]*"?(?:(?:bearer|basic|token|bot|digest)[ \t]+)?([^\n"\\]+)/gi,
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
 * (an arbitrary cut, or a string whose opening quote is gone); `key` is
 * whether it begins inside a private key.
 */
function redactText(text: string, depth: number, unknownStart: boolean, key: KeyStart): Span[] {
  const spans: Span[] = [];
  findKeys(text, spans, key);
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
    for (const span of redactText(decoded, depth + 1, unknown, unknown ? "unknown" : "outside"))
      spans.push({
        start: offsets[span.start]!,
        end: offsets[span.end]!,
        text: JSON.stringify(span.text).slice(1, -1),
      });
  };
  // Strings with escapes are scanned again, decoded. `open` is where a string
  // would have opened if the last quote closing one was really an opening
  // quote: an escaped quote (`\"` or `\u0022`) outside any string shows the
  // pairing is off by one, so the string is re-read from there. Where the
  // start is unknown, an escape before the first quote means the text began
  // inside a string.
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
    else if (
      char === '"' ||
      (char === "\\" && (text[at + 1] === '"' || text.startsWith("u0022", at + 1)))
    ) {
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
export function measureLogRedaction(
  text: string,
  start: LogTextStart = {},
): {
  readonly text: string;
  readonly visits: number;
} {
  visits = 0;
  let result = "";
  let at = 0;
  for (const span of redactText(text, 0, !start.lineStart, start.key ?? "outside")) {
    result += text.slice(at, span.start) + span.text;
    at = span.end;
  }
  return { text: result + text.slice(at), visits };
}

export function redactLogSecrets(text: string, start: LogTextStart = {}): string {
  return measureLogRedaction(text, start).text;
}
