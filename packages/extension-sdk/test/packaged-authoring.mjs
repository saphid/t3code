import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import {
  validateEnvironmentPackage,
  validateServerExtension,
} from "@t3tools/extension-sdk/environment";
const sdk = NodePath.resolve("node_modules/@t3tools/extension-sdk");
for (const name of ["README.md", "AUTHORING.md"]) {
  const contents = await NodeFSP.readFile(NodePath.join(sdk, name), "utf8");
  for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await NodeFSP.access(NodePath.resolve(sdk, NodePath.dirname(name), target));
  }
}
const manifests = [];
for (const name of [
  "installable-files",
  "installable-files-consumer",
  "installable-terminal-observer",
]) {
  const dir = NodePath.join(sdk, "examples", name);
  const manifest = validateEnvironmentPackage(
    JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "t3-extension.json"), "utf8")),
  );
  NodeAssert.equal(manifest.format, 2);
  const client = await import(NodeURL.pathToFileURL(NodePath.join(dir, manifest.clientEntry)));
  NodeAssert.equal(typeof client.default, "function");
  if (manifest.serverEntry) {
    const server = await import(NodeURL.pathToFileURL(NodePath.join(dir, manifest.serverEntry)));
    validateServerExtension(manifest, server.default);
  }
  manifests.push(manifest);
}
NodeAssert.equal(manifests[1].dependencies[0].pluginId, manifests[0].manifest.id);
NodeAssert.ok(manifests[2].requires.some((api) => api.id === "t3.terminal/sessions"));
NodeAssert.ok(manifests[0].provides.some((api) => api.id === "t3.file/presentation"));
console.log(
  "Packaged format-2 provider/consumer and authoring links verified; host runtime behavior is a separate check.",
);

const streamPackages = [];
for (const name of ["installable-stream-provider", "installable-stream-consumer"]) {
  const dir = NodePath.join(sdk, "examples", name);
  const pkg = validateEnvironmentPackage(
    JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "t3-extension.json"), "utf8")),
  );
  NodeAssert.equal(pkg.format, 3);
  const client = await import(NodeURL.pathToFileURL(NodePath.join(dir, pkg.clientEntry)));
  NodeAssert.equal(typeof client.default, "function");
  const server = await import(NodeURL.pathToFileURL(NodePath.join(dir, pkg.serverEntry)));
  validateServerExtension(pkg, server.default);
  streamPackages.push(pkg);
}
NodeAssert.equal(streamPackages[1].dependencies[0].pluginId, streamPackages[0].manifest.id);
console.log(
  "Packaged format-3 provider/consumer declarations verified; worker/network proof remains separate.",
);
