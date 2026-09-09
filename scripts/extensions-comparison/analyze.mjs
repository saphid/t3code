import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { GROUPS, JOURNEYS, METRICS, fixture, digest, schedule } from "./protocol.mjs";

const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function analyze(run) {
  const problems = [];
  const comparisons = [];
  const fail = (reason) => problems.push(reason);
  if (run?.schema !== 2 || !Number.isInteger(run?.seed)) fail("invalid run schema/seed");
  if (!sha(run?.builds?.baseline) || !sha(run?.builds?.candidate) ||
      run?.builds?.baseline === run?.builds?.candidate) fail("distinct exact build SHAs required");
  if (!sha(run?.harnessSha) || !/^[a-f0-9]{64}$/.test(run?.adapterHash ?? "")) fail("missing harness/adapter identity");
  if (!run?.environment?.host || !run?.environment?.hardware ||
      !run?.environment?.node || !run?.environment?.os) fail("missing environment identity");
  if (run?.fixtureHash !== digest(fixture(run?.seed))) fail("fixture mismatch");
  if (run?.complete !== true) fail("run incomplete");
  const expected = schedule(run?.seed);
  const rows = Array.isArray(run?.samples) ? run.samples : [];
  if (rows.length !== expected.length) fail("missing or extra samples including warmup");
  const seen = new Set();
  const conformance = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], target = expected[i];
    if (!row || !target || Object.keys(target).some((key) => row[key] !== target[key])) {
      fail(`schedule mismatch at ${i}`); continue;
    }
    if (seen.has(row.id)) fail(`duplicate sample ${row.id}`);
    seen.add(row.id);
    const journey = JOURNEYS.find((item) => item.id === row.journey);
    const build = row.group === "candidate" ? run.builds?.candidate : run.builds?.baseline;
    if (row.status !== "passed" || row.exitCode !== 0) fail(`failed attempt ${row.id}`);
    if (row.fixtureHash !== run.fixtureHash || row.servedBuildSha !== build ||
        row.environmentHash !== digest(run.environment) || !row.clientVersion ||
        row.realClient !== journey.client) fail(`sample identity mismatch ${row.id}`);
    if (row.phase === "conformance") {
      conformance.set(row.id, row);
      if (!Array.isArray(row.checks) || journey.checks.some((id) =>
        !row.checks.some((check) => check?.id === id && check.passed === true &&
          typeof check.evidence === "string" && check.evidence.length > 0))) fail(`behavior coverage missing ${row.id}`);
      const soak = row.soak;
      if (!soak || !Number.isInteger(soak.cycles) || soak.cycles < 100 ||
          !finite(soak.durationMs) || soak.durationMs === 0 ||
          !Number.isInteger(soak.eventCount) || soak.eventCount < 100 ||
          soak.lostEvents !== 0 || soak.unrelatedSessionAlive !== true ||
          !Array.isArray(soak.faults) || fixture(run.seed).faults.some((f) => !soak.faults.includes(f)) ||
          ["listeners", "handles", "resources"].some((key) =>
            !finite(soak.before?.[key]) || soak.after?.[key] !== soak.before[key]))
        fail(`reliability proof missing or leaked ${row.id}`);
    } else {
      if (Object.keys(METRICS).some((name) => !finite(row.metrics?.[name]))) fail(`metric missing/invalid ${row.id}`);
      const evidence = conformance.get(row.conformanceId);
      if (!evidence || evidence.status !== "passed" ||
          evidence.group !== (row.group === "candidate" ? "candidate" : "baseline") ||
          ["batch", "journey", "client", "fixtureHash", "servedBuildSha",
            "environmentHash", "clientVersion", "realClient"].some((key) => evidence[key] !== row[key]))
        fail(`missing or mismatched conformance reference ${row.id}`);
    }
  }
  if (problems.length) return { status: "failed", problems, comparisons };
  for (const journey of JOURNEYS) {
    const measured = rows.filter((r) => r.journey === journey.id && r.phase === "timing" && !r.warmup);
    if (new Set(rows.filter((r) => r.journey === journey.id).map((r) => r.clientVersion)).size !== 1)
      fail(`client version mismatch: ${journey.id}`);
    for (const [metric, spec] of Object.entries(METRICS)) {
      const batches = [];
      for (let batch = 0; batch < 3; batch++) {
        const groups = Object.fromEntries(GROUPS.map((group) => {
          const values = measured.filter((r) => r.batch === batch && r.group === group).map((r) => r.metrics[metric]);
          return [group, { p50: quantile(values, .5), p95: quantile(values, .95) }];
        }));
        const a = groups.calibrationA.p95, b = groups.calibrationB.p95;
        const base = groups.baseline.p95, candidate = groups.candidate.p95;
        const noise = Math.abs(a - b);
        const delta = spec.higherBetter ? base - candidate : candidate - base;
        const material = Math.max(base * .03, spec.floor);
        batches.push({ batch, groups, noise, delta, material,
          noisy: noise > Math.max(Math.max(a, b) * .05, spec.floor * 2),
          regressed: delta > Math.max(material, noise * 2),
          unresolved: delta > material && delta <= noise * 2,
          investigation: delta > Math.max(base * .1, spec.unit === "ms" ? 5 : 0) });
      }
      const noisy = batches.some((b) => b.noisy || b.unresolved);
      const regressions = batches.filter((b) => b.regressed).length;
      const status = noisy ? "inconclusive" : regressions >= 2 ? "regressed" : regressions ? "inconclusive" : "passed";
      comparisons.push({ journey: journey.id, metric, status, batches });
      if (status !== "passed") fail(`${journey.id}/${metric}: ${status}; diagnose and rerun, retain this run`);
    }
  }
  return { status: problems.length ? "failed" : "passed", problems, comparisons };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = analyze(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "failed", problems: [String(error)] }) + "\n");
    process.exitCode = 1;
  }
}
