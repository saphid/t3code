import { expect, it } from "@effect/vitest";
import * as NodeBuffer from "node:buffer";
import { boundedWorkspaceText } from "./workspaceText.ts";
import { validateWorkspaceReadTextInput } from "@t3tools/extension-sdk/workspace";

it("preserves a small actual read and rejects absolute/traversing capability paths", () => {
  const input = {
    relativePath: "src/file.txt",
    contents: "hello 🌈",
    byteLength: 10,
    truncated: false,
  };
  expect(boundedWorkspaceText(input)).toEqual(input);
  for (const relativePath of ["/etc/passwd", "../secret", "a/../b", "C:\\secret", "a\u0000b"])
    expect(() => validateWorkspaceReadTextInput({ relativePath })).toThrow();
});
it.each(["a", "🌈", "\u0000", '"\\\n'])(
  "bounds serialized text including escaped Unicode %j",
  (unit) => {
    const contents = unit.repeat(100000);
    const bytes = NodeBuffer.Buffer.byteLength(contents, "utf8");
    const result = boundedWorkspaceText({
      relativePath: "nested/fixture.txt",
      contents,
      byteLength: bytes,
      truncated: false,
    });
    expect(NodeBuffer.Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(65536);
    expect(result.byteLength).toBe(bytes);
    expect(result.truncated).toBe(true);
    expect(contents.startsWith(result.contents)).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(result.contents)).toBe(false);
  },
);
