import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("./installed-apps_server_dist_bin.mjs", import.meta.url),
  "utf8",
);
const parserSource = source.slice(
  source.indexOf("const EMPTY_TOTALS =", source.indexOf("//#region src/usage/usageTranscripts.ts")),
  source.indexOf(
    "function initialCodexScanState()",
    source.indexOf("//#region src/usage/usageTranscripts.ts"),
  ),
);
const fixture = {
  type: "assistant",
  timestamp: "2026-09-15T23:21:36.988Z",
  message: {
    id: "audit-message",
    model: "claude-fable-5-1",
    usage: {
      input_tokens: 2,
      output_tokens: 466,
      cache_read_input_tokens: 11387,
      cache_creation_input_tokens: 13703,
      iterations: [
        {
          type: "message",
          model: null,
          input_tokens: 2,
          output_tokens: 466,
          cache_read_input_tokens: 11387,
          cache_creation_input_tokens: 13703,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 13703 },
        },
      ],
    },
  },
};
const original = vm.runInNewContext(parserSource + "\nparseClaudeLineRecords");
const patched = vm.runInNewContext(
  parserSource.replace(
    'iterations.length === 0 ? model : ""',
    'iterations.length === 0 || index === attempts.length - 1 ? model : ""',
  ) + "\nparseClaudeLineRecords",
);
const a = original(JSON.stringify(fixture));
const b = patched(JSON.stringify(fixture));
console.log(
  JSON.stringify(
    {
      installed_records: a.length,
      expected_records: 1,
      diagnostic_fallback_records: b.length,
      recovered_tokens: b.reduce(
        (n, r) =>
          n +
          r.totals.uncachedInputTokens +
          r.totals.cachedInputTokens +
          r.totals.cacheCreationTokens +
          r.totals.outputTokens,
        0,
      ),
    },
    null,
    2,
  ),
);
if (a.length !== 1) {
  console.error(
    "FAIL: installed parser drops a real Claude usage record when its serving iteration has model:null.",
  );
  process.exitCode = 1;
}
