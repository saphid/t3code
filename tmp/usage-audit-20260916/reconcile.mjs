import fs from "node:fs";
import readline from "node:readline";
import vm from "node:vm";
const dir = new URL("./", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
const src = fs.readFileSync(new URL("installed-apps_server_dist_bin.mjs", dir), "utf8");
const start = src.indexOf("//#region src/usage/usageTranscripts.ts");
const parsers = src.slice(
  src.indexOf("const EMPTY_TOTALS =", start),
  src.indexOf("function initialCodexScanState()", start),
);
const original = vm.runInNewContext(parsers + "\nparseClaudeLineRecords");
const patched = vm.runInNewContext(
  parsers.replace(
    'iterations.length === 0 ? model : ""',
    'iterations.length === 0 || index === attempts.length - 1 ? model : ""',
  ) + "\nparseClaudeLineRecords",
);
const rateDoc = JSON.parse(
  fs.readFileSync(process.env.HOME + "/.t3/userdata/usage-model-rates.json", "utf8"),
).document;
const rates = read("local_daily.json").rates;
const maps = Object.fromEntries(
  ["installed", "patched", "topFirst", "topLast"].map((x) => [x, new Map()]),
);
let skipped = 0,
  lines = 0,
  droppedIterations = 0;
for (const file of read("claude_files.json").sort()) {
  if (!fs.existsSync(file)) continue;
  for await (const line of readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  })) {
    if (!line.includes('"usage"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== "assistant" || !d.message?.usage || !d.timestamp) continue;
    if (d.timestamp < "2026-09-09T00:00:00Z" || d.timestamp >= "2026-09-16T00:00:00Z") continue;
    lines++;
    const a = original(line),
      b = patched(line);
    if (!a.length && b.length) skipped++;
    const usage = d.message.usage;
    droppedIterations += (usage.iterations ?? []).slice(0, -1).filter((x) => !x.model).length;
    for (const [name, records] of [
      ["installed", a],
      ["patched", b],
    ])
      for (const r of records) maps[name].set(r.dedupeKey ?? `${file}:${lines}`, r);
    const parentOnly = structuredClone(d);
    delete parentOnly.message.usage.iterations;
    for (const r of original(JSON.stringify(parentOnly))) {
      const key = r.dedupeKey ?? `${file}:${lines}`;
      if (!maps.topFirst.has(key)) maps.topFirst.set(key, r);
      maps.topLast.set(key, r);
    }
  }
}
function aggregate(records) {
  const byModel = {},
    byDay = {},
    byCwd = {};
  for (const r of records) {
    const rate = rates[r.model];
    if (!rate) continue;
    const t = r.totals;
    const tokens =
      t.uncachedInputTokens + t.cachedInputTokens + t.cacheCreationTokens + t.outputTokens;
    const base =
      t.uncachedInputTokens * rate.in + t.cachedInputTokens * rate.cr + t.outputTokens * rate.out;
    const cost5m = base + t.cacheCreationTokens * rate.cw;
    const detailed = (t.cacheCreation5mTokens ?? 0) + (t.cacheCreation1hTokens ?? 0);
    const costTTL =
      base +
      (detailed > 0
        ? (t.cacheCreation5mTokens ?? 0) * rate.in * 1.25 +
          (t.cacheCreation1hTokens ?? 0) * rate.in * 2
        : t.cacheCreationTokens * rate.cw);
    for (const [obj, key] of [
      [byModel, r.model],
      [byDay, new Date(r.timestampMs).toISOString().slice(0, 10)],
      [byCwd, r.cwd],
    ]) {
      const v = (obj[key] ??= {
        tokens: 0,
        cost5m: 0,
        costTTL: 0,
        input: 0,
        cacheRead: 0,
        cache5m: 0,
        cache1h: 0,
        output: 0,
        records: 0,
      });
      v.tokens += tokens;
      v.cost5m += cost5m;
      v.costTTL += costTTL;
      v.input += t.uncachedInputTokens;
      v.cacheRead += t.cachedInputTokens;
      v.cache5m += t.cacheCreation5mTokens ?? 0;
      v.cache1h += t.cacheCreation1hTokens ?? 0;
      v.output += t.outputTokens;
      v.records++;
    }
  }
  return { byModel, byDay, byCwd };
}
const result = {
  lines,
  skipped,
  droppedIterations,
  variants: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, aggregate(v.values())])),
};
fs.writeFileSync(new URL("reconciliation.json", dir), JSON.stringify(result, null, 2));
for (const [name, data] of Object.entries(result.variants)) {
  const claude = Object.entries(data.byModel)
    .filter(([k]) => k.startsWith("claude-"))
    .reduce((sum, [k, v]) => {
      for (const [x, y] of Object.entries(v)) sum[x] = (sum[x] ?? 0) + y;
      return sum;
    }, {});
  console.log(name, JSON.stringify(claude));
}
console.log({ lines, skipped, droppedIterations });
