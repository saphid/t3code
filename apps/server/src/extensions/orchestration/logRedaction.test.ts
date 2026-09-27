import { expect, it } from "@effect/vitest";
import { LOG_REDACTED as R, redactLogSecrets } from "./logRedaction.ts";

it("scrubs env assignments, credential fields, headers, and token shapes", () => {
  const cases: [string, string][] = [
    ["OPENAI_API_KEY=abc123", `OPENAI_API_KEY=${R}`],
    ['export GH_TOKEN="two words"', `export GH_TOKEN="${R}"`],
    ["DB_PASSWORD='hunter2' next", `DB_PASSWORD='${R}' next`],
    ['{"apiKey": "k-1", "accessToken":"t-2"}', `{"apiKey": "${R}", "accessToken":"${R}"}`],
    ['"{\\"client_secret\\":\\"s-3\\"}"', `"{\\"client_secret\\":\\"${R}\\"}"`],
    ["Authorization: Bearer abc.def", `Authorization: Bearer ${R}`],
    ["cookie: a=1; b=2", `cookie: ${R}`],
    ["token Bearer abcdefghijkl", `token Bearer ${R}`],
    ["use ghp_" + "a".repeat(36) + " now", `use ${R} now`],
    ["AKIAABCDEFGHIJKLMNOP", R],
    ["https://user:pass@example.com/x", `https://${R}@example.com/x`],
  ];
  for (const [input, output] of cases) expect(redactLogSecrets(input), input).toBe(output);
});

it("keeps ordinary content and line structure", () => {
  const plain = '{"input_tokens": 12, "author": "Ada", "tokens": "many"}\nPWD=/work\nbasic idea\n';
  expect(redactLogSecrets(plain)).toBe(plain);
  const pem = "a\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\nb";
  expect(redactLogSecrets(pem)).toBe(`a\n${R}\n${R}\n${R}\n${R}\nb`);
  // A key whose BEGIN line was cut away before the read.
  expect(redactLogSecrets("CCCC\n-----END RSA PRIVATE KEY-----\nz")).toBe(`${R}\n${R}\nz`);
});

it("consumes escaped quotes inside credential values", () => {
  const json = String.raw`{"password":"first\"remaining-secret-123"}`;
  expect(redactLogSecrets(json)).toBe(`{"password":"${R}"}`);
  // The same JSON escaped inside a transcript record's content field.
  const record = JSON.stringify({ type: "tool_result", content: json });
  const redacted = redactLogSecrets(record);
  expect(redacted).not.toContain("remaining");
  expect(JSON.parse(redacted)).toEqual({ type: "tool_result", content: `{"password":"${R}"}` });
  // An escaped trailing backslash closes the value; the next field survives.
  const trailing = JSON.stringify({ content: String.raw`{"token":"a\\"}`, next: "keep" });
  expect(JSON.parse(redactLogSecrets(trailing))).toEqual({
    content: `{"token":"${R}"}`,
    next: "keep",
  });
  expect(redactLogSecrets(String.raw`PASSWORD="first\"remaining-secret-123" next`)).toBe(
    `PASSWORD="${R}" next`,
  );
});

it("keeps prose that mentions a PEM delimiter, and later records", () => {
  const prose =
    "The test checks the literal -----BEGIN PRIVATE KEY----- marker.\nBuild passed.\nCommitted the fix.\n";
  expect(redactLogSecrets(prose)).toBe(prose);
  expect(redactLogSecrets("See -----END PRIVATE KEY----- too")).toBe(
    "See -----END PRIVATE KEY----- too",
  );
  // A marker line followed by prose redacts only the marker line.
  expect(redactLogSecrets("-----BEGIN PRIVATE KEY-----\nBuild passed.\n")).toBe(
    `${R}\nBuild passed.\n`,
  );
  // A key escaped inside a transcript record, with headers and a blank line.
  const key =
    "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n\nMIIEowIBAAKC\nQQQQ==\n-----END RSA PRIVATE KEY-----\n";
  const record = JSON.stringify({ content: key });
  expect(JSON.parse(redactLogSecrets(`${record}`))).toEqual({ content: `${R}\n` });
  expect(redactLogSecrets(`${record}\n{"content":"Build passed."}`)).toContain("Build passed.");
  // An escaped key tail whose BEGIN line fell before the read.
  expect(
    JSON.parse(
      redactLogSecrets(JSON.stringify({ content: "CCCC\nDDDD\n-----END PRIVATE KEY-----\n" })),
    ),
  ).toEqual({ content: `${R}\n` });
  // A key cut off by the end of the read stays redacted through the end.
  expect(redactLogSecrets("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\nBgkqhk")).toBe(
    `${R}\n${R}\n${R}`,
  );
});

