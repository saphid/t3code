import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  DIFF_SURFACE_ID,
  DIFF_TOGGLE_COMMAND_ID,
  DIFF_TOGGLE_GLOBAL_COMMANDS,
  DIFF_TOGGLE_VIEW_COMMANDS,
  bindDiffViewCommands,
  diffToggleAction,
  panelTheme,
  stageDiffCommands,
  themeVar,
  toggleDiffSurface,
  watchThemeTokens,
} from "./uiContracts.ts";

const CONTEXT = {
  resource: {
    namespace: "t3.threads",
    id: "thread-1",
    environmentId: "env-1",
    projectId: "project-1",
    threadId: "thread-1",
  },
  client: "web",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A ClientHost stub recording invokeApi calls; subscribeApi defaults to an ended stream. */
const fakeHost = ({ invoke, subscribe } = {}) => {
  const calls = [];
  return {
    calls,
    host: {
      invokeApi(request, _signal) {
        calls.push(request);
        return Promise.resolve(invoke ? invoke(request) : {});
      },
      subscribeApi(_request, signal) {
        return (
          subscribe?.(_request, signal) ?? {
            async *[Symbol.asyncIterator]() {},
          }
        );
      },
    },
  };
};

const streamOf = (frames) => ({
  async *[Symbol.asyncIterator]() {
    for (const frame of frames) {
      yield frame;
    }
  },
});

NodeTest.test("themeVar falls back to the static value without tokens", () => {
  NodeAssert.equal(themeVar(null, "--border", "border", "#dfe3e8"), "var(--border, #dfe3e8)");
  NodeAssert.equal(
    themeVar({ border: "#123456" }, "--border", "border", "#dfe3e8"),
    "var(--border, #123456)",
  );
  NodeAssert.equal(
    themeVar({ other: "#123456" }, "--border", "border", "#dfe3e8"),
    "var(--border, #dfe3e8)",
  );
});

NodeTest.test("panelTheme maps host roles to the panel's css variables", () => {
  const tokens = {
    mutedForeground: "#m",
    border: "#b",
    accentSurface: "#a",
    error: "#e",
    canvas: "#c",
    text: "#t",
    muted: "#ms",
  };
  const ui = panelTheme(tokens);
  NodeAssert.equal(ui.muted, "var(--muted-foreground, #m)");
  NodeAssert.equal(ui.border, "var(--border, #b)");
  NodeAssert.equal(ui.accent, "var(--accent, #a)");
  NodeAssert.equal(ui.destructive, "var(--destructive, #e)");
  NodeAssert.equal(ui.background, "var(--background, #c)");
  NodeAssert.equal(ui.foreground, "var(--foreground, #t)");
  NodeAssert.equal(ui.mutedSurface, "var(--muted, #ms)");
  NodeAssert.equal(ui.control.border, "1px solid var(--border, #b)");
  NodeAssert.equal(ui.gutter.color, "var(--muted-foreground, #m)");

  const fallback = panelTheme(null);
  NodeAssert.equal(fallback.border, "var(--border, #dfe3e8)");
  NodeAssert.equal(fallback.control.border, "1px solid var(--border, #dfe3e8)");
});

NodeTest.test("diffToggleAction mirrors the native toggle over listSurfaces", () => {
  const surface = (active) => ({
    id: DIFF_SURFACE_ID,
    title: "Diff",
    placement: "side-panel",
    active,
  });
  NodeAssert.equal(diffToggleAction([]), "open");
  NodeAssert.equal(diffToggleAction([surface(false)]), "activate");
  NodeAssert.equal(diffToggleAction([surface(true)]), "close");
  NodeAssert.equal(
    diffToggleAction([{ id: "other/view", title: "X", placement: "side-panel", active: true }]),
    "open",
  );
});

NodeTest.test("toggleDiffSurface opens, activates, or closes via t3.ui/panels", async () => {
  for (const [surfaces, method] of [
    [[], "openSurface"],
    [
      [{ id: DIFF_SURFACE_ID, title: "Diff", placement: "side-panel", active: false }],
      "activateSurface",
    ],
    [
      [{ id: DIFF_SURFACE_ID, title: "Diff", placement: "side-panel", active: true }],
      "closeSurface",
    ],
  ]) {
    const { host, calls } = fakeHost({
      invoke: (request) =>
        request.method === "listSurfaces"
          ? { surfaces }
          : { applied: true, surfaceId: DIFF_SURFACE_ID },
    });
    const action = await toggleDiffSurface(host, CONTEXT);
    NodeAssert.equal(calls[0].method, "listSurfaces");
    NodeAssert.deepEqual(calls[0].input, { threadId: "thread-1" });
    NodeAssert.equal(calls[1].method, method);
    NodeAssert.equal(calls[1].input.surfaceId, DIFF_SURFACE_ID);
    NodeAssert.equal(calls[1].input.threadId, "thread-1");
    if (method === "openSurface") NodeAssert.equal(calls[1].input.placement, "side-panel");
    NodeAssert.equal(
      action,
      method === "openSurface" ? "open" : method === "activateSurface" ? "activate" : "close",
    );
  }
});

NodeTest.test("toggleDiffSurface returns null without a thread scope", async () => {
  const { host, calls } = fakeHost();
  const context = {
    ...CONTEXT,
    resource: { namespace: "t3.extensions", id: "t3.diff", environmentId: "env-1" },
  };
  NodeAssert.equal(await toggleDiffSurface(host, context), null);
  NodeAssert.equal(calls.length, 0);
});

NodeTest.test("stageDiffCommands stages the native-equivalent global toggle", async () => {
  const { host } = fakeHost();
  // A host without the seam: staging is a no-op, not a crash.
  NodeAssert.doesNotThrow(() => stageDiffCommands(host));

  const { host: seamHost, calls } = fakeHost({
    invoke: (request) =>
      request.method === "listSurfaces"
        ? {
            surfaces: [
              { id: DIFF_SURFACE_ID, title: "Diff", placement: "side-panel", active: true },
            ],
          }
        : { applied: true },
  });
  let staged;
  seamHost.registerGlobalCommands = (commands, handler) => {
    staged = { commands, handler };
    return { status: "staged", onDidChange: () => () => {} };
  };
  stageDiffCommands(seamHost);
  NodeAssert.equal(staged.commands, DIFF_TOGGLE_GLOBAL_COMMANDS);
  const descriptor = staged.commands[0];
  NodeAssert.equal(descriptor.id, "toggle");
  NodeAssert.equal(descriptor.defaultKey, "mod+d");
  NodeAssert.equal(descriptor.when, "!terminalFocus");
  NodeAssert.equal(descriptor.scope, "global");
  NodeAssert.deepEqual(descriptor.activation, {
    surfaceId: DIFF_SURFACE_ID,
    placement: "side-panel",
  });

  // Dispatch drives the panels toggle; unknown ids are ignored.
  staged.handler({ commandId: "other", context: CONTEXT });
  staged.handler({ commandId: DIFF_TOGGLE_COMMAND_ID, context: CONTEXT });
  await flush();
  NodeAssert.deepEqual(
    calls.map((call) => call.method),
    ["listSurfaces", "closeSurface"],
  );
});

NodeTest.test("bindDiffViewCommands registers the view set and binds its handler", async () => {
  const { host } = fakeHost({
    invoke: (request) =>
      request.method === "registerCommands"
        ? {
            commandSetToken: "tok-1",
            results: [{ commandId: DIFF_TOGGLE_COMMAND_ID, status: "registered" }],
          }
        : { unregistered: true },
  });
  const bound = [];
  const disposers = [];
  const session = {
    context: CONTEXT,
    signal: new AbortController().signal,
    bindCommands: (token, handler) => bound.push({ token, handler }),
    onDispose: (cleanup) => disposers.push(cleanup),
  };
  bindDiffViewCommands(host, session);
  await flush();
  NodeAssert.equal(bound.length, 1);
  NodeAssert.equal(bound[0].token, "tok-1");
  NodeAssert.equal(typeof bound[0].handler, "function");
  NodeAssert.equal(disposers.length, 1);
});

NodeTest.test(
  "bindDiffViewCommands stays quiet when registration rejects or the host cannot bind",
  async () => {
    const rejected = fakeHost({
      invoke: () => ({
        commandSetToken: "tok-x",
        results: [{ commandId: DIFF_TOGGLE_COMMAND_ID, status: "rejected", reason: "no grant" }],
      }),
    });
    const bound = [];
    const session = {
      context: CONTEXT,
      signal: new AbortController().signal,
      bindCommands: (token, handler) => bound.push({ token, handler }),
      onDispose: () => {},
    };
    NodeAssert.doesNotThrow(() => bindDiffViewCommands(rejected.host, session));
    await flush();
    NodeAssert.equal(bound.length, 0);

    // A rejected invoke (missing grant / no provider) must not throw.
    const failing = fakeHost({ invoke: () => Promise.reject(new Error("denied")) });
    NodeAssert.doesNotThrow(() => bindDiffViewCommands(failing.host, session));
    await flush();
    NodeAssert.equal(bound.length, 0);

    // A host without a binding store throws synchronously from bindCommands —
    // the installation-level staged set remains the dispatch path.
    const noStore = fakeHost({
      invoke: () => ({
        commandSetToken: "tok-1",
        results: [{ commandId: DIFF_TOGGLE_COMMAND_ID, status: "registered" }],
      }),
    });
    const throwingSession = {
      context: CONTEXT,
      signal: new AbortController().signal,
      bindCommands: () => {
        throw new Error("Command binding is unavailable");
      },
      onDispose: () => {},
    };
    NodeAssert.doesNotThrow(() => bindDiffViewCommands(noStore.host, throwingSession));
    await flush();
  },
);

NodeTest.test("watchThemeTokens resolves tokens and re-resolves on stream events", async () => {
  let reads = 0;
  const seen = [];
  const { host } = fakeHost({
    invoke: () => ({ tokens: { border: `#${++reads}` }, cssVars: {} }),
    subscribe: () => streamOf([{ type: "snapshot" }, { type: "data" }, { type: "closed" }]),
  });
  watchThemeTokens(host, CONTEXT, new AbortController().signal, (tokens) => seen.push(tokens));
  await flush();
  NodeAssert.equal(reads, 3);
  NodeAssert.deepEqual(seen, [{ border: "#1" }, { border: "#2" }, { border: "#3" }]);
});

NodeTest.test(
  "watchThemeTokens keeps the panel on fallbacks when the contract is unavailable",
  async () => {
    const seen = [];
    const { host } = fakeHost({
      invoke: () => Promise.reject(new Error("grant denied")),
      subscribe: () => streamOf([{ type: "data" }]),
    });
    NodeAssert.doesNotThrow(() =>
      watchThemeTokens(host, CONTEXT, new AbortController().signal, (tokens) => seen.push(tokens)),
    );
    await flush();
    NodeAssert.equal(seen.length, 0);
  },
);

NodeTest.test("watchThemeTokens honors an aborted signal", async () => {
  const seen = [];
  const { host } = fakeHost({
    invoke: () => ({ tokens: { border: "#x" }, cssVars: {} }),
    subscribe: () => streamOf([{ type: "data" }]),
  });
  const controller = new AbortController();
  controller.abort();
  watchThemeTokens(host, CONTEXT, controller.signal, (tokens) => seen.push(tokens));
  await flush();
  NodeAssert.equal(seen.length, 0);
});

NodeTest.test("view-scoped commands carry no activation or key", () => {
  NodeAssert.equal(DIFF_TOGGLE_VIEW_COMMANDS.length, 1);
  const descriptor = DIFF_TOGGLE_VIEW_COMMANDS[0];
  NodeAssert.equal(descriptor.id, DIFF_TOGGLE_COMMAND_ID);
  NodeAssert.equal(descriptor.scope, "thread");
  NodeAssert.equal(descriptor.defaultKey, undefined);
  NodeAssert.equal(descriptor.activation, undefined);
});
