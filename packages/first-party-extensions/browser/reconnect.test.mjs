/**
 * The REAL BrowserView, bundled by esbuild, across a backend restart (D13):
 * the socket drops, the server comes back on a new epoch with no sessions,
 * and the next address the user enters must open a fresh session and present
 * it — no raw socket error or epoch text left behind. The host fake follows
 * the real ones: resumable streams suspend and resume with a fresh snapshot,
 * plain streams fail with the socket's close error, and the surface ends a
 * lease whose epoch the synced state has moved past.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
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

// The slot hook measures and observes its element; a fixed on-screen box is enough.
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.window = {
  innerWidth: 1200,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = () => ({ overflowX: "visible", overflowY: "visible" });

function nodeMock() {
  const element = {
    parentElement: null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contains: (node) => node === element,
    focus() {},
    blur() {},
    select() {},
  };
  element.ownerDocument = {
    documentElement: {},
    defaultView: globalThis.window,
    elementsFromPoint: () => [element],
  };
  return element;
}

let bundle;
NodeTest.before(async () => {
  const built = await build({
    stdin: {
      contents:
        NodeFS.readFileSync(NodePath.join(packageDir, "extension.tsx"), "utf8") +
        "\nexport { BrowserView };",
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
        name: "external-react",
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path),
            external: true,
          }));
        },
      },
    ],
  });
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-browser-reconnect-"));
  const path = NodePath.join(dir, "bundle.mjs");
  try {
    await NodeFSP.writeFile(path, built.outputFiles[0].text);
    bundle = await import(NodeURL.pathToFileURL(path).href);
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});

function browserSession(tabId, url, title) {
  return {
    tabId,
    requestedUrl: url,
    navigation: { kind: "loaded", url, title },
    canGoBack: false,
    canGoForward: false,
    viewport: { _tag: "fill" },
    engine: { state: "ready", generation: `gen-${tabId}` },
    zoomFactor: 1,
    appearance: null,
    audioMuted: false,
    audible: false,
    devToolsOpen: false,
    pictureInPicture: false,
  };
}

const onAbort = (signal, resolve) => signal.addEventListener("abort", resolve, { once: true });

/**
 * One server process at a time. `drop()` kills the socket; `restart()` brings
 * the server back on a new epoch whose revisions start over and which holds
 * no sessions, like a restarted preview manager.
 */
function restartingBackend() {
  const server = {
    epoch: "epoch-a",
    revision: 40,
    sessions: [browserSession("tab-a", "https://a.test/", "Page A")],
  };
  let up = true;
  let drops = new Set();
  let restarts = new Set();
  const surfaceWatchers = new Set();
  const acquires = [];
  const presents = [];
  const socketClosed = () => new Error("SocketCloseError: 1006");
  const hang = (signal) => new Promise((resolve) => onAbort(signal, resolve));

  function snapshotFrames() {
    const snapshotId = `snapshot-${server.epoch}`;
    const meta = { snapshotId, serverEpoch: server.epoch, revision: server.revision };
    const count = server.sessions.length;
    return [
      { kind: "snapshot-start", ...meta, sessionCount: count },
      { kind: "snapshot-chunk", snapshotId, chunkIndex: 0, sessions: [...server.sessions] },
      { kind: "snapshot-complete", ...meta, sessionCount: count },
    ];
  }

  /** `onSuspended` present: host-resumed; absent: the plain transport-bound stream. */
  function sessionEvents(signal, resumable, onSuspended) {
    return {
      async *[Symbol.asyncIterator]() {
        let sequence = 0;
        for (;;) {
          if (!up) {
            await new Promise((resolve) => {
              restarts.add(resolve);
              onAbort(signal, resolve);
            });
          }
          if (signal.aborted) return;
          for (const value of snapshotFrames())
            yield { streamId: "events", type: "data", sequence: ++sequence, value };
          await new Promise((resolve) => {
            drops.add(resolve);
            onAbort(signal, resolve);
          });
          if (signal.aborted) return;
          if (!resumable) throw socketClosed();
          onSuspended?.();
          sequence = 0;
        }
      },
    };
  }

  const host = {
    React,
    async invokeApi(request) {
      if (request.id !== "t3.browser/sessions") throw new Error("API unavailable");
      if (!up) throw socketClosed();
      if (request.method === "open") {
        server.revision += 1;
        const session = browserSession("tab-b", request.input.url, "Page B");
        server.sessions.push(session);
        return {
          commandId: `open-${server.revision}`,
          outcome: "accepted",
          serverEpoch: server.epoch,
          revision: server.revision,
          session,
        };
      }
      if (request.method === "navigate" && request.input.serverEpoch !== server.epoch)
        throw new Error("BrowserStaleServerEpoch: the request epoch does not match");
      throw new Error("API unavailable");
    },
    subscribeApi(request, signal) {
      if (request.id === "t3.browser/sessions" && request.name === "events")
        return sessionEvents(signal, false);
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => hang(signal).then(() => ({ done: true, value: undefined })),
        }),
      };
    },
    resumableStreams: {
      version: 4,
      subscribeApi(request, signal, options) {
        if (request.id !== "t3.browser/sessions" || request.name !== "events")
          throw new Error(`${request.id}#${request.name} is not resumable`);
        return sessionEvents(signal, true, options?.onSuspended);
      },
    },
    browserSurface: {
      id: "t3.browser/surface",
      version: "1.0.0",
      presentation: { supported: true },
      acquire(request) {
        acquires.push({ tabId: request.session.tabId, serverEpoch: request.session.serverEpoch });
        if (request.session.serverEpoch !== server.epoch)
          return {
            ok: false,
            denial: {
              reason: "epoch-changed",
              detail: "the synced server epoch has moved past this session's epoch",
            },
          };
        const listeners = new Set();
        const lease = {
          session: request.session,
          state: { kind: "active", presentation: { supported: true } },
          onDidChangeState(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          present(rect, visible) {
            if (lease.state.kind === "ended") return "ended";
            presents.push({
              tabId: request.session.tabId,
              serverEpoch: request.session.serverEpoch,
              visible,
            });
            return "accepted";
          },
          release() {
            end("released");
          },
        };
        const end = (reason) => {
          if (lease.state.kind === "ended") return;
          lease.state = { kind: "ended", reason };
          surfaceWatchers.delete(watch);
          for (const listener of listeners) listener(lease.state);
        };
        // The host's synced sessions: a new epoch ends every older lease.
        const watch = () => {
          if (server.epoch !== request.session.serverEpoch) end("epoch-changed");
        };
        surfaceWatchers.add(watch);
        return { ok: true, lease };
      },
    },
  };

  return {
    host,
    acquires,
    presents,
    drop() {
      up = false;
      const pending = drops;
      drops = new Set();
      for (const resolve of pending) resolve();
    },
    restart() {
      server.epoch = "epoch-b";
      server.revision = 1;
      server.sessions = [];
      up = true;
      for (const watch of surfaceWatchers) watch();
      const pending = restarts;
      restarts = new Set();
      for (const resolve of pending) resolve();
    },
  };
}

