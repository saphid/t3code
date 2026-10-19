import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { graph, seeds } from "./discover.mjs";
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "instruction-fixture-")));
const write = (name, text = "") => {
  const p = path.join(root, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
try {
  write(".git", "fixture");
  write(".gitignore", "ignored/\n");
  write("CLAUDE.md", "@AGENTS.md\r\n");
  write(
    "AGENTS.md",
    "\uFEFF[guide][g]\r\n\r\n[g]: <docs/space name.md#section>\r\n\r\n" +
      "[nested](docs/a(b).md)\n[newline](docs/line%0Abreak.md)\n" +
      "Read `.agents/skills/demo/SKILL.md`.\nRead `docs/不存在.md`.\n" +
      "Run `node scripts/check.mjs`.\nSee docs/plain.md:12.\n" +
      "[missing](docs/missing.md)\n[web](https://example.com/skip.md)\n" +
      "[loop](docs/loop.md)\n[encoded](docs/utf16.md)\n",
  );
  write("docs/space name.md", "[back](../AGENTS.md)\n");
  write("docs/a(b).md", "[asset](image.png)\n");
  write("docs/image.png", Buffer.from([0, 1, 2]));
  write("docs/line\nbreak.md", "Leaf.");
  write("docs/不存在.md", "Leaf.");
  write("docs/plain.md", "Leaf.");
  write("docs/utf16.md", Buffer.from("\uFEFF[leaf](encoded-leaf.md)\r\n", "utf16le"));
  write("docs/encoded-leaf.md", "Leaf.");
  write("scripts/check.mjs", 'console.log("no execution");');
  write(".agents/skills/demo/SKILL.md", "[helper](references/helper.md)\n");
  write(".agents/skills/demo/references/helper.md", "Read `./extensionless`.\n");
  write(".agents/skills/demo/references/extensionless", "leaf");
  write("ignored/deep/aGeNtS.Md", "Hidden ignored seed.");
  write(".hidden/CLAUDE.local.md", "Local seed.");
  write("AGENTS.override.md", "Override seed.");
  write("backup/CLAUDE.md.bak", "Not a seed.");
  fs.symlinkSync("../AGENTS.md", path.join(root, "docs/loop.md"));
  fs.symlinkSync(".", path.join(root, "cycle"));
  const inventory = seeds(root).paths;
  assert.equal(inventory.length, 6);
  assert(inventory.includes(path.join(root, "ignored/deep/aGeNtS.Md")));
  const optimized = graph(inventory, root, { prefilter: true });
  const full = graph(inventory, root, { prefilter: false });
  assert.deepEqual(optimized.files, full.files, "rg prefilter must preserve the file set");
  for (const expected of [
    "docs/space name.md",
    "docs/a(b).md",
    "docs/line\nbreak.md",
    "docs/不存在.md",
    "docs/plain.md",
    "docs/utf16.md",
    "docs/encoded-leaf.md",
    "docs/image.png",
    "scripts/check.mjs",
    ".agents/skills/demo/references/helper.md",
    ".agents/skills/demo/references/extensionless",
    "docs/loop.md",
  ]) {
    assert(optimized.files.includes(path.join(root, expected)), `Missing ${expected}`);
  }
  assert(optimized.issues.some((i) => i.kind === "unresolved" && i.value === "docs/missing.md"));
  assert(!optimized.files.some((f) => f.includes("example.com")));
  console.log(
    JSON.stringify(
      {
        passed: true,
        seeds: inventory.length,
        reachableFiles: optimized.files.length,
        cases: [
          "hidden",
          "ignored",
          "case variants",
          "local/override names",
          "backup exclusion",
          "BOM",
          "CRLF",
          "UTF-16 BOM",
          "@import",
          "reference links",
          "spaces",
          "parentheses",
          "percent-encoded newline",
          "Unicode",
          "line suffix",
          "command path",
          "recursive links",
          "extensionless file",
          "asset leaf",
          "missing file",
          "remote URL",
          "reference cycle",
          "symlink cycle",
          "prefilter parity",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
