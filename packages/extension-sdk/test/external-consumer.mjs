import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
const sdk = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const root = NodePath.resolve(sdk, "../..");
const artifact = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-extension-consumer-"));
const consumer = NodePath.join(artifact, "consumer");
NodeFS.cpSync(NodePath.join(sdk, "examples/counter"), consumer, { recursive: true });
function run(command, args, cwd) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true", NODE_OPTIONS: "--max-old-space-size=4096" },
  });
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}: ${result.error ?? ""}`);
}
run("npm", ["pack", "--ignore-scripts", "--pack-destination", artifact], sdk);
const pkg = JSON.parse(NodeFS.readFileSync(NodePath.join(consumer, "package.json"), "utf8"));
pkg.dependencies["@t3tools/extension-sdk"] =
  `file:${NodePath.join(artifact, "t3tools-extension-sdk-0.1.0.tgz")}`;
NodeFS.writeFileSync(NodePath.join(consumer, "package.json"), JSON.stringify(pkg, null, 2));
run("npm", ["install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"], consumer);
const installedExample = NodePath.join(
  consumer,
  "node_modules/@t3tools/extension-sdk/examples/counter/counter.ts",
);
NodeFS.copyFileSync(installedExample, NodePath.join(consumer, "packaged-counter.ts"));
const configPath = NodePath.join(consumer, "tsconfig.json");
const config = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
config.include.push("packaged-counter.ts");
NodeFS.writeFileSync(configPath, JSON.stringify(config, null, 2));
run(
  process.env.T3_EXTENSION_TSC ?? NodePath.join(root, "node_modules/.bin/tsc"),
  ["-p", "tsconfig.json"],
  consumer,
);
run(process.execPath, ["--test", "consumer.test.mjs"], consumer);
console.log(`External consumer artifact: ${artifact}`);
