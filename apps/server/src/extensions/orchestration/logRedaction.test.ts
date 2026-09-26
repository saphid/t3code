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
