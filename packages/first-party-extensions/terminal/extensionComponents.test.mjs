/**
 * Component-level regressions over the REAL extension.tsx tree, bundled by
 * esbuild with the Ghostty surface replaced by a recording stub. These pin
 * these regression shapes as tests: cold-restore stream budget, group-switch
 * waiter wake, and focused-chord capture against the real host keymap resolver.
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
const { hostKeybindings, loadHostKeymap, userRule } = await import("./fixtures/hostKeymap.mjs");
const { DEFAULT_RESOLVED_KEYBINDINGS } = await import("@t3tools/shared/keybindings");

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
        "\nexport { TerminalPane, TerminalView, streamHub, handleBeforeKey };",
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
          builder.onResolve({ filter: /^@t3tools\/ghostty-terminal\/surface$/ }, () => ({
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
  const bundleDir = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-terminal-components-"),
  );
  const bundlePath = NodePath.join(bundleDir, "bundle.mjs");
  try {
    await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
    bundle = await import(NodeURL.pathToFileURL(bundlePath).href);
  } finally {
    await NodeFSP.rm(bundleDir, { recursive: true, force: true });
  }
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

NodeTest.describe("cold restore stream budget", () => {
  NodeTest.test(
    "eight-session restore admits sessions/theme/appearance inside the cap",
    async () => {
      // Cold restore: pane effects run before the view's fixed-feed effects,
      // hidden panes take optional slots, and pre-fix the three fixed
      // subscriptions were rejected over the cap — the panel never went live
      // and New stayed disabled.
      const active = new Set();
      const attempts = [];
      const rejects = [];
      const host = {
        readAsset: () => new Promise(() => {}),
        invokeApi: async () => ({ tokens: {}, cssVars: {} }),
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

NodeTest.describe("group switch waiter wake", () => {
  NodeTest.test(
    "a group switch connects the newly visible pane after demotions drain",
    async () => {
      // Group switch, on real TerminalPane components: three fixed feeds plus
      // a1..a4/c fill the pool, b is hidden and unallocated. Reorder b first
      // and show only b and c — pre-fix, b's failed acquire never retried
      // because the later demotions of a1..a4 did not wake waiters, leaving the
      // visible pane disconnected despite evictable streams.
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

NodeTest.describe("hidden waiters retry at current visibility", () => {
  NodeTest.test("refused hidden waiters cannot seize demoted slots as mandatory", async () => {
    // Five visible panes fill the pool, four hidden panes and b are refused and
    // wait. Switching to [b, c] demotes a1..a4 — pre-fix, every hidden waiter's
    // retry acquired MANDATORY, so the demotions handed h1..h4 permanent
    // mandatory slots and the newly visible b starved behind "Stream budget"
    // with nothing left to evict.
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

NodeTest.describe("two full views sidebar switch", () => {
  NodeTest.test("the selected pane wins the stream budget in both placements", async () => {
    // Two complete TerminalView placements for one thread, eleven restored
    // sessions. Selecting b through its real sidebar callback demotes a1..a4 in
    // the left placement — pre-fix, the left placement's earlier refused hidden
    // waiters re-acquired MANDATORY slots on those demotions, the streams
    // stayed on c/h2..h5, and the visible b showed "Stream budget".
    const active = new Map();
    let counter = 0;
    const host = {
      readAsset: () => new Promise(() => {}),
      invokeApi: async () => ({ tokens: {}, cssVars: {} }),
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

/**
 * A full TerminalView over one restored, live pane, with the capture →
 * VT-target traversal a real key press takes. The ChatView host-capture step
 * lives outside this package; `press` starts at the event it yields. `encoded`
 * is the byte sequence the packaged Ghostty encoder produced for that event —
 * what reaches the PTY if nothing claims it.
 */
