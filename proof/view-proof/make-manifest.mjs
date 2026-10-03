// Writes payloads/manifest.json: the digest each view declares for its script.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const directory = new URL("./payloads/", import.meta.url);
const digest = (file) =>
  createHash("sha256")
    .update(readFileSync(new URL(file, directory)))
    .digest("base64");
const view = (id, file, extra = {}) => ({ id, file, sha256: digest(file), ...extra });

const views = [
  view("benign", "benign.js"),
  view("probe-storage", "probe-storage.js"),
  view("probe-network", "probe-network.js"),
  view("probe-navigation", "probe-navigation.js"),
  view("probe-scripts", "probe-scripts.js"),
  view("port-victim", "probe-port-victim.js"),
  view("port-attacker", "probe-port-attacker.js"),
  view("probe-stale", "probe-stale.js"),
  view("probe-self-navigate", "probe-self-navigate.js"),
  view("probe-navigate-api", "probe-navigate-api.js"),
  // Declares the digest of other bytes: the host must refuse to run it.
  { id: "tampered", file: "tampered.js", sha256: digest("benign.js") },
  view("unsafe", "unsafe.js"),
  // Same network probe with only the inherited app policy, to show the server and cookie layers.
  view("control-network-no-frame-csp", "probe-network.js", { control: true }),
];
writeFileSync(new URL("manifest.json", directory), JSON.stringify({ views }, null, 2) + "\n");
