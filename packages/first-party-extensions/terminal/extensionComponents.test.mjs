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
const { resolveTerminalChord } = await import("./viewModel.ts");

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

const fireDocument = (type) => documentListeners.get(type)?.();

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

/** A pane-output host that records which terminalIds hold live streams. */
function paneStreamHost() {
  const active = new Set();
  const host = {
    subscribeApi: (request, signal) => ({
      async *[Symbol.asyncIterator]() {
        const terminalId = request.input?.terminalId ?? "?";
        active.add(terminalId);
        try {
          await new Promise((resolve) =>
            signal.aborted ? resolve() : signal.addEventListener("abort", resolve, { once: true }),
          );
        } finally {
          active.delete(terminalId);
        }
      },
    }),
  };
  return { host, active };
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

NodeTest.describe("group switch waiter wake (r3 finding 2)", () => {
  NodeTest.test(
    "a group switch connects the newly visible pane after demotions drain",
    async () => {
      // The reviewer's GROUP_SWITCH_WAIT probe, on real TerminalPane
      // components: three fixed feeds plus a1..a4/c fill the pool, b is
      // hidden and unallocated. Reorder b first and show only b and c —
      // pre-fix, b's failed acquire never retried because the later
      // demotions of a1..a4 did not wake waiters, leaving the visible pane
      // disconnected despite evictable streams.
      const { host, active } = paneStreamHost();
      const session = {
        signal: new AbortController().signal,
        context: { resource: { threadId: "t", environmentId: "e" } },
      };
      const panel = { resetInput() {}, resize() {}, sendInput() {} };
      const assets = { kind: "ready", runtime: {}, symbolsFontUrl: "fixture" };
      const paneProps = (terminalId) => ({
        host,
        session,
        panel,
        terminalId,
        streamKeyPrefix: "review",
        active: false,
        shown: true,
        visible: true,
        assets,
        themeVars: null,
        appearanceVars: null,
      });
      const releases = [];
      for (const key of ["sessions", "theme", "appearance"]) {
        releases.push(
          bundle.streamHub.acquireFixedFeed(key, { onFrame() {}, onStatus() {} }, () => {}),
        );
      }
      const render = (order, shown) =>
        React.createElement(
          React.Fragment,
          null,
          ...order.map((terminalId) =>
            React.createElement(bundle.TerminalPane, {
              ...paneProps(terminalId),
              key: terminalId,
              shown: shown.includes(terminalId),
            }),
          ),
        );
      let renderer;
      await act(async () => {
        renderer = create(
          render(["a1", "a2", "a3", "a4", "c", "b"], ["a1", "a2", "a3", "a4", "c"]),
          {
            createNodeMock: nodeMock,
          },
        );
      });
      try {
        // Sanity: the five visible panes hold the budget's mandatory slots and
        // the hidden pane's optional acquire was refused, not churned.
        NodeAssert.deepEqual([...active].sort(), ["a1", "a2", "a3", "a4", "c"]);
        NodeAssert.equal(bundle.streamHub.paneSlotAvailable(), false);
        await act(async () => {
          renderer.update(render(["b", "a1", "a2", "a3", "a4", "c"], ["b", "c"]));
        });
        // After the switch, the newly visible pane owns a stream: the
        // demotions of a1..a4 woke its waiter, which evicted one of them.
        NodeAssert.equal(active.has("b"), true);
        NodeAssert.equal(active.has("c"), true);
        const disconnected = renderer.root
          .findAllByType(bundle.TerminalPane)
          .find((node) => node.props.terminalId === "b")
          .findAll((node) => node.props["aria-label"] === "Stream budget");
        NodeAssert.equal(disconnected.length, 0);
      } finally {
        await act(async () => renderer.unmount());
      }
      for (const release of releases) release();
      await act(async () => {}); // drain the pumps' async teardown
      NodeAssert.equal(active.size, 0);
    },
  );
});

NodeTest.describe("first-focus chord refresh (r3 finding 5)", () => {
  NodeTest.test("the first focusin after mount refreshes conflicts unthrottled", async () => {
    // The reviewer's FIRST_FOCUS_REMAP_RACE probe: the surface mounts
    // unfocused, so its mount-time listConflicts ran outside the focus
    // context and returned no rows. The user's mod+d -> terminal.close
    // rule only becomes visible once the surface is focused; a focusin
    // 100ms after mount was swallowed by the 1s throttle, and the next
    // mod+d dispatched the stale default (split) instead of close.
    let focused = false;
    let invocations = 0;
    const keyHost = {
      invokeApi: async () => {
        invocations += 1;
        return {
          conflicts: focused
            ? [{ key: "mod+d", command: "terminal.close", winner: "user", loser: "split" }]
            : [],
        };
      },
    };
    const session = {
      signal: new AbortController().signal,
      context: { resource: { threadId: "t", environmentId: "e" } },
    };
    let chordState;
    function ChordProbe() {
      chordState = bundle.useTerminalChordConflicts(keyHost, session, true);
      return null;
    }
    const realNow = Date.now;
    let clock = 0;
    Date.now = () => clock;
    let renderer;
    try {
      await act(async () => {
        renderer = create(React.createElement(ChordProbe), { createNodeMock: nodeMock });
      });
      NodeAssert.equal(invocations, 1);
      NodeAssert.deepEqual(chordState.conflictsRef.current, []);
      clock = 100;
      focused = true;
      await act(async () => fireDocument("focusin"));
      // The focus transition bypassed the 1s throttle: the remap row is
      // in before the next keypress resolves.
      NodeAssert.equal(invocations, 2);
      NodeAssert.equal(resolveTerminalChord("mod+d", chordState.conflictsRef.current), "close");
      // An explicit refresh inside the same second stays throttled.
      chordState.refreshChords();
      await act(async () => {});
      NodeAssert.equal(invocations, 2);
      // The next focus edge (leave, re-enter) bypasses again.
      fireDocument("focusout");
      clock = 150;
      await act(async () => fireDocument("focusin"));
      NodeAssert.equal(invocations, 3);
    } finally {
      await act(async () => renderer.unmount());
      Date.now = realNow;
    }
  });
});

NodeTest.describe("hidden waiters retry at current visibility (r4 finding 1)", () => {
  NodeTest.test("refused hidden waiters cannot seize demoted slots as mandatory", async () => {
    // The reviewer's HIDDEN_WAITERS_STEAL_DEMOTED_SLOTS probe: five
    // visible panes fill the pool, four hidden panes and b are refused
    // and wait. Switching to [b, c] demotes a1..a4 — pre-fix, every
    // hidden waiter's retry acquired MANDATORY, so the demotions handed
    // h1..h4 permanent mandatory slots and the newly visible b starved
    // behind "Stream budget" with nothing left to evict.
    const { host, active } = paneStreamHost();
    const session = {
      signal: new AbortController().signal,
      context: { resource: { threadId: "t", environmentId: "e" } },
    };
    const panel = { resetInput() {}, resize() {}, sendInput() {} };
    const assets = { kind: "ready", runtime: {}, symbolsFontUrl: "fixture" };
    const paneProps = (terminalId) => ({
      host,
      session,
      panel,
      terminalId,
      streamKeyPrefix: "review",
      active: false,
      shown: true,
      visible: true,
      assets,
      themeVars: null,
      appearanceVars: null,
    });
    const releases = [];
    for (const key of ["sessions", "theme", "appearance"]) {
      releases.push(
        bundle.streamHub.acquireFixedFeed(key, { onFrame() {}, onStatus() {} }, () => {}),
      );
    }
    const ids = ["a1", "a2", "a3", "a4", "c", "h1", "h2", "h3", "h4", "b"];
    const render = (order, shown) =>
      React.createElement(
        React.Fragment,
        null,
        ...order.map((terminalId) =>
          React.createElement(bundle.TerminalPane, {
            ...paneProps(terminalId),
            key: terminalId,
            shown: shown.includes(terminalId),
          }),
        ),
      );
    let renderer;
    await act(async () => {
      renderer = create(render(ids, ["a1", "a2", "a3", "a4", "c"]), {
        createNodeMock: nodeMock,
      });
    });
    try {
      NodeAssert.deepEqual([...active].sort(), ["a1", "a2", "a3", "a4", "c"]);
      await act(async () => {
        renderer.update(render(["b", ...ids.slice(0, 9)], ["b", "c"]));
      });
      // The whole switch resolves inside the update's effect flush: the
      // demotion wakes resolve in bounded cycles, no polling.
      const paneB = renderer.root
        .findAllByType(bundle.TerminalPane)
        .find((node) => node.props.terminalId === "b");
      NodeAssert.equal(
        paneB.findAll((node) => node.props["aria-label"] === "Stream budget").length,
        0,
      );
      // The hidden waiters stayed optional: none of them holds a stream,
      // and the pool keeps evictable capacity for the next visible pane.
      for (const hidden of ["h1", "h2", "h3", "h4"]) {
        NodeAssert.equal(active.has(hidden), false);
      }
      NodeAssert.equal(bundle.streamHub.paneSlotAvailable(), true);
      // b evicted exactly one demoted a-pane; the rest demoted in place.
      NodeAssert.deepEqual([...active].sort(), ["a2", "a3", "a4", "b", "c"]);
    } finally {
      await act(async () => renderer.unmount());
    }
    for (const release of releases) release();
    await act(async () => {}); // drain the pumps' async teardown
    NodeAssert.equal(active.size, 0);
  });
});

NodeTest.describe("two full views sidebar switch (r4 finding 1)", () => {
  NodeTest.test("the selected pane wins the stream budget in both placements", async () => {
    // The reviewer's TWO_FULL_VIEWS_SIDEBAR_SWITCH probe: two complete
    // TerminalView placements for one thread, eleven restored sessions.
    // Selecting b through its real sidebar callback demotes a1..a4 in the
    // left placement — pre-fix, the left placement's earlier refused
    // hidden waiters re-acquired MANDATORY slots on those demotions, the
    // streams stayed on c/h2..h5, and the visible b showed "Stream budget".
    const active = new Map();
    let counter = 0;
    const host = {
      readAsset: () => new Promise(() => {}),
      invokeApi: async (request) =>
        request.method === "listConflicts" ? { conflicts: [] } : { tokens: {}, cssVars: {} },
      subscribeApi: (request, signal) => ({
        async *[Symbol.asyncIterator]() {
          const id = ++counter;
          active.set(id, request.input?.terminalId ?? request.name);
          try {
            await new Promise((resolve) =>
              signal.aborted
                ? resolve()
                : signal.addEventListener("abort", resolve, { once: true }),
            );
          } finally {
            active.delete(id);
          }
        },
      }),
    };
    const ids = ["a1", "a2", "a3", "a4", "h1", "h2", "h3", "h4", "h5", "b", "c"];
    const groups = [
      { id: "g", terminalIds: ["a1", "a2", "a3", "a4"] },
      ...ids.slice(4).map((terminalId) => ({ id: terminalId, terminalIds: [terminalId] })),
    ];
    const sessionFor = (activeId) => ({
      signal: new AbortController().signal,
      context: { resource: { threadId: "full", environmentId: "e" } },
      visible: true,
      save() {},
      onVisibility: () => () => {},
      bindCommands: () => () => {},
      restoreState: {
        terminalIds: ids,
        activeTerminalId: activeId,
        terminalGroups: groups,
        activeTerminalGroupId: activeId === "a1" ? "g" : activeId,
      },
    });
    let renderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(bundle.TerminalView, {
            host,
            session: sessionFor("a1"),
            key: "left",
          }),
          React.createElement(bundle.TerminalView, {
            host,
            session: sessionFor("c"),
            key: "right",
          }),
        ),
        { createNodeMock: nodeMock },
      );
    });
    try {
      // The shared feeds (3) plus five pane slots sit exactly at the cap.
      NodeAssert.equal(active.size, 8);
      const leftTree = renderer.root.findAllByType(bundle.TerminalView)[0];
      const selectB = leftTree
        .findAllByType("li")
        .find((node) =>
          node.findAllByType("button").some((button) => button.props["aria-label"] === "Close b"),
        )
        .findAllByType("button")[0];
      await act(async () => selectB.props.onClick());
      const visible = leftTree
        .findAllByType(bundle.TerminalPane)
        .filter((node) => node.props.shown)
        .map((node) => ({
          id: node.props.terminalId,
          waiting: node.findAll((inner) => inner.props["aria-label"] === "Stream budget").length,
        }));
      NodeAssert.deepEqual(visible, [{ id: "b", waiting: 0 }]);
      NodeAssert.equal([...active.values()].includes("b"), true);
      NodeAssert.equal(active.size, 8);
    } finally {
      await act(async () => renderer.unmount());
    }
    NodeAssert.equal(active.size, 0);
  });
});
