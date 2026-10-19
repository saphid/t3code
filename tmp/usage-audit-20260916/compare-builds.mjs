import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { parseClaudeLine as latestNormalParser } from "./latest-normal-usageTranscripts.ts";

const originalProbe = fs.readFileSync(new URL("./reproduce.mjs", import.meta.url), "utf8");
const fixture = vm.runInNewContext(
  originalProbe.slice(
    originalProbe.indexOf("const fixture ="),
    originalProbe.indexOf("const original ="),
  ) + "\nfixture",
);
const results = [];
for (const [build, file, functionName] of [
  [
    "Installed Fork Nightly 20260914.1722956577",
    "compare-fork-server.mjs",
    "parseClaudeLineRecords",
  ],
  ["Installed normal Nightly 20260831.2100", "compare-normal-server.mjs", "parseClaudeLine"],
]) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const region = source.indexOf("//#region src/usage/usageTranscripts.ts");
  const parserSource = source.slice(
    source.indexOf("const EMPTY_TOTALS =", region),
    source.indexOf("function initialCodexScanState()", region),
  );
  const parse = vm.runInNewContext(parserSource + "\n" + functionName);
  results.push(measure(build, parse));
}
results.push(measure("Latest normal Nightly source 20260916.1795", latestNormalParser));

function measure(build, parse) {
  const value = parse(JSON.stringify(fixture));
  const records = Array.isArray(value) ? value : value === null ? [] : [value];
  return {
    build,
    records: records.length,
    tokens: records.reduce(
      (sum, { totals }) =>
        sum +
        totals.uncachedInputTokens +
        totals.cachedInputTokens +
        totals.cacheCreationTokens +
        totals.outputTokens,
      0,
    ),
  };
}
assert.equal(results[0].tokens, 0);
assert.equal(results[1].tokens, 25558);
assert.equal(results[2].tokens, 25558);
fs.writeFileSync(
  new URL("./build-comparison.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