function viewSession() {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    context: {
      client: "desktop",
      resource: {
        namespace: "t3.browser",
        id: "view",
        environmentId: "env-a",
        projectId: "project-a",
        threadId: "thread-a",
      },
    },
    visible: true,
    restoreState: { url: "https://a.test/", tabId: "tab-a", serverEpoch: "epoch-a" },
    save() {},
    onVisibility: () => () => {},
    bindCommands: () => () => {},
  };
}

const textOf = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : (node?.children ?? []).map(textOf).join("");

/** Drains the fake transport's promise chains and React's resulting renders. */
async function settle() {
  await act(async () => {
    for (let round = 0; round < 20; round += 1)
      await new Promise((resolve) => setImmediate(resolve));
  });
}

NodeTest.test(
  "after a backend restart the next address opens a fresh session and presents it",
  async () => {
    const backend = restartingBackend();
    const view = viewSession();
    let renderer;
    await act(async () => {
      renderer = create(
        React.createElement(bundle.BrowserView, { host: backend.host, session: view }),
        {
          createNodeMock: nodeMock,
        },
      );
    });
    const status = () =>
      textOf(
        renderer.root.find(
          (node) => node.type === "div" && node.props["aria-label"] === "Browser status",
        ),
      );
    try {
      await settle();
      NodeAssert.equal(status(), "Page A — engine ready, navigation loaded");
      NodeAssert.deepEqual(backend.presents.at(-1), {
        tabId: "tab-a",
        serverEpoch: "epoch-a",
        visible: true,
      });

      backend.drop();
      await settle();
      NodeAssert.equal(status(), "Environment is not connected.");
      backend.restart();
      await settle();
      NodeAssert.equal(
        status(),
        "Session ended — the server restarted. Enter an address to open a new session.",
      );

      const address = renderer.root.find(
        (node) => node.type === "input" && node.props["aria-label"] === "Address",
      );
      await act(async () => {
        address.props.onChange({ target: { value: "https://b.test/" } });
      });
      await act(async () => {
        address.props.onKeyDown({
          key: "Enter",
          preventDefault() {},
          currentTarget: { blur() {} },
        });
      });
      await settle();

      NodeAssert.deepEqual(backend.acquires.at(-1), { tabId: "tab-b", serverEpoch: "epoch-b" });
      NodeAssert.deepEqual(backend.presents.at(-1), {
        tabId: "tab-b",
        serverEpoch: "epoch-b",
        visible: true,
      });
      NodeAssert.equal(status(), "Page B — engine ready, navigation loaded");
      const text = textOf(renderer.toJSON());
      NodeAssert.doesNotMatch(text, /SocketCloseError|1006|epoch-changed/);
    } finally {
      await act(async () => {
        view.controller.abort();
        renderer.unmount();
      });
    }
  },
);
