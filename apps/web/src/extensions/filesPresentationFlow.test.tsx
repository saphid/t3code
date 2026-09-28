/**
 * The first-party Files pack as the selected `t3.file/presentation` provider,
 * driven through the real panel store, navigation provider, NativeRightPanel
 * and SelectedApiPresentation — the path a host file link and the pack's own
 * "Open in panel" take. File I/O is simulated; nothing touches a disk.
 */
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { filePresentationApi, uiNavigationApi } from "@t3tools/extension-sdk/catalogue";
import type { ApiInvocation, ApiStreamInvocation } from "@t3tools/extension-sdk/capabilities";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ViewSession } from "@t3tools/extension-sdk/host";

import { selectSelectedRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { createNavigationClientProvider } from "./clientProviders";
import { registerInstalledApiClient, setInstalledApiPolicy } from "./installedApiClients";
import { NativeRightPanel } from "./nativePanels";
import { registerWorkspaceExtension } from "./workspaceRegistry";

vi.mock("./terminal/PersistentThreadTerminal", () => ({
  PersistentThreadTerminalDrawer: () => null,
  PersistentThreadTerminalPanel: () => null,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({ terminalThemeFromApp: () => ({}) }));
vi.mock("../components/AgentsPanel", () => ({ AgentsPanel: () => null }));
vi.mock("../components/pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: () => null,
}));
vi.mock("../components/pullRequest/PullRequestGhosts", () => ({
  PullRequestDetailGhost: () => null,
}));
vi.mock("../components/pullRequest/PullRequestsUnavailableState", () => ({
  PullRequestsUnavailableState: () => null,
}));
vi.mock("../state/entities", () => ({
  useThreadShell: () => null,
  readThreadShell: () => ({ projectId: "p", worktreePath: null }),
}));
vi.mock("../composerDraftStore", () => ({ useComposerDraftStore: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Frame = { readonly type: string; readonly value: unknown };
type PackHost = {
  readonly React: typeof React;
  invokeApi(request: ApiInvocation, signal: AbortSignal): Promise<unknown>;
  subscribeApi(request: ApiStreamInvocation, signal: AbortSignal): AsyncIterable<Frame>;
  discoverApis(): Promise<readonly unknown[]>;
  invokeTool(): Promise<never>;
};
type PackView = { readonly renderer: React.ComponentType };
type Pack = {
  readonly package: unknown;
  client(host: PackHost): {
    readonly surfaces: readonly { createView(session: ViewSession): PackView }[];
  };
};

// The packs are not web dependencies, so this project cannot type-check their
// source; they load by path and are typed by the shape used here.
const files = (
  (await import("../../../../packages/first-party-extensions/files/extension.tsx" as string)) as {
    default: Pack;
  }
).default;
const diff = (
  (await import("../../../../packages/first-party-extensions/diff/extension.tsx" as string)) as {
    default: Pack;
  }
).default;
const filesServer = (
  (await import("../../../../packages/first-party-extensions/files/server.ts" as string)) as {
    default: {
      apis: readonly {
        methods: readonly {
          invoke(input: unknown, session: { signal: AbortSignal }): unknown;
        }[];
      }[];
    };
  }
).default;

const pending = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/** A textarea stand-in that records where a line reveal puts the caret. */
class FakeTextArea {
  scrollTop = 0;
  scrollHeight = 2000;
  clientHeight = 200;
  readonly carets: number[] = [];
  focus() {}
  setSelectionRange(start: number) {
    this.carets.push(start);
  }
  getBoundingClientRect() {
    return { top: 0, height: 200 };
  }
}

interface Disk {
  readonly files: Record<string, string>;
  /** The selected presentation provider's version; the pack's own by default. */
  readonly presentationVersion?: string;
  /** The save outcome for the nth save (1-based). */
  readonly save?: (count: number) => unknown;
  /** Preference frames; a promise holds the stream until it settles. */
  readonly preferences?: Promise<Frame | Error>;
}

type Calls = {
  reads: number;
  saves: number;
  log: string[][];
  presentations: ApiInvocation[];
};
const newCalls = (): Calls => ({ reads: 0, saves: 0, log: [], presentations: [] });

function packHost(disk: Disk, calls: Calls) {
  const navigationVersion = uiNavigationApi.definition.version;
  const host: PackHost = {
    React,
    async discoverApis() {
      return [
        {
          id: "t3.file/presentation",
          providerId: "t3.files",
          pluginId: "t3.files",
          version: disk.presentationVersion ?? filePresentationApi.definition.version,
          generation: 1,
          health: "ready",
          selected: true,
        },
        {
          id: "t3.ui/navigation",
          providerId: "host.ui.navigation",
          version: navigationVersion,
          generation: 1,
          health: "ready",
          selected: true,
        },
      ];
    },
    async invokeApi(request, signal) {
      calls.log.push([request.id, request.method]);
      if (request.id === "t3.file/presentation") calls.presentations.push(request);
      if (request.id === "t3.file/presentation")
        return filesServer.apis[0]!.methods[0]!.invoke(request.input, { signal });
      if (request.id === "t3.ui/navigation") return navigation.invoke(request, signal);
      if (request.id === "t3.resources/lease") {
        if (request.method === "getCapabilities") return { supportedKinds: ["workspace-file"] };
        return { url: "https://example.invalid/page.html", expiresAt: Date.now() + 3_600_000 };
      }
      const relativePath = (request.input as { relativePath?: string }).relativePath ?? "";
      if (request.method === "readSnapshot") {
        calls.reads++;
        return { kind: "editable", contents: disk.files[relativePath], revision: "r1" };
      }
      if (request.method === "save") {
        calls.saves++;
        return disk.save?.(calls.saves) ?? { kind: "saved", revision: `r${calls.saves + 1}` };
      }
      throw new Error("unavailable: " + request.id + " " + request.method);
    },
    subscribeApi(request, signal) {
      return (async function* () {
        if (request.id === "t3.ui/preferences") {
          const frame = await (disk.preferences ??
            Promise.resolve({
              type: "snapshot",
              value: { wordWrap: false, renderBrowserFile: true },
            }));
          if (frame instanceof Error) throw frame;
          yield frame;
          await pending(signal);
        } else if (request.id === "t3.workspace/tree") {
          yield { type: "data", value: { kind: "complete", entryCount: 0, truncated: false } };
        } else await pending(signal);
      })();
    },
    invokeTool: async () => {
      throw new Error("unused");
    },
  };
  let navigation = {
    invoke: (_request: ApiInvocation, _signal: AbortSignal): Promise<unknown> =>
      Promise.reject(new Error("navigation unavailable")),
  };
  return {
    host,
    useNavigation(invoke: typeof navigation.invoke) {
      navigation = { invoke };
    },
  };
}

const context: ViewContext = {
  client: "web",
  resource: {
    namespace: "t3.workspace",
    id: "file",
    environmentId: "files-flow",
    projectId: "p",
    threadId: "t",
  },
};
const ref = scopeThreadRef(EnvironmentId.make("files-flow"), ThreadId.make("t"));

/** Mounts the right panel with Files selected for `t3.file/presentation`. */
async function mountPanel(disk: Disk) {
  const calls = newCalls();
  const { host, useNavigation } = packHost(disk, calls);
  const caller = { installationId: "t3.files", contentHash: "h", installationGeneration: 1 };
  const installed = {
    id: "t3.files",
    contentHash: "h",
    installationGeneration: 1,
    enabled: true,
    package: files.package,
    grants: { capabilities: ["t3.ui/navigation.open"], projectIds: ["p"] },
  };
  const navigation = createNavigationClientProvider(
    {
      environmentId: ref.environmentId,
      client: "web",
      emit: () => {},
      installations: () => [installed],
    } as unknown as Parameters<typeof createNavigationClientProvider>[0],
    async () => {},
  );
  useNavigation(async (request, signal) =>
    navigation.invoke({
      method: request.method,
      input: request.input,
      context: request.context,
      caller,
      signal,
    } as unknown as Parameters<typeof navigation.invoke>[0]),
  );
  const cleanups = [
    registerWorkspaceExtension(files.client(host) as never, undefined, {
      environmentId: ref.environmentId,
    }),
    registerInstalledApiClient(ref.environmentId, "t3.files", host as never),
  ];
  setInstalledApiPolicy(ref.environmentId, {
    apiSelections: [],
    apiResolution: [{ id: "t3.file/presentation", providerId: "t3.files" }],
  } as never);
  useRightPanelStore.setState({
    byThreadKey: {},
    extensionDockByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  function App() {
    const store = useRightPanelStore();
    const surface = selectSelectedRightPanelSurface(store.byThreadKey, ref);
    return surface ? (
      <NativeRightPanel
        surface={surface as Parameters<typeof NativeRightPanel>[0]["surface"]}
        threadRef={ref}
        context={context}
        visible
        bindings={{ files: { surface, hasProject: true, cwd: "/fixture" } } as never}
      />
    ) : null;
  }
  const textarea = new FakeTextArea();
  let root: ReactTestRenderer | undefined;
  await act(async () => {
    root = create(<App />, {
      createNodeMock: (element) => (element.type === "textarea" ? textarea : null),
    });
  });
  const tree = root!;
  return {
    calls,
    textarea,
    /** A host file link: the navigation provider's `openFile`. */
    async navigation(input: { relativePath: string; line?: number }) {
      await navigation.invoke({
        method: "openFile",
        input,
        context,
        caller,
        signal: new AbortController().signal,
      } as unknown as Parameters<typeof navigation.invoke>[0]);
    },
    editor: () => tree.root.findByProps({ "aria-label": "File editor" }),
    text: () => JSON.stringify(tree.toJSON()),
    frames: () => tree.root.findAllByType("iframe").length,
    editors: () => tree.root.findAllByProps({ "aria-label": "File editor" }).length,
    button: (label: string) =>
      tree.root.findAllByType("button").find((button) => button.children.includes(label)),
    async unmount() {
      await act(async () => {
        tree.unmount();
        for (const cleanup of cleanups) cleanup();
        setInstalledApiPolicy(ref.environmentId, null);
      });
    },
  };
}

type Panel = Awaited<ReturnType<typeof mountPanel>>;

/** Edits the open file and lets autosave land on a conflict. */
async function conflictedEdit(panel: Panel, contents: string) {
  await act(async () => {
    panel.editor().props.onChange({ target: { value: contents } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(panel.calls.saves).toBe(1);
  expect(panel.text()).toContain("Keep my version");
}

const editorState = (panel: Panel) => ({
  contents: panel.editor().props.value as string,
  conflict: panel.text().includes("Keep my version"),
  saves: panel.calls.saves,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reopening a file that is already open", () => {
  const USER_EDIT = "one\ntwo\nthree";

  // Each case edits its own file: a conflict left behind by one case would
  // otherwise be handed to the next case's view of the same file.
  const open = async (path: string) => {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", lineHeight: "16px" }));
    const panel = await mountPanel({
      files: { [path]: "disk copy" },
      save: () => ({ kind: "conflict" }),
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, path));
      expect(panel.editor().props.value).toBe("disk copy");
      await conflictedEdit(panel, USER_EDIT);
    } catch (error) {
      await panel.unmount();
      throw error;
    }
    return panel;
  };

  // Review repro (proof-host-6 P1): the pack's own toolbar action.
  it("keeps the conflicted buffer when Files opens its own file in the panel", async () => {
    const panel = await open("toolbar.txt");
    try {
      await act(async () => panel.button("Open in panel")!.props.onClick());
      expect(editorState(panel)).toEqual({ contents: USER_EDIT, conflict: true, saves: 1 });
      expect(panel.calls.reads).toBe(1);
    } finally {
      await panel.unmount();
    }
  });

  it("keeps the conflicted buffer when a host file link names the open file", async () => {
    const panel = await open("link.txt");
    try {
      await act(async () => panel.navigation({ relativePath: "link.txt" }));
      expect(editorState(panel)).toEqual({ contents: USER_EDIT, conflict: true, saves: 1 });
      expect(panel.calls.reads).toBe(1);
    } finally {
      await panel.unmount();
    }
  });

  it("reveals a linked line in the open file without dropping the conflicted buffer", async () => {
    const panel = await open("line.txt");
    try {
      await act(async () => panel.navigation({ relativePath: "line.txt", line: 2 }));
      expect(editorState(panel)).toEqual({ contents: USER_EDIT, conflict: true, saves: 1 });
      // Line 2 starts after "one\n".
      expect(panel.textarea.carets.at(-1)).toBe(4);
      // A later link without a line focuses the same view: nothing re-reads.
      const reads = panel.calls.reads;
      await act(async () => panel.navigation({ relativePath: "line.txt" }));
      expect(editorState(panel)).toEqual({ contents: USER_EDIT, conflict: true, saves: 1 });
      expect(panel.calls.reads).toBe(reads);
    } finally {
      await panel.unmount();
    }
  });
});

// Review repro (proof-host-6 P5): a line link to an HTML file lands on its
// source at that line — without changing the shared rendered preference.
describe("a file link with a line", () => {
  it("opens an HTML file's source at the line in the selected Files presentation", async () => {
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", lineHeight: "16px" }));
    const panel = await mountPanel({
      files: { "index.html": "<p>1</p>\n<p>2</p>\n<p>3</p>" },
    });
    try {
      await act(async () => panel.navigation({ relativePath: "index.html", line: 3 }));
      await act(async () => {});
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual({
        frames: 0,
        editors: 1,
      });
      expect(panel.editor().props.value).toBe("<p>1</p>\n<p>2</p>\n<p>3</p>");
      expect(panel.textarea.carets.at(-1)).toBe(18);
      expect(panel.calls.log.filter(([, method]) => method === "setPreferences")).toEqual([]);
    } finally {
      await panel.unmount();
    }
  });
});

// Compatibility: a provider still on the 1.0.0 contract is sent the path it
// declared, never the 1.1.0 line its closed input would reject.
describe("a presentation provider on 1.0.0", () => {
  it("is asked for the path alone", async () => {
    const panel = await mountPanel({
      files: { "a.txt": "a" },
      presentationVersion: "1.0.0",
    });
    try {
      await act(async () => panel.navigation({ relativePath: "a.txt", line: 3 }));
      expect(
        panel.calls.presentations.map(({ versionRange, input }) => ({ versionRange, input })),
      ).toEqual([{ versionRange: "^1.0.0", input: { relativePath: "a.txt" } }]);
    } finally {
      await panel.unmount();
    }
  });
});

// Review repro (proof-host-6 P4): the saved HTML choice decides the first
// frame. Until the preference answers, an HTML file shows neither its page
// nor its source.
describe("the first frame of an HTML file", () => {
  async function mountView(restoreState: unknown, preference: Promise<Frame | Error>) {
    const calls = newCalls();
    const { host } = packHost(
      { files: { "index.html": "<p>page</p>" }, preferences: preference },
      calls,
    );
    const stop = new AbortController();
    const session = {
      context: { ...context, resource: { ...context.resource, namespace: "t3.files" } },
      signal: stop.signal,
      visible: true,
      restoring: false,
      restoreState,
      onVisibility: () => () => {},
      save: () => true,
      publish: () => true,
      onDispose: () => {},
    } as unknown as ViewSession;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    const Renderer = files.client(host).surfaces[0]!.createView(session).renderer;
    let root: ReactTestRenderer | undefined;
    await act(async () => {
      root = create(<Renderer />);
    });
    const tree = root!;
    return {
      shown: () => ({
        frames: tree.root.findAllByType("iframe").length,
        source: tree.root.findAllByType("textarea").length,
      }),
      mints: () =>
        calls.log.filter(
          ([id, method]) => id === "t3.resources/lease" && method !== "getCapabilities",
        ).length,
      async unmount() {
        await act(async () => {
          stop.abort();
          tree.unmount();
        });
      },
    };
  }
  const held = () => {
    let settle!: (frame: Frame | Error) => void;
    const promise = new Promise<Frame | Error>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  };

  it("never mounts the page when the saved choice is source", async () => {
    const preference = held();
    const view = await mountView({ relativePath: "index.html" }, preference.promise);
    try {
      expect(view.shown()).toEqual({ frames: 0, source: 0 });
      await act(async () =>
        preference.settle({
          type: "snapshot",
          value: { wordWrap: false, renderBrowserFile: false },
        }),
      );
      expect(view.shown()).toEqual({ frames: 0, source: 1 });
      expect(view.mints()).toBe(0);
    } finally {
      await view.unmount();
    }
  });

  it("follows the shared choice over a restored view's older one", async () => {
    const preference = held();
    const view = await mountView(
      { relativePath: "index.html", renderHtml: false },
      preference.promise,
    );
    try {
      expect(view.shown()).toEqual({ frames: 0, source: 0 });
      await act(async () =>
        preference.settle({
          type: "snapshot",
          value: { wordWrap: false, renderBrowserFile: true },
        }),
      );
      expect(view.shown()).toEqual({ frames: 1, source: 0 });
    } finally {
      await view.unmount();
    }
  });

  it("falls back to the view's own choice on a host without the preference", async () => {
    for (const answer of [
      { type: "snapshot", value: { wordWrap: false } },
      new Error("API capability denied: t3.ui/preferences.read"),
    ]) {
      const preference = held();
      const view = await mountView({ relativePath: "index.html" }, preference.promise);
      try {
        expect(view.shown()).toEqual({ frames: 0, source: 0 });
        await act(async () => preference.settle(answer));
        expect(view.shown()).toEqual({ frames: 1, source: 0 });
      } finally {
        await view.unmount();
      }
    }
  });
});

// Review finding (proof-host-6 P6): the Diff panel is product UI; its SDK
// plumbing notes do not ship in it.
describe("the Diff panel", () => {
  it("renders no SDK slice notice", async () => {
    const calls = newCalls();
    const { host } = packHost({ files: {} }, calls);
    const stop = new AbortController();
    const session = {
      context: { ...context, resource: { ...context.resource, namespace: "t3.diff" } },
      signal: stop.signal,
      visible: true,
      restoring: false,
      restoreState: null,
      onVisibility: () => () => {},
      save: () => true,
      publish: () => true,
      onDispose: () => {},
    } as unknown as ViewSession;
    const Renderer = diff.client(host).surfaces[0]!.createView(session).renderer;
    let root: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        root = create(<Renderer />);
      });
      expect(root!.root.findAllByProps({ "aria-label": "Slice notice" })).toHaveLength(0);
      expect(JSON.stringify(root!.toJSON())).not.toContain("t3.vcs/diff 1.1");
    } finally {
      await act(async () => {
        stop.abort();
        root?.unmount();
      });
    }
  });
});