it("redacts every line of a key whose lines carry spaces or tabs", () => {
  const blocks = [
    // Trailing whitespace, then spaces and a tab inside base64 lines.
    "-----BEGIN PRIVATE KEY-----\nAAAA \nBBBB \n-----END PRIVATE KEY-----\n",
    "-----BEGIN PRIVATE KEY-----\nAA AA\nBB\tBB \t\n  CC CC\n-----END PRIVATE KEY-----\n",
  ];
  for (const block of blocks) {
    const lines = block.split("\n").length - 1;
    const whole = `${R}\n`.repeat(lines);
    expect(redactLogSecrets(block), block).toBe(whole);
    expect(JSON.parse(redactLogSecrets(JSON.stringify({ content: block })))).toEqual({
      content: `${R}\n`,
    });
    // Truncated tail: the BEGIN line fell before the read.
    const tail = block.slice(block.indexOf("\n") + 1);
    expect(redactLogSecrets(tail), tail).toBe(`${R}\n`.repeat(lines - 1));
    const escaped = redactLogSecrets(JSON.stringify({ content: tail }));
    expect(JSON.parse(escaped)).toEqual({ content: `${R}\n` });
    // Truncated end: the read stops inside the key.
    const cut = block.slice(0, block.indexOf("-----END"));
    expect(redactLogSecrets(cut), cut).toBe(whole.slice(0, -`${R}\n`.length));
    expect(JSON.parse(redactLogSecrets(JSON.stringify({ content: cut })))).toEqual({
      content: R,
    });
    // Truncated inside the last key line: no break before the end of the
    // read or the closing JSON quote.
    const open = cut.slice(0, -1);
    expect(redactLogSecrets(open), open).toBe(whole.slice(0, -`${R}\n`.length - 1));
    expect(JSON.parse(redactLogSecrets(JSON.stringify({ content: open })))).toEqual({
      content: R,
    });
  }
});

it("redacts a key cut off inside a JSON string, even on one spaced line", () => {
  // The reviewer's repro: the closing quote ends the last base64 line.
  expect(
    redactLogSecrets(JSON.stringify({ content: "-----BEGIN PRIVATE KEY-----\nAAAA \nBBBB" })),
  ).toBe(`{"content":"${R}"}`);
  const line = Array.from({ length: 29 }, (_, i) => `${"MIIE".repeat(14)}${i}`).join(" ");
  const record = JSON.stringify({ content: `-----BEGIN RSA PRIVATE KEY-----\n${line}` });
  expect(redactLogSecrets(record)).toBe(`{"content":"${R}"}`);
});

it("redacts plain prose lines directly under a BEGIN marker (accepted trade-off)", () => {
  // Letters, digits, and spaces cannot be told apart from spaced base64, so
  // such a line after BEGIN is redacted; whitespace-only lines are kept.
  expect(redactLogSecrets("-----BEGIN PRIVATE KEY-----\nBuild passed 42\n  \ndone.\n")).toBe(
    `${R}\n${R}\n  \ndone.\n`,
  );
});

it("scans a full read region in linear time", () => {
  // A 16 KiB region is the most a refresh redacts (8 KiB budget plus 8 KiB of
  // context). The quadratic PEM-tail scan took ~300 ms on this input; the
  // linear scan takes well under 1 ms, so 25 ms (the minimum of three runs,
  // to shed GC and scheduler noise) leaves slow CI ample headroom while any
  // suffix-rescanning pattern still fails.
  const inputs = [
    "A".repeat(16384),
    "AAAA\n".repeat(3277),
    "-----BEGIN PRIVATE KEY-----\nAAAA".repeat(500),
    "x-----END PRIVATE KEY-----".repeat(630),
    // Every word boundary starts a URL-scheme candidate.
    "a.".repeat(8192),
    `-----BEGIN PRIVATE KEY-----\n${"A ".repeat(8150)}.`,
    `${"A \t".repeat(5450)}-----END PRIVATE KEY-----`,
    // Long backslash runs at a value, a key line, and above an END marker.
    `"token":"${"\\".repeat(16370)}`,
    `-----BEGIN PRIVATE KEY-----\\n${"A\\".repeat(8170)}`,
    `${`${"\\".repeat(63)}n`.repeat(255)}-----END PRIVATE KEY-----`,
  ];
  for (const input of inputs) {
    const runs = Array.from({ length: 3 }, () => {
      const started = performance.now();
      redactLogSecrets(input);
      return performance.now() - started;
    });
    expect(Math.min(...runs), input.slice(0, 32)).toBeLessThan(25);
  }
});