async function mountKeyView({ keybindings, invokeKeymap }) {
  const invokes = [];
  const active = new Map();
  let counter = 0;
  let setVisibility = () => {};
  const host = {
    readAsset: () => new Promise(() => {}),
    ...(keybindings === undefined ? {} : { keybindings }),
    invokeApi: (request) => {
      invokes.push({ method: request.method, input: request.input });
      if (request.method === "listConflicts") return invokeKeymap();
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
            yield { value: { kind: "snapshot", terminals: [sessionMetadata("keypane")] } };
          }
          await new Promise((resolve) =>
            signal.aborted ? resolve() : signal.addEventListener("abort", resolve, { once: true }),
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
      resource: { threadId: "keys", environmentId: "e" },
      workspaceRevision: JSON.stringify(["/private/tmp/t3-host-keybinding-resolve", null]),
    },
    visible: true,
    save() {},
    onVisibility: (listener) => {
      setVisibility = listener;
      return () => {
        setVisibility = () => {};
      };
    },
    bindCommands: () => () => {},
    restoreState: { terminalIds: ["keypane"], activeTerminalId: "keypane" },
  };
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(bundle.TerminalView, { host, session }), {
      createNodeMock: nodeMock,
    });
  });
  const pty = [];
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
  return {
    press,
    pty,
    invokes,
    active,
    opened: () => invokes.filter(({ method }) => method === "open").length,
    setVisible: (visible) => act(async () => setVisibility(visible)),
    unmount: () => act(async () => renderer.unmount()),
  };
}

const setPlatform = (platform) =>
  Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true });

/** A Linux keydown as the host yields it to the surface's capture phase. */
const linuxKey = (key, { ctrl = true, shift = false, code } = {}) => ({
  key,
  code: code ?? `Key${key.toUpperCase()}`,
  metaKey: false,
  ctrlKey: ctrl,
  altKey: false,
  shiftKey: shift,
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
});
const CTRL_SHIFT_J = () => linuxKey("J", { shift: true });
const CTRL_SHIFT_T = () => linuxKey("T", { shift: true });
const CTRL_SHIFT_C = () => linuxKey("C", { shift: true });
const CTRL_PERIOD = () => linuxKey(".", { code: "Period" });
const PASSED = { prevented: false, stopped: false };
const CLAIMED = { prevented: true, stopped: true };

