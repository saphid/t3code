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
        "\nexport { TerminalPane, TerminalView, streamHub, useTerminalChordConflicts, handleBeforeKey };",
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

NodeTest.describe("conflicts response generation (r4 finding 2)", () => {
  NodeTest.test("a late older reply cannot overwrite the focused answer", async () => {
    // The reviewer's FOCUS_RESPONSE_ORDER probe, without sleeps: the
    // mount-time request and the unthrottled focused request are both
    // outstanding, and the older mount reply resolves LAST. Pre-fix, every
    // response applied unconditionally, so the stale pre-focus list
    // overwrote the focused rows and mod+d flipped back to split.
    const requests = [];
    const deferredHost = {
      invokeApi: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    };
    const session = {
      signal: new AbortController().signal,
      context: { resource: { threadId: "t", environmentId: "e" } },
    };
    let chordState;
    function ChordProbe() {
      chordState = bundle.useTerminalChordConflicts(deferredHost, session, true);
      return null;
    }
    let renderer;
    await act(async () => {
      renderer = create(React.createElement(ChordProbe), { createNodeMock: nodeMock });
    });
    try {
      NodeAssert.equal(requests.length, 1); // the mount-time request
      await act(async () => fireDocument("focusin"));
      NodeAssert.equal(requests.length, 2); // + the unthrottled focus refresh
      // While the focused answer is outstanding the surface abstains; the
      // raw ref still holds the stale (here: null) answer.
      NodeAssert.equal(chordState.conflictsPendingRef.current, true);
      await act(async () =>
        requests[1].resolve({
          conflicts: [{ key: "mod+d", command: "terminal.close", winner: "user", loser: "split" }],
        }),
      );
      NodeAssert.equal(chordState.conflictsPendingRef.current, false);
      NodeAssert.equal(resolveTerminalChord("mod+d", chordState.conflictsRef.current), "close");
      // The older mount reply lands last and must be dropped.
      await act(async () => requests[0].resolve({ conflicts: [] }));
      NodeAssert.equal(resolveTerminalChord("mod+d", chordState.conflictsRef.current), "close");
      // A superseded request's rejection erases nothing either: only the
      // newest request may reset the rows (a denied call falls back to
      // the static defaults).
      fireDocument("focusout");
      await act(async () => fireDocument("focusin"));
      NodeAssert.equal(requests.length, 3);
      await act(async () => requests[1].reject(new Error("stale")));
      NodeAssert.equal(resolveTerminalChord("mod+d", chordState.conflictsRef.current), "close");
      await act(async () => requests[2].reject(new Error("current")));
      NodeAssert.equal(chordState.conflictsRef.current, null);
      NodeAssert.equal(resolveTerminalChord("mod+d", chordState.conflictsRef.current), "split");
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

NodeTest.describe(
  "pending chords stay intercepted while resolution pends (r4 finding 2, r5 fix)",
  () => {
    NodeTest.test("no guessed dispatch before the focused conflicts answer lands", async () => {
      // The reviewer's FIRST_KEY_ACTUAL_CAPTURE probe: the entire TerminalView
      // with mod+w remapped to terminal.split. The mount reply (empty,
      // pre-focus) resolved, the focused reply is outstanding, and the actual
      // capture event fires. Pre-fix the handler resolved the chord from the
      // stale list, dispatched the DEFAULT close, and opened the close
      // confirmation for a chord the user had remapped to split. The r4 fix
      // abstained but left the event unclaimed, so the VT encoder took its
      // bytes to the PTY — the interception here is the r5 repair (see the
      // PENDING_CHORD_HOST_CAPTURE_VT regression below).
      Object.defineProperty(globalThis, "navigator", {
        value: { platform: "MacIntel" },
        configurable: true,
      });
      const keyRequests = [];
      const active = new Map();
      let counter = 0;
      const host = {
        readAsset: () => new Promise(() => {}),
        invokeApi: (request) =>
          request.method === "listConflicts"
            ? new Promise((resolve) => keyRequests.push(resolve))
            : Promise.resolve({ tokens: {}, cssVars: {} }),
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
      const session = {
        signal: new AbortController().signal,
        context: { resource: { threadId: "key", environmentId: "e" } },
        visible: true,
        save() {},
        onVisibility: () => () => {},
        bindCommands: () => () => {},
        restoreState: { terminalIds: ["keypane"], activeTerminalId: "keypane" },
      };
      let renderer;
      await act(async () => {
        renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
          createNodeMock: nodeMock,
        });
      });
      const confirmCloseButtons = () =>
        renderer.root
          .findAllByType("button")
          .filter((node) => node.props["aria-label"] === "Confirm close keypane").length;
      const pressModW = async () => {
        let prevented = false;
        let stopped = false;
        await act(async () => {
          renderer.root.findByType("section").props.onKeyDownCapture({
            defaultPrevented: false,
            nativeEvent: {
              key: "w",
              code: "KeyW",
              metaKey: true,
              ctrlKey: false,
              altKey: false,
              shiftKey: false,
            },
            preventDefault() {
              prevented = true;
            },
            stopPropagation() {
              stopped = true;
            },
          });
        });
        return { prevented, stopped };
      };
      try {
        // The mount-time reply (pre-focus context, no rows) lands, then the
        // surface takes focus and starts the authoritative refresh.
        await act(async () => keyRequests[0]({ conflicts: [] }));
        await act(async () => fireDocument("focusin"));
        NodeAssert.equal(keyRequests.length, 2);
        // First press while the focused answer is outstanding: no guessed
        // close confirmation, and the event stays intercepted (prevented and
        // stopped) rather than claimed by a stale default — there is no host
        // default left to fall through to, so an unclaimed event would reach
        // the VT encoder.
        const guarded = await pressModW();
        NodeAssert.deepEqual(guarded, { prevented: true, stopped: true });
        NodeAssert.equal(confirmCloseButtons(), 0);
        // Once the remap row lands, the same chord dispatches the RESOLVED
        // command — split, not close.
        await act(async () =>
          keyRequests[1]({
            conflicts: [
              { key: "mod+w", command: "terminal.split", winner: "user", loser: "close" },
            ],
          }),
        );
        const resolved = await pressModW();
        NodeAssert.equal(resolved.prevented, true);
        NodeAssert.equal(resolved.stopped, true);
        NodeAssert.equal(confirmCloseButtons(), 0);
        // The post-dispatch refresh stayed inside the 1s throttle.
        NodeAssert.equal(keyRequests.length, 2);
      } finally {
        await act(async () => renderer.unmount());
      }
      NodeAssert.equal(active.size, 0);
    });
  },
);

NodeTest.describe("pending owned chords never reach the PTY (r5 finding)", () => {
  NodeTest.test(
    "swallowed while the focused answer pends; typing and unowned chords pass; the resolved split still dispatches",
    async () => {
      // The reviewer's PENDING_CHORD_HOST_CAPTURE_VT probe: the host's
      // window-capture dispatcher has ALREADY resolved the chord to
      // terminal.split and yielded it (extension-claimed commands are left
      // un-prevented for this surface), so when the capture handler here
      // declines an owned chord nothing else claims it — the VT surface's
      // keydown encodes it and the bytes go to the PTY. The r4 abstain
      // returned without preventDefault and the probe's packaged Ghostty
      // encoder observed Cmd+W → `w` and Linux Ctrl+D → EOT (which exits a
      // shell). The fix keeps pending ownable chords intercepted and
      // dispatches nothing until the answer lands. The ChatView host-capture
      // step itself lives outside this package; the traversal below starts
      // at the yielded event, exactly what that step hands over.
      const setPlatform = (platform) =>
        Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true });
      setPlatform("MacIntel");
      const keyRequests = [];
      const invokes = [];
      const active = new Map();
      let counter = 0;
      const host = {
        readAsset: () => new Promise(() => {}),
        invokeApi: (request) => {
          invokes.push({ method: request.method, input: request.input });
          if (request.method === "listConflicts") {
            return new Promise((resolve) => keyRequests.push(resolve));
          }
          if (["open", "attach", "restart"].includes(request.method)) {
            return Promise.resolve(sessionMetadata(request.input?.terminalId ?? "keypane"));
          }
          return Promise.resolve({ tokens: {}, cssVars: {} });
        },
        subscribeApi: (request, signal) => ({
          async *[Symbol.asyncIterator]() {
            const id = ++counter;
            active.set(id, request.input?.terminalId ?? request.name);
            try {
              if (request.name === "list") {
                // The snapshot that takes the restored panel live, so a
                // dispatched split can actually open its pane.
                yield { value: { kind: "snapshot", terminals: [sessionMetadata("keypane")] } };
              }
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
      const session = {
        signal: new AbortController().signal,
        context: {
          resource: { threadId: "key5", environmentId: "e" },
          workspaceRevision: JSON.stringify(["/private/tmp/t3-gap-terminal-splits", null]),
        },
        visible: true,
        save() {},
        onVisibility: () => () => {},
        bindCommands: () => () => {},
        restoreState: { terminalIds: ["keypane"], activeTerminalId: "keypane" },
      };
      let renderer;
      await act(async () => {
        renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
          createNodeMock: nodeMock,
        });
      });
      const confirmCloseButtons = () =>
        renderer.root
          .findAllByType("button")
          .filter((node) => node.props["aria-label"] === "Confirm close keypane").length;
      const pty = [];
      const eventFor = (key, modifiers) => ({
        key,
        code: `Key${key.toUpperCase()}`,
        altKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        getModifierState: () => false,
        defaultPrevented: false,
        stopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...modifiers,
      });
      // The host-yielded chord events the probe pressed: the mod key is
      // meta on macOS and ctrl on Linux.
      const macModW = () => eventFor("w", { metaKey: true, ctrlKey: false });
      const linuxCtrlD = () => eventFor("d", { metaKey: false, ctrlKey: true });
      // Capture-phase handling followed by the VT target step, as the real
      // DOM ordering and the probe both run it: the surface's keydown
      // listener only fires for events the capture phase left un-stopped,
      // and beforeKey (the real handler) passes plain mod chords through to
      // the encoder. `encoded` is the byte the probe's packaged Ghostty
      // encoder produced for exactly that event — the leak the fix must
      // keep out of the PTY.
      const press = async (event, encoded) => {
        await act(async () => {
          renderer.root.findByType("section").props.onKeyDownCapture({
            get defaultPrevented() {
              return event.defaultPrevented;
            },
            nativeEvent: event,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
          });
        });
        if (
          !event.stopped &&
          bundle.handleBeforeKey(event, { sendInput: (_id, data) => pty.push(data) }, "keypane") &&
          encoded !== undefined
        ) {
          pty.push(encoded);
        }
        return { prevented: event.defaultPrevented, stopped: event.stopped };
      };
      try {
        // The mount-time reply (no rows) lands, then focus starts the
        // authoritative refresh, which stays outstanding for every press
        // below until it is resolved.
        await act(async () => keyRequests[0]({ conflicts: [] }));
        await act(async () => fireDocument("focusin"));
        NodeAssert.equal(keyRequests.length, 2);
        // Pending ownable chords stay intercepted — no guessed dispatch,
        // no close confirmation, and above all no PTY bytes: pre-fix the
        // encoder received both events and emitted `w` and EOT.
        // controlCalls counts t3.terminal/control ops only; the mount's
        // own theme/keybindings invokes are out of scope here.
        const controlCalls = () =>
          invokes.filter(({ method }) =>
            ["open", "attach", "write", "resize", "clear", "restart", "close"].includes(method),
          );
        NodeAssert.deepEqual(await press(macModW(), "w"), { prevented: true, stopped: true });
        setPlatform("Linux x86_64");
        NodeAssert.deepEqual(await press(linuxCtrlD(), "\u0004"), {
          prevented: true,
          stopped: true,
        });
        setPlatform("MacIntel");
        NodeAssert.deepEqual(pty, []);
        NodeAssert.equal(confirmCloseButtons(), 0);
        NodeAssert.deepEqual(
          controlCalls().map(({ method }) => method),
          [],
        );
        // Ordinary typing and chords this surface does not own still pass
        // through to the VT target untouched while the answer pends.
        NodeAssert.deepEqual(await press(eventFor("x", { metaKey: false, ctrlKey: false }), "x"), {
          prevented: false,
          stopped: false,
        });
        NodeAssert.deepEqual(pty, ["x"]);
        NodeAssert.deepEqual(await press(eventFor("t", { metaKey: true, ctrlKey: false })), {
          prevented: false,
          stopped: false,
        });
        // Once the remap row lands, the same chord dispatches the RESOLVED
        // command — the split opens a second pane, and no chord byte ever
        // reached the PTY.
        await act(async () =>
          keyRequests[1]({
            conflicts: [
              { key: "mod+w", command: "terminal.split", winner: "user", loser: "close" },
            ],
          }),
        );
        NodeAssert.deepEqual(await press(macModW()), { prevented: true, stopped: true });
        const opened = controlCalls().filter(({ method }) => method === "open");
        NodeAssert.equal(opened.length, 1);
        NodeAssert.notEqual(opened[0].input.terminalId, "keypane");
        NodeAssert.equal(controlCalls().filter(({ method }) => method === "close").length, 0);
        NodeAssert.deepEqual(pty, ["x"]);
        NodeAssert.equal(confirmCloseButtons(), 0);
      } finally {
        await act(async () => renderer.unmount());
      }
      NodeAssert.equal(active.size, 0);
    },
  );
});

NodeTest.describe(
  "pending ownable set covers the registered toggle chord (r5 review finding)",
  () => {
    NodeTest.test(
      "mod+j remapped to split stays out of the PTY before any answer lands; the resolved press opens one split",
      async () => {
        // The reviewer's PENDING_OWNABLE_CTRL_J_HOST_CAPTURE_VT probe: the
        // user remapped the REGISTERED mod+j toggle to terminal.split, and
        // BOTH the mount-time and the focused listConflicts answers are
        // outstanding — the conflicts ref is null, exactly the state a
        // newly mounted surface sits in while its keymap answers are in
        // flight. resolveTerminalChord answers null for mod+j against the
        // absent list (no row yet, no static default), so the r5 guard
        // (resolver !== null) let Linux Ctrl+J fall through and the packaged
        // Ghostty encoder sent LF to the PTY, submitting the shell's current
        // line. The swallow now keys on the ownable set — registered default
        // chords plus the last-known list's chords — independent of what the
        // stale resolver currently answers. The ChatView host-capture step
        // lives outside this package; the traversal below starts at the
        // yielded event, exactly what that step hands over.
        const setPlatform = (platform) =>
          Object.defineProperty(globalThis, "navigator", {
            value: { platform },
            configurable: true,
          });
        setPlatform("Linux x86_64");
        const keyRequests = [];
        const invokes = [];
        const active = new Map();
        let counter = 0;
        const host = {
          readAsset: () => new Promise(() => {}),
          invokeApi: (request) => {
            invokes.push({ method: request.method, input: request.input });
            if (request.method === "listConflicts") {
              return new Promise((resolve) => keyRequests.push(resolve));
            }
            if (["open", "attach", "restart"].includes(request.method)) {
              return Promise.resolve(sessionMetadata(request.input?.terminalId ?? "ownpane"));
            }
            return Promise.resolve({ tokens: {}, cssVars: {} });
          },
          subscribeApi: (request, signal) => ({
            async *[Symbol.asyncIterator]() {
              const id = ++counter;
              active.set(id, request.input?.terminalId ?? request.name);
              try {
                if (request.name === "list") {
                  // The snapshot that takes the restored panel live, so a
                  // dispatched split can actually open its pane.
                  yield { value: { kind: "snapshot", terminals: [sessionMetadata("ownpane")] } };
                }
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
        const session = {
          signal: new AbortController().signal,
          context: {
            resource: { threadId: "own6", environmentId: "e" },
            workspaceRevision: JSON.stringify(["/private/tmp/t3-gap-terminal-splits", null]),
          },
          visible: true,
          save() {},
          onVisibility: () => () => {},
          bindCommands: () => () => {},
          restoreState: { terminalIds: ["ownpane"], activeTerminalId: "ownpane" },
        };
        let renderer;
        await act(async () => {
          renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
            createNodeMock: nodeMock,
          });
        });
        await act(async () => fireDocument("focusin"));
        // Both the mount-time and the focused answers are outstanding — no
        // list has ever landed.
        NodeAssert.equal(keyRequests.length, 2);
        const pty = [];
        const eventFor = (key, modifiers) => ({
          key,
          code: `Key${key.toUpperCase()}`,
          altKey: false,
          shiftKey: false,
          repeat: false,
          isComposing: false,
          getModifierState: () => false,
          defaultPrevented: false,
          stopped: false,
          preventCalls: 0,
          stopCalls: 0,
          preventDefault() {
            this.defaultPrevented = true;
            this.preventCalls++;
          },
          stopPropagation() {
            this.stopped = true;
            this.stopCalls++;
          },
          ...modifiers,
        });
        // Capture-phase handling followed by the VT target step, as the real
        // DOM ordering and the probe both run it: the surface's keydown
        // listener only fires for events the capture phase left un-stopped,
        // and beforeKey (the real handler) passes plain mod chords through to
        // the encoder. `encoded` is the byte the probe's packaged Ghostty
        // encoder produced for exactly that event — the leak the fix must
        // keep out of the PTY (Ctrl+J → `\n`, Ctrl+D → EOT).
        const press = async (event, encoded) => {
          await act(async () => {
            renderer.root.findByType("section").props.onKeyDownCapture({
              get defaultPrevented() {
                return event.defaultPrevented;
              },
              nativeEvent: event,
              preventDefault: () => event.preventDefault(),
              stopPropagation: () => event.stopPropagation(),
            });
          });
          if (
            !event.stopped &&
            bundle.handleBeforeKey(
              event,
              { sendInput: (_id, data) => pty.push(data) },
              "ownpane",
            ) &&
            encoded !== undefined
          ) {
            pty.push(encoded);
          }
          return {
            prevented: event.defaultPrevented,
            stopped: event.stopped,
            preventCalls: event.preventCalls,
            stopCalls: event.stopCalls,
          };
        };
        const linuxCtrl = (key) => eventFor(key, { metaKey: false, ctrlKey: true });
        // controlCalls counts t3.terminal/control ops only; the mount's own
        // theme/keybindings invokes are out of scope here.
        const controlCalls = () =>
          invokes.filter(({ method }) =>
            ["open", "attach", "write", "resize", "clear", "restart", "close"].includes(method),
          );
        try {
          // The registered mod+j chord is intercepted with the resolver
          // answering null — exactly once, dispatching nothing.
          const pendingJ = await press(linuxCtrl("j"), "\n");
          NodeAssert.deepEqual(pendingJ, {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          // The mod+d default chord stays intercepted in the same
          // no-list state (the r5 fix's territory, now via the set).
          NodeAssert.deepEqual(await press(linuxCtrl("d"), "\u0004"), {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          NodeAssert.deepEqual(pty, []);
          NodeAssert.deepEqual(
            controlCalls().map(({ method }) => method),
            [],
          );
          // Ordinary typing and chords this surface does not own still pass
          // through to the VT target untouched while the answers pend.
          NodeAssert.deepEqual(
            await press(eventFor("x", { metaKey: false, ctrlKey: false }), "x"),
            { prevented: false, stopped: false, preventCalls: 0, stopCalls: 0 },
          );
          NodeAssert.deepEqual(await press(linuxCtrl("t")), {
            prevented: false,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
          NodeAssert.deepEqual(pty, ["x"]);
          // An already-prevented event the host claimed is a no-op even when
          // forced through this surface's capture.
          const claimed = eventFor("d", { metaKey: false, ctrlKey: true, defaultPrevented: true });
          NodeAssert.deepEqual(await press(claimed), {
            prevented: true,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
          // Once the focused answer lands, the same chord dispatches the
          // RESOLVED command — the split opens exactly one pane, and no
          // chord byte ever reached the PTY. The mod+d sibling row is the
          // reporter's real !terminalFocus shape and must not matter.
          await act(async () =>
            keyRequests[1]({
              conflicts: [
                { key: "mod+j", command: "terminal.split", winner: "user", loser: "t3.terminal" },
                { key: "mod+d", command: "diff.toggle", winner: "native", loser: "t3.terminal" },
              ],
            }),
          );
          const readyJ = await press(linuxCtrl("j"), "\n");
          NodeAssert.deepEqual(readyJ, {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          NodeAssert.deepEqual(pty, ["x"]);
          const opened = controlCalls().filter(({ method }) => method === "open");
          NodeAssert.equal(opened.length, 1);
          NodeAssert.notEqual(opened[0].input.terminalId, "ownpane");
          NodeAssert.equal(controlCalls().filter(({ method }) => method === "close").length, 0);
          // The stale mount-time reply (pre-focus, no rows) resolves last
          // and stays harmless — no re-pending dispatch, no extra control.
          await act(async () => keyRequests[0]({ conflicts: [] }));
          NodeAssert.equal(controlCalls().filter(({ method }) => method === "open").length, 1);
          NodeAssert.deepEqual(pty, ["x"]);
        } finally {
          await act(async () => renderer.unmount());
        }
        NodeAssert.equal(active.size, 0);
      },
    );
  },
);

NodeTest.describe(
  "pending ownable set covers foreign-registered remaps (r6 review finding 1)",
  () => {
    NodeTest.test(
      "Browser-registered mod+shift+j remapped to split stays out of the PTY before any answer lands; the resolved press opens one split",
      async () => {
        // The reviewer's PENDING_FOREIGN_REGISTERED_CTRL_SHIFT_J_HOST_CAPTURE_VT
        // probe: listConflicts is environment-wide, so a chord ANOTHER
        // installation registered (the shipped Browser toggle on
        // mod+shift+j) that the user remapped to terminal.split produces a
        // row naming a native terminal command. Before ANY answer has
        // landed — both the mount-time and focused requests outstanding,
        // the conflicts ref null — that row cannot vouch for the chord and
        // no terminal descriptor sits on it either. The host still resolves
        // the split and yields the event, so the r6 predicate left it
        // untouched and the packaged Ghostty encoder sent ESC[106;6u to
        // the PTY. With no list to consult, the pending set holds the
        // shifted-mod class (CSI-u-encoded chords; a wrong hold costs a
        // re-press, a wrong leak injects escape garbage) while plain mod
        // chords and the VT surface's own clipboard chords keep flowing.
        // The ChatView host-capture step lives outside this package; the
        // traversal below starts at the yielded event, exactly what that
        // step hands over.
        const setPlatform = (platform) =>
          Object.defineProperty(globalThis, "navigator", {
            value: { platform },
            configurable: true,
          });
        setPlatform("Linux x86_64");
        const keyRequests = [];
        const invokes = [];
        const active = new Map();
        let counter = 0;
        const host = {
          readAsset: () => new Promise(() => {}),
          invokeApi: (request) => {
            invokes.push({ method: request.method, input: request.input });
            if (request.method === "listConflicts") {
              return new Promise((resolve) => keyRequests.push(resolve));
            }
            if (["open", "attach", "restart"].includes(request.method)) {
              return Promise.resolve(sessionMetadata(request.input?.terminalId ?? "ownpane"));
            }
            return Promise.resolve({ tokens: {}, cssVars: {} });
          },
          subscribeApi: (request, signal) => ({
            async *[Symbol.asyncIterator]() {
              const id = ++counter;
              active.set(id, request.input?.terminalId ?? request.name);
              try {
                if (request.name === "list") {
                  // The snapshot that takes the restored panel live, so a
                  // dispatched split can actually open its pane.
                  yield { value: { kind: "snapshot", terminals: [sessionMetadata("ownpane")] } };
                }
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
        const session = {
          signal: new AbortController().signal,
          context: {
            resource: { threadId: "own7", environmentId: "e" },
            workspaceRevision: JSON.stringify(["/private/tmp/t3-gap-terminal-splits", null]),
          },
          visible: true,
          save() {},
          onVisibility: () => () => {},
          bindCommands: () => () => {},
          restoreState: { terminalIds: ["ownpane"], activeTerminalId: "ownpane" },
        };
        let renderer;
        await act(async () => {
          renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
            createNodeMock: nodeMock,
          });
        });
        await act(async () => fireDocument("focusin"));
        // Both the mount-time and the focused answers are outstanding — no
        // list has ever landed.
        NodeAssert.equal(keyRequests.length, 2);
        const pty = [];
        const eventFor = (key, modifiers) => ({
          key,
          code: `Key${key.toUpperCase()}`,
          altKey: false,
          shiftKey: false,
          repeat: false,
          isComposing: false,
          getModifierState: () => false,
          defaultPrevented: false,
          stopped: false,
          preventCalls: 0,
          stopCalls: 0,
          preventDefault() {
            this.defaultPrevented = true;
            this.preventCalls++;
          },
          stopPropagation() {
            this.stopped = true;
            this.stopCalls++;
          },
          ...modifiers,
        });
        // Capture-phase handling followed by the VT target step, as the real
        // DOM ordering and the probe both run it: the surface's keydown
        // listener only fires for events the capture phase left un-stopped,
        // and beforeKey (the real handler) passes plain mod chords through to
        // the encoder. `encoded` is the byte sequence the probe's packaged
        // Ghostty encoder produced for exactly that event — the leak the fix
        // must keep out of the PTY (Ctrl+Shift+J → ESC[106;6u, Ctrl+D →
        // EOT).
        const press = async (event, encoded) => {
          await act(async () => {
            renderer.root.findByType("section").props.onKeyDownCapture({
              get defaultPrevented() {
                return event.defaultPrevented;
              },
              nativeEvent: event,
              preventDefault: () => event.preventDefault(),
              stopPropagation: () => event.stopPropagation(),
            });
          });
          if (
            !event.stopped &&
            bundle.handleBeforeKey(
              event,
              { sendInput: (_id, data) => pty.push(data) },
              "ownpane",
            ) &&
            encoded !== undefined
          ) {
            pty.push(encoded);
          }
          return {
            prevented: event.defaultPrevented,
            stopped: event.stopped,
            preventCalls: event.preventCalls,
            stopCalls: event.stopCalls,
          };
        };
        const linuxCtrl = (key) => eventFor(key, { metaKey: false, ctrlKey: true });
        const linuxCtrlShiftJ = () =>
          eventFor("J", { metaKey: false, ctrlKey: true, shiftKey: true });
        // controlCalls counts t3.terminal/control ops only; the mount's own
        // theme/keybindings invokes are out of scope here.
        const controlCalls = () =>
          invokes.filter(({ method }) =>
            ["open", "attach", "write", "resize", "clear", "restart", "close"].includes(method),
          );
        try {
          // The foreign-registered chord is held exactly once with the
          // resolver answering null — no PTY bytes, no control calls.
          const pendingJ = await press(linuxCtrlShiftJ(), "\u001b[106;6u");
          NodeAssert.deepEqual(pendingJ, {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          // The registered default chords stay held in the same no-list
          // state.
          NodeAssert.deepEqual(await press(linuxCtrl("d"), "\u0004"), {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          NodeAssert.deepEqual(pty, []);
          NodeAssert.deepEqual(
            controlCalls().map(({ method }) => method),
            [],
          );
          // Ordinary typing, plain unowned chords, and the VT surface's own
          // clipboard chords still pass through to the VT target untouched
          // while the answers pend.
          NodeAssert.deepEqual(
            await press(eventFor("x", { metaKey: false, ctrlKey: false }), "x"),
            { prevented: false, stopped: false, preventCalls: 0, stopCalls: 0 },
          );
          NodeAssert.deepEqual(await press(linuxCtrl("t")), {
            prevented: false,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
          NodeAssert.deepEqual(
            await press(eventFor("v", { metaKey: false, ctrlKey: true, shiftKey: true })),
            { prevented: false, stopped: false, preventCalls: 0, stopCalls: 0 },
          );
          NodeAssert.deepEqual(pty, ["x"]);
          // An already-prevented event the host claimed is a no-op even
          // when forced through this surface's capture.
          const claimed = eventFor("J", {
            metaKey: false,
            ctrlKey: true,
            shiftKey: true,
            defaultPrevented: true,
          });
          NodeAssert.deepEqual(await press(claimed), {
            prevented: true,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
          // Once the focused answer lands, the row from the Browser
          // registration dispatches the RESOLVED command — exactly one
          // split opens, and no chord byte ever reached the PTY. The
          // mod+d sibling row is the reporter's real !terminalFocus shape
          // and must not matter.
          await act(async () =>
            keyRequests[1]({
              conflicts: [
                {
                  key: "mod+shift+j",
                  command: "terminal.split",
                  winner: "user",
                  loser: "ext.t3.browser.toggle",
                },
                { key: "mod+d", command: "diff.toggle", winner: "native", loser: "t3.terminal" },
              ],
            }),
          );
          const readyJ = await press(linuxCtrlShiftJ(), "\u001b[106;6u");
          NodeAssert.deepEqual(readyJ, {
            prevented: true,
            stopped: true,
            preventCalls: 1,
            stopCalls: 1,
          });
          NodeAssert.deepEqual(pty, ["x"]);
          const opened = controlCalls().filter(({ method }) => method === "open");
          NodeAssert.equal(opened.length, 1);
          NodeAssert.notEqual(opened[0].input.terminalId, "ownpane");
          NodeAssert.equal(controlCalls().filter(({ method }) => method === "close").length, 0);
          // The stale mount-time reply (pre-focus, no rows) resolves last
          // and stays harmless — no re-pending dispatch, no extra control.
          await act(async () => keyRequests[0]({ conflicts: [] }));
          NodeAssert.equal(controlCalls().filter(({ method }) => method === "open").length, 1);
          NodeAssert.deepEqual(pty, ["x"]);
        } finally {
          await act(async () => renderer.unmount());
        }
        NodeAssert.equal(active.size, 0);
      },
    );
  },
);

NodeTest.describe("foreign-only conflict rows never hold a chord (r6 review finding 2)", () => {
  NodeTest.test(
    "after the terminal remap is removed, a leftover plugin-vs-plugin row lets Ctrl+T reach the PTY through every pending window",
    async () => {
      // The reviewer's REMOVED_REMAP_FOREIGN_ROW_REPEATED_PENDING probe:
      // the r6 predicate matched ANY row with the chord's key, so after
      // the user removed their mod+t -> terminal.split remap, a fresh
      // plugin-vs-plugin row on the same key kept every later pending
      // window swallowing Ctrl+T while the settled presses correctly
      // emitted 0x14 — the key stopped reaching readline/apps
      // intermittently. Only rows naming a native focused-terminal
      // command (either side) may hold a chord; foreign-only rows must
      // not, and a row that disappears stops holding its key with the
      // answer that dropped it. The ChatView host-capture step lives
      // outside this package; the traversal below starts at the yielded
      // event, exactly what that step hands over.
      const setPlatform = (platform) =>
        Object.defineProperty(globalThis, "navigator", {
          value: { platform },
          configurable: true,
        });
      setPlatform("Linux x86_64");
      const keyRequests = [];
      const invokes = [];
      const active = new Map();
      let counter = 0;
      const host = {
        readAsset: () => new Promise(() => {}),
        invokeApi: (request) => {
          invokes.push({ method: request.method, input: request.input });
          if (request.method === "listConflicts") {
            return new Promise((resolve) => keyRequests.push(resolve));
          }
          if (["open", "attach", "restart"].includes(request.method)) {
            return Promise.resolve(sessionMetadata(request.input?.terminalId ?? "ownpane"));
          }
          return Promise.resolve({ tokens: {}, cssVars: {} });
        },
        subscribeApi: (request, signal) => ({
          async *[Symbol.asyncIterator]() {
            const id = ++counter;
            active.set(id, request.input?.terminalId ?? request.name);
            try {
              if (request.name === "list") {
                // The snapshot that takes the restored panel live, so a
                // dispatched split can actually open its pane.
                yield { value: { kind: "snapshot", terminals: [sessionMetadata("ownpane")] } };
              }
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
      const session = {
        signal: new AbortController().signal,
        context: {
          resource: { threadId: "own8", environmentId: "e" },
          workspaceRevision: JSON.stringify(["/private/tmp/t3-gap-terminal-splits", null]),
        },
        visible: true,
        save() {},
        onVisibility: () => () => {},
        bindCommands: () => () => {},
        restoreState: { terminalIds: ["ownpane"], activeTerminalId: "ownpane" },
      };
      let renderer;
      await act(async () => {
        renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
          createNodeMock: nodeMock,
        });
      });
      const pty = [];
      const eventFor = (key, modifiers) => ({
        key,
        code: `Key${key.toUpperCase()}`,
        altKey: false,
        shiftKey: false,
        repeat: false,
        isComposing: false,
        getModifierState: () => false,
        defaultPrevented: false,
        stopped: false,
        preventCalls: 0,
        stopCalls: 0,
        preventDefault() {
          this.defaultPrevented = true;
          this.preventCalls++;
        },
        stopPropagation() {
          this.stopped = true;
          this.stopCalls++;
        },
        ...modifiers,
      });
      const press = async (event, encoded) => {
        await act(async () => {
          renderer.root.findByType("section").props.onKeyDownCapture({
            get defaultPrevented() {
              return event.defaultPrevented;
            },
            nativeEvent: event,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
          });
        });
        if (
          !event.stopped &&
          bundle.handleBeforeKey(event, { sendInput: (_id, data) => pty.push(data) }, "ownpane") &&
          encoded !== undefined
        ) {
          pty.push(encoded);
        }
        return {
          prevented: event.defaultPrevented,
          stopped: event.stopped,
          preventCalls: event.preventCalls,
          stopCalls: event.stopCalls,
        };
      };
      const linuxCtrl = (key) => eventFor(key, { metaKey: false, ctrlKey: true });
      const controlCalls = () =>
        invokes.filter(({ method }) =>
          ["open", "attach", "write", "resize", "clear", "restart", "close"].includes(method),
        );
      const openCount = () => controlCalls().filter(({ method }) => method === "open").length;
      // A focus edge starts an unthrottled refresh; the returned index is
      // the request that refresh created.
      const startRefresh = async () => {
        await act(async () => fireDocument("focusout"));
        await act(async () => fireDocument("focusin"));
        return keyRequests.length - 1;
      };
      try {
        // Establish the formerly valid terminal remap: the focused
        // answer carries the mod+t -> terminal.split row.
        await act(async () => keyRequests[0]({ conflicts: [] }));
        await act(async () => fireDocument("focusin"));
        NodeAssert.equal(keyRequests.length, 2);
        await act(async () =>
          keyRequests[1]({
            conflicts: [
              {
                key: "mod+t",
                command: "terminal.split",
                winner: "user",
                loser: "ext.foreign.a.tools",
              },
            ],
          }),
        );
        // Settled: the row dispatches the split.
        NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
          prevented: true,
          stopped: true,
          preventCalls: 1,
          stopCalls: 1,
        });
        NodeAssert.equal(openCount(), 1);
        NodeAssert.deepEqual(pty, []);
        // The remap is removed. The fresh answer now reports only a
        // plugin-vs-plugin row on mod+t — while THAT answer is
        // outstanding, the last-known TERMINAL row still holds the
        // chord once (no dispatch, no bytes).
        const foreignRows = [
          {
            command: "ext.foreign.a.tools",
            key: "mod+t",
            winner: "plugin",
            loser: "ext.foreign.b.tools",
          },
        ];
        let request = await startRefresh();
        NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
          prevented: true,
          stopped: true,
          preventCalls: 1,
          stopCalls: 1,
        });
        NodeAssert.equal(openCount(), 1);
        NodeAssert.deepEqual(pty, []);
        await act(async () => keyRequests[request]({ conflicts: foreignRows }));
        // Settled on the foreign-only row: the resolver answers null and
        // Ctrl+T reaches the PTY as 0x14 again.
        NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
          prevented: false,
          stopped: false,
          preventCalls: 0,
          stopCalls: 0,
        });
        NodeAssert.deepEqual(pty, ["\u0014"]);
        // Every later pending window must keep passing it through — the
        // foreign-only row must not swallow unrelated input, repeatedly.
        for (let cycle = 0; cycle < 3; cycle += 1) {
          request = await startRefresh();
          NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
            prevented: false,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
          await act(async () => keyRequests[request]({ conflicts: foreignRows }));
          NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
            prevented: false,
            stopped: false,
            preventCalls: 0,
            stopCalls: 0,
          });
        }
        NodeAssert.deepEqual(pty, [
          "\u0014",
          "\u0014",
          "\u0014",
          "\u0014",
          "\u0014",
          "\u0014",
          "\u0014",
        ]);
        // A row that disappears stops holding its chord with the answer
        // that dropped it — nothing accumulates across refreshes.
        request = await startRefresh();
        await act(async () =>
          keyRequests[request]({
            conflicts: [
              { key: "mod+d", command: "diff.toggle", winner: "native", loser: "t3.terminal" },
            ],
          }),
        );
        request = await startRefresh();
        NodeAssert.deepEqual(await press(linuxCtrl("t"), "\u0014"), {
          prevented: false,
          stopped: false,
          preventCalls: 0,
          stopCalls: 0,
        });
        await act(async () => keyRequests[request]({ conflicts: [] }));
        NodeAssert.equal(openCount(), 1);
      } finally {
        await act(async () => renderer.unmount());
      }
      NodeAssert.equal(active.size, 0);
    },
  );
});
