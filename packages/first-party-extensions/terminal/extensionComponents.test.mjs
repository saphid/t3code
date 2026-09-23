/**
 * Component-level regressions over the REAL extension.tsx tree, bundled by
 * esbuild with the Ghostty surface replaced by a recording stub. These pin
 * the r2 reviewer's probe shapes as tests: cold-restore stream budget,
 * group-switch waiter wake, and the first-focus chord-conflict refresh.
 *
 * The bundle is written to the system tmpdir, never into the package, so
 * the shipped tree stays free of test-only builds.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(new URL(".", import.meta.url));
const { build } = require("esbuild");
const React = require("react");
const { act, create } = require("react-test-renderer");

const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));

// The DOM surface the view touches outside React: theme observation, focus
// listeners, and the canvas probe the (stubbed) renderer would use.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.getComputedStyle = () => ({
  colorScheme: "dark",
  backgroundColor: "rgb(10,20,30)",
  color: "rgb(200,210,220)",
  getPropertyValue: () => "",
});
const documentListeners = new Map();
globalThis.document = {
  body: {},
  documentElement: { classList: { contains: () => true } },
  createElement: () => ({
    getContext: () => ({
      clearRect() {},
      fillRect() {},
      getImageData: () => ({ data: [10, 20, 30, 255] }),
    }),
  }),
  addEventListener: (type, handler) => documentListeners.set(type, handler),
  removeEventListener: (type) => documentListeners.delete(type),
};

const surfaceStub = `
export class GhosttyTerminalSurface {
  static surfaces = [];
  static pending = [];
  static delay = false;
  static focusOwner = null;
  static async create(mount, options) {
    const surface = new this();
    surface.options = options;
    surface.mount = mount;
    GhosttyTerminalSurface.surfaces.push(surface);
    if (GhosttyTerminalSurface.delay) {
      await new Promise((resolve) => GhosttyTerminalSurface.pending.push(resolve));
    }
    return surface;
  }
  setTheme() {}
  async setFont() {}
  setVisible() {}
  write() {}
  resetAndWrite() {}
  dispose() {}
  focus() {
    GhosttyTerminalSurface.focusOwner = this;
  }
}
`;

let bundle;

NodeTest.before(async () => {
  const built = await build({
    stdin: {
      contents:
        NodeFS.readFileSync(NodePath.join(packageDir, "extension.tsx"), "utf8") +
        "\nexport { TerminalPane, TerminalView, streamHub, useTerminalChordConflicts };",
      resolveDir: packageDir,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "surface-stub",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/ghostty\/surface\.ts$/ }, () => ({
            path: "surface-stub",
            namespace: "surface-stub",
          }));
          builder.onLoad({ filter: /.*/, namespace: "surface-stub" }, () => ({
            contents: surfaceStub,
            loader: "js",
          }));
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
        },
      },
    ],
  });
  const bundlePath = NodePath.join(
    NodeOS.tmpdir(),
    `t3-terminal-components-${process.pid}-${Date.now()}.mjs`,
  );
  await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
  bundle = await import(NodeURL.pathToFileURL(bundlePath).href);
});

const nodeMock = (element) => ({ id: element.props["aria-label"] });

function sessionMetadata(terminalId) {
  return {
    terminalId,
    status: "running",
    label: "",
    hasRunningSubprocess: false,
    exitCode: null,
    exitSignal: null,
    updatedAt: "2026-09-24T00:00:00Z",
  };
}

NodeTest.describe("cold restore stream budget (r3 finding 1)", () => {
  NodeTest.test(
    "eight-session restore admits sessions/theme/appearance inside the cap",
    async () => {
      // The reviewer's COLD_RESTORE_STREAM_CAP probe: pane effects run before
      // the view's fixed-feed effects, hidden panes take optional slots, and
      // pre-fix the three fixed subscriptions were rejected over the cap —
      // the panel never went live and New stayed disabled.
      const active = new Set();
      const attempts = [];
      const rejects = [];
      const host = {
        readAsset: () => new Promise(() => {}),
        invokeApi: async (request) =>
          request.method === "listConflicts" ? { conflicts: [] } : { tokens: {}, cssVars: {} },
        subscribeApi: (request, signal) => ({
          async *[Symbol.asyncIterator]() {
            const name = `${request.id}/${request.name}${
              request.input?.terminalId ? `/${request.input.terminalId}` : ""
            }`;
            attempts.push(name);
            if (active.size >= 8) {
              rejects.push(name);
              throw new Error("Plugin stream limit reached");
            }
            const instance = `${name}#${attempts.length}`;
            active.add(instance);
            try {
              if (request.name === "list") {
                // The real sessions stream opens with its snapshot — the frame
                // that takes a restored panel live.
                yield {
                  value: {
                    kind: "snapshot",
                    terminals: Array.from({ length: 8 }, (_, index) =>
                      sessionMetadata(`cold${index}`),
                    ),
                  },
                };
              }
              await new Promise((resolve) =>
                signal.aborted
                  ? resolve()
                  : signal.addEventListener("abort", resolve, { once: true }),
              );
            } finally {
              active.delete(instance);
            }
          },
        }),
      };
      const session = {
        signal: new AbortController().signal,
        context: { resource: { threadId: "t", environmentId: "e" } },
        visible: true,
        save() {},
        onVisibility: () => () => {},
        bindCommands: () => () => {},
        restoreState: {
          terminalIds: Array.from({ length: 8 }, (_, index) => `cold${index}`),
          activeTerminalId: "cold0",
        },
      };
      let renderer;
      await act(async () => {
        renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
          createNodeMock: nodeMock,
        });
      });
      try {
        // No subscription was rejected — the fixed feeds preempted optional
        // hidden-pane slots instead of starting over the cap.
        NodeAssert.deepEqual(rejects, []);
        for (const method of ["list", "subscribeState", "subscribeTerminalAppearance"]) {
          NodeAssert.ok(
            attempts.some((name) => name.includes(`/${method}`)),
            `missing ${method} subscription`,
          );
        }
        // Exactly the cap in flight: 3 shared fixed feeds + the active pane +
        // the four hidden panes the budget still covers. The other three
        // hidden panes were refused honestly and wait for a free slot.
        NodeAssert.equal(active.size, 8);
        const paneStreams = [...active]
          .map((instance) => instance.replace(/#\d+$/, ""))
          .filter((name) => /\/subscribe\/cold\d+$/.test(name));
        NodeAssert.equal(paneStreams.length, 5);
        NodeAssert.ok(paneStreams.some((name) => name.endsWith("/cold0")));
        const newButton = renderer.root
          .findAllByType("button")
          .find((node) => node.children.includes("New terminal"));
        NodeAssert.equal(newButton.props.disabled, false);
      } finally {
        await act(async () => renderer.unmount());
      }
      NodeAssert.equal(active.size, 0);
      NodeAssert.deepEqual(
        attempts.filter((name) => name.includes("/list")),
        [attempts.find((name) => name.includes("/list"))],
      );
    },
  );
});
