import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const mobile = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const sdk = NodeModule.createRequire(
  NodePath.join(mobile, "../../packages/extension-sdk/package.json"),
);
const mobileRequire = NodeModule.createRequire(NodePath.join(mobile, "package.json"));
const { build } = sdk("esbuild");
const output = await build({
  entryPoints: [NodePath.join(mobile, "src/features/extensions/mobileHostPage.tsx")],
  bundle: true,
  write: false,
  metafile: true,
  format: "iife",
  minify: true,
  platform: "browser",
  target: "safari18",
  alias: {
    react: NodePath.dirname(mobileRequire.resolve("react/package.json")),
    "react-dom": NodePath.dirname(mobileRequire.resolve("react-dom/package.json")),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const reactRoots = new Set(
  Object.keys(output.metafile.inputs)
    .filter((input) => /\/react\/cjs\//.test(input))
    .map((input) => input.split("/react/cjs/")[0]),
);
if (reactRoots.size !== 1) throw new Error("The WebView host must use exactly one React identity");
const source = output.outputFiles[0].text;
await NodeFSP.mkdir(NodePath.join(mobile, ".generated/mobile-extension"), { recursive: true });
await NodeFSP.writeFile(
  NodePath.join(mobile, ".generated/mobile-extension/page.ts"),
  `export default ${JSON.stringify(source)};\n`,
);
console.log(
  `Mobile host page: ${Buffer.byteLength(source)} bytes; no pack or credentials embedded`,
);