// Wraps `text` as the content of a transcript record `depth` times, so each
// level escapes the one inside it again (`"` becomes `\"`, then `\\\"`).
const nest = (text: string, depth: number) => {
  let result = text;
  for (let level = 0; level < depth; level += 1) result = JSON.stringify({ content: result });
  return result;
};
const unnest = (text: string, depth: number) => {
  let result: unknown = text;
  for (let level = 0; level < depth; level += 1)
    result = (JSON.parse(result as string) as { content: string }).content;
  return result as string;
};

it("redacts credential fields and keys at every escaping depth", () => {
  const field = String.raw`{"api_key":"sk-live\"quoted\\tail","client_secret":"s-3\\","next":"keep"}`;
  const key =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\nQQQQ==\n-----END RSA PRIVATE KEY-----\n";
  for (const depth of [1, 2, 3]) {
    const redacted = redactLogSecrets(nest(field, depth));
    expect(redacted, `field depth ${depth}`).not.toMatch(/sk-live|quoted|tail|s-3/);
    expect(unnest(redacted, depth)).toBe(`{"api_key":"${R}","client_secret":"${R}","next":"keep"}`);
    expect(unnest(redactLogSecrets(nest(key, depth)), depth), `key depth ${depth}`).toBe(`${R}\n`);
    // A key tail whose BEGIN line fell before the read, and one cut off at END.
    const tail = key.slice(key.indexOf("\n") + 1);
    expect(unnest(redactLogSecrets(nest(tail, depth)), depth)).toBe(`${R}\n`);
    const cut = key.slice(0, key.indexOf("-----END"));
    expect(unnest(redactLogSecrets(nest(cut, depth)), depth)).toBe(R);
    // Environment assignments quoted inside a nested string.
    expect(unnest(redactLogSecrets(nest('GH_TOKEN="gho-1 2"', depth)), depth)).toBe(
      `GH_TOKEN="${R}"`,
    );
  }
});

it("never leaks secrets when the read stops at any byte, or starts at any line", () => {
  // `shapeLogTail` drops a region's partial first line before redacting, so a
  // read starts at a line, raw or escaped; the file being written can stop
  // the read at any byte, including inside an escape.
  const key =
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\nBgkqhkiG9w0B\n-----END PRIVATE KEY-----\n";
  const secrets = ["MIIEvQIBADAN", "BgkqhkiG9w0B", "sk-nested-VALUE-42"];
  // Any five characters of a secret surviving redaction is a leak.
  const leaks = (redacted: string) =>
    secrets.some((secret) =>
      [...secret].some(
        (_, i) => i + 5 <= secret.length && redacted.includes(secret.slice(i, i + 5)),
      ),
    );
  for (const depth of [1, 2, 3]) {
    const record = nest(`${key}{"password":"sk-nested-VALUE-42"}`, depth);
    const lineBreak = "\\".repeat(2 ** (depth - 1)) + "n";
    for (let at = 0; at <= record.length; at += 1) {
      const part = record.slice(0, at);
      expect(leaks(redactLogSecrets(part)), `depth ${depth} stop ${at}`).toBe(false);
    }
    for (let at = record.indexOf(lineBreak); at !== -1; at = record.indexOf(lineBreak, at + 1)) {
      const part = record.slice(at + lineBreak.length);
      expect(leaks(redactLogSecrets(part)), `depth ${depth} start ${at}`).toBe(false);
    }
  }
});

it("keeps nested lookalikes that are not secrets", () => {
  const plain = String.raw`{"input_tokens":12,"author":"Ada","tokens":"many","note":"a \"token\" and \\ path"}`;
  const prose =
    "The -----BEGIN PRIVATE KEY----- marker.\nSee -----END PRIVATE KEY----- too.\nbasic idea\nPWD=/work";
  for (const depth of [1, 2, 3]) {
    for (const text of [plain, prose]) {
      const nested = nest(text, depth);
      expect(redactLogSecrets(nested), `depth ${depth}`).toBe(nested);
    }
  }
});
