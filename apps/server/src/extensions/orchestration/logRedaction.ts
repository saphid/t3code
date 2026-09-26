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
// A JSON/escaped-JSON string body, optionally unterminated at line end.
const quoted = String.raw`\\?"(?:[^"\\\n]|\\[^"\n])*(?:\\?")?`;

const RULES: ReadonlyArray<readonly [RegExp, (match: string, ...groups: string[]) => string]> = [
  // PEM private keys, and the tail of one whose BEGIN line fell outside the read.
  [
    /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g,
    (match) => perLine(match),
  ],
  [/(?:[A-Za-z0-9+/=]|\\n|\r?\n)*-----END[A-Z ]*PRIVATE KEY-----/g, (match) => perLine(match)],
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

export function redactLogSecrets(text: string): string {
  let result = text;
  for (const [pattern, replace] of RULES) result = result.replace(pattern, replace);
  return result;
}