NodeTest.describe(
  "focused chords resolve through the host keymap (host-keybinding-resolve-api)",
  () => {
    let keymap;
    NodeTest.before(async () => {
      keymap = await loadHostKeymap();
    });

    NodeTest.test(
      "R1: a foreign shifted remap splits from the first press, before and after focus, with no PTY bytes",
      async () => {
        // r7 F1 (WARM_MOUNT_FIRST_FOCUS_CTRL_SHIFT_J_HOST_CAPTURE_VT): the
        // Browser's mod+shift+j remapped to terminal.split. The mount-time
        // listConflicts answer ([]) landed before focusin while the focused
        // request was outstanding, so neither the last-known-row clause nor
        // the null-only shifted fallback held the key and `ESC[106;6u` reached
        // the shell. The plugin now asks the host resolver synchronously, so
        // no answer window exists: the scheduling is irrelevant, and the
        // plugin never calls listConflicts at all.
        setPlatform("Linux x86_64");
        let rules = [...DEFAULT_RESOLVED_KEYBINDINGS, userRule("terminal.split", "mod+shift+j")];
        // r7's legacy scheduling: the mount-time answer ([]) lands before
        // focus, and every later request stays outstanding.
        let keymapCalls = 0;
        const view = await mountKeyView({
          keybindings: hostKeybindings(keymap, () => rules),
          invokeKeymap: () =>
            ++keymapCalls === 1 ? Promise.resolve({ conflicts: [] }) : new Promise(() => {}),
        });
        try {
          // Right after mount, before the surface has focus.
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_J(), "\u001b[106;6u"), CLAIMED);
          NodeAssert.equal(view.opened(), 1);
          // After the first focus edge — the window r7 found open.
          await act(async () => fireDocument("focusin"));
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_J(), "\u001b[106;6u"), CLAIMED);
          NodeAssert.equal(view.opened(), 2);
          // r6 F2 intact: an unowned shifted chord still reaches the shell.
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_T(), "\u001b[116;6u"), PASSED);
          // R3 / the "remap introduced while the last answer had no native
          // row" case: a plain-mod foreign chord leaks until the user maps
          // it, then the very next press splits — the keymap is read live.
          NodeAssert.deepEqual(await view.press(CTRL_PERIOD(), "\u001b[46;5u"), PASSED);
          rules = [...rules, userRule("terminal.split", "mod+.")];
          NodeAssert.deepEqual(await view.press(CTRL_PERIOD(), "\u001b[46;5u"), CLAIMED);
          NodeAssert.equal(view.opened(), 3);
          NodeAssert.deepEqual(view.pty, ["\u001b[116;6u", "\u001b[46;5u"]);
          NodeAssert.equal(
            view.invokes.filter(({ method }) => method === "listConflicts").length,
            0,
          );
        } finally {
          await view.unmount();
        }
        NodeAssert.equal(view.active.size, 0);
      },
    );

    NodeTest.test(
      "R2: a rejected keymap call and hide/show never swallow unowned shifted chords",
      async () => {
        // r7 F2 (NOT_FIRST_EVER_NULL_WINDOW): a rejected refresh, or effect
        // cleanup on hide/show, reset the list to null, and clause 3 then
        // held the whole shifted-mod class during the next pending request —
        // Ctrl+Shift+T did nothing, once per press. Clause 3 is gone: with
        // any legacy keymap call rejecting and across a hide/show cycle,
        // unowned chords reach the shell and owned ones still dispatch.
        // The legacy call sequence r7 drove: answered, then rejected, then
        // every later request outstanding.
        setPlatform("Linux x86_64");
        let keymapCalls = 0;
        const view = await mountKeyView({
          keybindings: hostKeybindings(keymap, () => DEFAULT_RESOLVED_KEYBINDINGS),
          invokeKeymap: () => {
            keymapCalls += 1;
            if (keymapCalls === 1) return Promise.resolve({ conflicts: [] });
            if (keymapCalls === 2) return Promise.reject(new Error("listConflicts rejected"));
            return new Promise(() => {});
          },
        });
        try {
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_T(), "\u001b[116;6u"), PASSED);
          await act(async () => fireDocument("focusin"));
          fireDocument("focusout");
          await act(async () => fireDocument("focusin"));
          // After a rejected refresh, with the next request outstanding.
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_T(), "\u001b[116;6u"), PASSED);
          await view.setVisible(false);
          await view.setVisible(true);
          // The first presses after re-show, where the r7 null window sat.
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_T(), "\u001b[116;6u"), PASSED);
          NodeAssert.deepEqual(await view.press(linuxKey("t"), "\u0014"), PASSED);
          NodeAssert.deepEqual(await view.press(CTRL_SHIFT_C(), "\u001b[99;6u"), PASSED);
          // An owned chord right after re-show dispatches exactly once.
          NodeAssert.deepEqual(await view.press(linuxKey("d"), "\u0004"), CLAIMED);
          NodeAssert.equal(view.opened(), 1);
          NodeAssert.deepEqual(view.pty, [
            "\u001b[116;6u",
            "\u001b[116;6u",
            "\u001b[116;6u",
            "\u0014",
            "\u001b[99;6u",
          ]);
        } finally {
          await view.unmount();
        }
        NodeAssert.equal(view.active.size, 0);
      },
    );

    NodeTest.test("a host without the resolver keeps the shipped default chords", async () => {
      // Pre-1.1.0 hosts (or no t3.ui/keybindings grant): no host.keybindings.
      // The default chords still split; nothing else is held.
      setPlatform("Linux x86_64");
      const view = await mountKeyView({
        keybindings: undefined,
        invokeKeymap: () => new Promise(() => {}),
      });
      try {
        NodeAssert.deepEqual(await view.press(linuxKey("d"), "\u0004"), CLAIMED);
        NodeAssert.equal(view.opened(), 1);
        NodeAssert.deepEqual(await view.press(CTRL_SHIFT_J(), "\u001b[106;6u"), PASSED);
        NodeAssert.deepEqual(view.pty, ["\u001b[106;6u"]);
      } finally {
        await view.unmount();
      }
      NodeAssert.equal(view.active.size, 0);
    });
  },
);
