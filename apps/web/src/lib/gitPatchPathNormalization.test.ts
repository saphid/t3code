import { expect, it } from "vite-plus/test";
import { normalizeGitPatchPaths } from "@t3tools/shared/gitPatchPath";
import {
  getRenderablePatch,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
} from "./diffRendering";

const unicode = String.raw`caf\303\251-\346\227\245\346\234\254`;
const patchFor = (path: string) =>
  `diff --git "a/${path}" "b/${path}"\n--- "a/${path}"\n+++ "b/${path}"\n@@ -1 +1 @@\n-before\n+after\n`;

for (const [written, expected] of [
  [`${unicode}.txt`, "café-日本.txt"],
  [`${unicode} with spaces.txt`, "café-日本 with spaces.txt"],
  [`a/${unicode}.txt`, "a/café-日本.txt"],
  [`b/${unicode}.txt`, "b/café-日本.txt"],
]) {
  it(`supplies the native code-view header with the Unicode name: ${expected}`, () => {
    const parsed = getRenderablePatch(normalizeGitPatchPaths(patchFor(written!)), "pr");
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") throw new Error("Native parser did not parse the diff");
    const file = parsed.files[0]!;
    expect(file.name).toBe(expected);
    expect(resolveFileDiffPath(file)).toBe(expected);
    const original = getRenderablePatch(patchFor(written!), "original");
    if (original?.kind !== "files") throw new Error("Original patch did not parse");
    expect(file.deletionLines).toEqual(original.files[0]!.deletionLines);
    expect(file.additionLines).toEqual(original.files[0]!.additionLines);
  });
}

it("keeps required quoting so native actions decode controls and literal escapes once", () => {
  const path = String.raw`${unicode}\t\\303\".txt`;
  const parsed = getRenderablePatch(normalizeGitPatchPaths(patchFor(path)), "pr");
  expect(parsed?.kind).toBe("files");
  if (parsed?.kind !== "files") throw new Error("Native parser did not parse the diff");
  expect(resolveFileDiffPath(parsed.files[0]!)).toBe('café-日本\t\\303".txt');
});

it("supplies both Unicode rename headers without stripping literal side prefixes", () => {
  const patch = `diff --git "a/a/${unicode}.txt" "b/b/${unicode}.txt"\nsimilarity index 100%\nrename from "a/${unicode}.txt"\nrename to "b/${unicode}.txt"\n`;
  const parsed = getRenderablePatch(normalizeGitPatchPaths(patch), "pr");
  expect(parsed?.kind).toBe("files");
  if (parsed?.kind !== "files") throw new Error("Native parser did not parse the diff");
  const file = parsed.files[0]!;
  expect(file.name).toBe("b/café-日本.txt");
  expect(file.prevName).toBe("a/café-日本.txt");
  expect(resolveFileDiffPath(file)).toBe("b/café-日本.txt");
  expect(resolveFileDiffPreviousPath(file)).toBe("a/café-日本.txt");
});
