import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateEnvironmentPackage, validateServerExtension } from "@t3tools/extension-sdk/environment";
const sdk = path.resolve("node_modules/@t3tools/extension-sdk");
for (const name of ["README.md", "AUTHORING.md"]) {
  const contents = await fs.readFile(path.join(sdk, name), "utf8");
  for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await fs.access(path.resolve(sdk, path.dirname(name), target));
  }
}
const manifests = [];
for (const name of ["installable-files", "installable-files-consumer"]) {
  const dir = path.join(sdk, "examples", name);
  const manifest = validateEnvironmentPackage(JSON.parse(await fs.readFile(path.join(dir, "t3-extension.json"), "utf8")));
  assert.equal(manifest.format, 2);
  const client = await import(pathToFileURL(path.join(dir, manifest.clientEntry)));
  assert.equal(typeof client.default, "function");
  if (manifest.serverEntry) {
    const server = await import(pathToFileURL(path.join(dir, manifest.serverEntry)));
    validateServerExtension(manifest, server.default);
  }
  manifests.push(manifest);
}
assert.equal(manifests[1].dependencies[0].pluginId, manifests[0].manifest.id);
assert(manifests[0].provides.some(api => api.id === "t3.file/presentation"));
console.log("Packaged format-2 provider/consumer and authoring links verified; host runtime behavior is a separate check.");
