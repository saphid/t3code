import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { hostname, cpus, totalmem, release, arch } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyze } from "./analyze.mjs";
import { digest, fixture, schedule, JOURNEYS } from "./protocol.mjs";

const LOCK = "/home/saphid/artifacts/t3-extensions-20260909/heavy-check.lock";
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath || !outputPath) throw new Error("Usage: node run.mjs plan.json NEW_OUTPUT_DIRECTORY");
if (process.env.T3_COMPARISON_LOCKED !== "1") {
  const result = spawnSync("flock", ["--exclusive", "--nonblock", LOCK, process.execPath,
    fileURLToPath(import.meta.url), planPath, outputPath], {
    stdio: "inherit", env: { ...process.env, CI: "true", NODE_OPTIONS: "--max-old-space-size=4096", T3_COMPARISON_LOCKED: "1" },
  });
  process.exit(result.status ?? 1);
}
const output = resolve(outputPath);
if (existsSync(output)) throw new Error("Output directory exists; never overwrite prior attempts");
mkdirSync(output, { recursive: true });
const run = { schema: 1, complete: false, samples: [], startedAt: new Date().toISOString() };
const persist = () => writeFileSync(resolve(output, "run.json"), JSON.stringify(run, null, 2) + "\n");
try {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!Number.isInteger(plan.seed) || !Array.isArray(plan.adapterCommand) ||
      !plan.adapterCommand.length || plan.adapterCommand.some((s) => typeof s !== "string") ||
      !Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 1 || plan.timeoutMs > 600000)
    throw new Error("Invalid seed/adapterCommand/timeoutMs");
  // The driver is explicit executable code; recording its hash makes later review possible.
  const adapterSource = readFileSync(plan.adapterSource);
  run.adapterHash = createHash("sha256").update(adapterSource).digest("hex");
  run.command = plan.adapterCommand;
  run.seed = plan.seed;
  run.builds = {};
  for (const variant of ["baseline", "candidate"]) {
    const target = plan.targets?.[variant];
    if (!target?.worktree || !/^[a-f0-9]{40}$/.test(target.sha) ||
        !target.webUrl || !target.electronCdpUrl || !target.disposableState)
      throw new Error(`Incomplete ${variant} target (URL, CDP endpoint and disposable state required)`);
    const git = (...args) => execFileSync("git", ["-C", target.worktree, ...args], { encoding: "utf8" }).trim();
    if (git("rev-parse", "HEAD") !== target.sha || git("status", "--porcelain", "--untracked-files=normal"))
      throw new Error(`${variant} must be a clean exact-SHA worktree`);
    run.builds[variant] = target.sha;
  }
  if (run.builds.baseline === run.builds.candidate) throw new Error("Candidate must differ from baseline");
  run.harnessSha = execFileSync("git", ["-C", fileURLToPath(new URL(".", import.meta.url)),
    "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  run.environment = { host: hostname(), hardware: digest({ cpu: cpus().map((c) => c.model), totalmem: totalmem(), arch: arch() }),
    node: process.version, os: release() };
  const data = fixture(plan.seed);
  run.fixtureHash = digest(data);
  writeFileSync(resolve(output, "fixture.json"), JSON.stringify(data) + "\n");
  persist();
  for (const item of schedule(plan.seed)) {
    const variant = item.group === "candidate" ? "candidate" : "baseline";
    const request = { ...item, target: plan.targets[variant], fixture: data,
      fixtureHash: run.fixtureHash, environmentHash: digest(run.environment),
      journey: JOURNEYS.find((j) => j.id === item.journey) };
    const result = spawnSync(plan.adapterCommand[0], plan.adapterCommand.slice(1), {
      input: JSON.stringify(request), encoding: "utf8", timeout: plan.timeoutMs,
      killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CI: "true", NODE_OPTIONS: "--max-old-space-size=4096" },
    });
    writeFileSync(resolve(output, `${item.id}.stdout.log`), result.stdout ?? "");
    writeFileSync(resolve(output, `${item.id}.stderr.log`), result.stderr ?? "");
    let observation;
    try { observation = JSON.parse(result.stdout); }
    catch { observation = { status: "failed", error: "Driver returned invalid/missing JSON" }; }
    // Schedule and process status are runner-owned; drivers cannot rewrite either.
    run.samples.push({ ...observation, ...item, exitCode: result.status,
      processSignal: result.signal, processError: result.error?.message });
    persist();
    if (result.status !== 0 || observation.status !== "passed") {
      run.abortReason = `Attempt ${item.id} failed; remaining coverage is incomplete`;
      break;
    }
  }
  run.complete = run.samples.length === schedule(plan.seed).length;
} catch (error) {
  run.abortReason = String(error);
} finally {
  run.finishedAt = new Date().toISOString();
  persist();
  const analysis = analyze(run);
  writeFileSync(resolve(output, "analysis.json"), JSON.stringify(analysis, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ output, status: analysis.status, reason: run.abortReason }) + "\n");
  process.exitCode = analysis.status === "passed" ? 0 : 1;
}
