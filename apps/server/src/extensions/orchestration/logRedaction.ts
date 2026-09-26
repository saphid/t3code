/**
 * Host-side secret scrubbing for agent log tails, applied before contents
 * cross the `t3.orchestration/logs` contract. Matches never span a newline
 * (private-key blocks keep one marker per line), so line structure and
 * `maxLines` counting survive redaction. Deliberately over-redacts: a false
 * positive costs a log line, a miss leaks a credential.
 */
export const LOG_REDACTED = "[REDACTED]";

// A secret-bearing name: the keyword must not run on into more letters, so
// `token`/`apiKey`/`ACCESS_TOKEN` match while `tokens`/`author` do not.
const keyword = String.raw`(?:api[_-]?key|secret|token|passw(?:or)?d|credentials?|private[_-]?key|access[_-]?key|auth(?:orization)?|cookie|session[_-]?id)(?![a-z])`;
// A JSON string value, optionally unterminated at line end. Plain: `"…"`,
// where `\"` is an escaped quote. Escaped inside another string: `\"…\"`,
// where `\\\"` (an encoded backslash, then an encoded quote) is the value's
// escaped quote and only a lone `\"` closes it.
const quoted = String.raw`(?:"(?:[^"\\\n]|\\.)*"?|\\"(?:[^"\\\n]|\\\\\\.|\\\\|\\[^"\n])*(?:\\")?)`;

// A PEM line break: raw, or escaped inside a JSON string.
const pemBreak = String.raw`(?:\r?\n|\\r\\n|\\n)`;
/**
 * A PEM private-key block: the BEGIN marker ending its line, then whole
 * header or base64 lines, through END or the end of the read. Prose that
 * merely mentions the marker keeps its line, and a block without END stops
 * at the first line that is not key material.
 */
const PEM_BLOCK = new RegExp(
  String.raw`-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----[ \t]*(?:${pemBreak}[ \t]*(?:[A-Za-z-]+:[ \t][^\r\n\\]*|[A-Za-z0-9+/=]+(?=[ \t]*(?:\r|\n|\\[rn]|-----END|$)))?)+(?:-----END[A-Z ]{0,40}PRIVATE KEY-----)?`,
  "g",
);

const RULES: ReadonlyArray<readonly [RegExp, (match: string, ...groups: string[]) => string]> = [
  // JSON fields, plain or escaped inside another string: "apiKey": "…".
  [
    new RegExp(
      String.raw`(\\?"[A-Za-z0-9_.-]{0,64}${keyword}[A-Za-z0-9_.-]{0,64}\\?"[ \t]*:[ \t]*)(${quoted})`,
      "gi",
    ),
    (_match, name, value) => `${name}${quoteLike(value!)}`,
  ],
  // Authorization-style headers, keeping the scheme.
  [
    /(?<![A-Za-z0-9-])((?:proxy-)?authorization|x-api-key|api-key|x-auth-token|(?:set-)?cookie)([ \t]*:[ \t]*)(?:(bearer|basic|token|bot|digest)[ \t]+)?[^\n"\\]+/gi,
    (_match, name, separator, scheme) =>
      `${name}${separator}${scheme ? `${scheme} ` : ""}${LOG_REDACTED}`,
  ],
  // Environment-style assignments: OPENAI_API_KEY=…, export GH_TOKEN="…".
  [
    new RegExp(
      String.raw`(?<![A-Za-z0-9_])([A-Za-z0-9_]{0,64}${keyword}[A-Za-z0-9_]{0,64})([ \t]*=[ \t]*)(${quoted}|'[^'\n]*'?|[^\s"'\\,;&|)]+)`,
      "gi",
    ),
    (_match, name, separator, value) => `${name}${separator}${quoteLike(value!)}`,
  ],
  // Bearer credentials and well-known token shapes anywhere.
  [/\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/g, () => `Bearer ${LOG_REDACTED}`],
  [
    /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    () => LOG_REDACTED,
  ],
  // Credentials embedded in URLs: scheme://user:pass@host.
  [
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@"'\\]+:[^/\s@"'\\]+@/gi,
    (_match, scheme) => `${scheme}${LOG_REDACTED}@`,
  ],
];

const perLine = (match: string) =>
  match
    .split("\n")
    .map((line) => (line.trim() ? LOG_REDACTED : line))
    .join("\n");

/** Replaces a value's body while keeping its (possibly escaped) quotes. */
const quoteLike = (value: string) => {
  const open = /^(\\?["'])/.exec(value)?.[1] ?? "";
  const close = open && value.length > open.length && value.endsWith(open) ? open : "";
  return `${open}${LOG_REDACTED}${close}`;
};

const PEM_END = /-----END[A-Z ]{0,40}PRIVATE KEY-----/g;
const isKeyChar = (char: string) => /^[A-Za-z0-9+/=\r\n]$/.test(char);

/**
 * The tail of a key whose BEGIN line fell before the read: each END marker
 * plus the key material directly above it. Finds the markers first and walks
 * back from each once, never past the previous one, so the scan is linear.
 */
function redactPemTails(text: string): string {
  let result = "";
  let floor = 0;
  for (const marker of text.matchAll(PEM_END)) {
    let start = marker.index;
    while (start > floor) {
      if (start - 2 >= floor && text[start - 2] === "\\" && /[nr]/.test(text[start - 1]!))
        start -= 2;
      else if (isKeyChar(text[start - 1]!)) start -= 1;
      else break;
    }
    // A bare END marker with no key material above it is prose; keep it.
    if (!/[A-Za-z0-9+/=]/.test(text.slice(start, marker.index).replace(/\\[nr]/g, ""))) continue;
    const end = marker.index + marker[0].length;
    result += text.slice(floor, start) + perLine(text.slice(start, end));
    floor = end;
  }
  return result + text.slice(floor);
}

export function redactLogSecrets(text: string): string {
  let result = redactPemTails(text.replace(PEM_BLOCK, perLine));
  for (const [pattern, replace] of RULES) result = result.replace(pattern, replace);
  return result;
}
