/**
 * Escape in the address field over the REAL addressInput.tsx, bundled by
 * esbuild into the system tmpdir and driven with react-test-renderer under a
 * host that owns the draft like the panel does.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(new URL(".", import.meta.url));
const { build } = require("esbuild");
const React = require("react");
const { act, create } = require("react-test-renderer");

const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let AddressInput;
let committedAddress;

NodeTest.before(async () => {
  const built = await build({
    entryPoints: [NodePath.join(packageDir, "addressInput.tsx")],
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "external-react",
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
        },
      },
    ],
  });
  const bundleDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-address-input-"));
  const bundlePath = NodePath.join(bundleDir, "bundle.mjs");
  try {
    await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
    ({ AddressInput, committedAddress } = await import(NodeURL.pathToFileURL(bundlePath).href));
  } finally {
    await NodeFSP.rm(bundleDir, { recursive: true, force: true });
  }
});

function mountAddress(committed) {
  const submits = [];
  let value = committed;
  let renderer;
  const render = () =>
    React.createElement(AddressInput, {
      value,
      committed,
      onValueChange: (next) => {
        value = next;
        renderer.update(render());
      },
      onSubmit: (next) => submits.push(next),
      inputRef: null,
      style: {},
    });
  act(() => {
    renderer = create(render());
  });
  const input = () => renderer.root.find((node) => node.props["aria-label"] === "Address");
  return {
    submits,
    value: () => input().props.value,
    type(next) {
      act(() => input().props.onChange({ target: { value: next } }));
    },
    key(key) {
      const event = {
        key,
        blurred: false,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        currentTarget: {
          blur() {
            event.blurred = true;
          },
        },
      };
      act(() => input().props.onKeyDown(event));
      return event;
    },
  };
}

NodeTest.describe("address field keys", () => {
  NodeTest.it("Escape cancels the edit: the draft returns to the page and focus leaves", () => {
    const address = mountAddress("https://example.com/");
    address.type("https://exam");
    const escape = address.key("Escape");
    NodeAssert.equal(address.value(), "https://example.com/");
    NodeAssert.equal(escape.blurred, true);
    NodeAssert.equal(escape.defaultPrevented, true);
    NodeAssert.deepEqual(address.submits, []);
  });

  NodeTest.it("Enter submits the draft", () => {
    const address = mountAddress("https://example.com/");
    address.type("localhost:3000");
    address.key("Enter");
    NodeAssert.deepEqual(address.submits, ["localhost:3000"]);
  });

  NodeTest.it("returns to the file on show, then the page, then the target", () => {
    NodeAssert.equal(
      committedAddress({ fileSource: "docs/a.html", pageUrl: "http://lease/x", target: "t" }),
      "docs/a.html",
    );
    NodeAssert.equal(
      committedAddress({ fileSource: null, pageUrl: "https://a.test/", target: "https://b.test/" }),
      "https://a.test/",
    );
    NodeAssert.equal(committedAddress({ fileSource: null, pageUrl: null, target: null }), "");
  });
});
