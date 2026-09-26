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
