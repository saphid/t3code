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
  readProject: () => ({ workspaceRoot: "/fixture" }),
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
  /** Directory entries the tree snapshot lists next to the files. */
  readonly directories?: readonly string[];
  /** The selected presentation provider's version; the pack's own by default. */
  readonly presentationVersion?: string;
  /** Rejects the presentation provider's `open` while it returns an error. */
  readonly presentationError?: () => Error | undefined;
  /** The save outcome for the nth save (1-based). */
  readonly save?: (count: number) => unknown;
  /** Preference frames; a promise holds the stream until it settles. */
  readonly preferences?: Promise<Frame | Error>;
  /** The unary preference read; follows the stream unless given. */
  readonly preferencesRead?: Promise<Frame | Error>;
  /** A later preference change the stream carries after its first frame. */
  readonly preferenceChange?: Promise<Frame>;
  /** The preference write's receipt; unavailable unless given. */
  readonly preferenceWrite?: Promise<unknown>;
  /** The host's preview-browser open; records its calls and says how it went. */
  readonly previewFile?: (...args: unknown[]) => Promise<string>;
}

type Calls = {
  reads: number;
  saves: number;
  log: string[][];
  presentations: ApiInvocation[];
};
const newCalls = (): Calls => ({ reads: 0, saves: 0, log: [], presentations: [] });

const preferenceFrame = (disk: Disk) =>
  disk.preferences ??
  Promise.resolve<Frame>({
    type: "snapshot",
    value: { wordWrap: false, renderBrowserFile: true },
  });

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
      const presentationError =
        request.id === "t3.file/presentation" ? disk.presentationError?.() : undefined;
      if (presentationError) throw presentationError;
      if (request.id === "t3.file/presentation")
        return filesServer.apis[0]!.methods[0]!.invoke(request.input, { signal });
      if (request.id === "t3.ui/navigation") return navigation.invoke(request, signal);
      if (
        request.id === "t3.ui/preferences" &&
        request.method === "setPreferences" &&
        disk.preferenceWrite
      )
        return disk.preferenceWrite;
      if (request.id === "t3.ui/preferences" && request.method === "getPreferences") {
        const frame = await (disk.preferencesRead ?? preferenceFrame(disk));
        if (frame instanceof Error) throw frame;
        return frame.value;
      }
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
          const frame = await preferenceFrame(disk);
          if (frame instanceof Error) throw frame;
          yield frame;
          if (disk.preferenceChange) yield await disk.preferenceChange;
          await pending(signal);
        } else if (request.id === "t3.workspace/tree") {
          const entries = [
            ...(disk.directories ?? []).map((path) => ({ path, kind: "directory" })),
            ...Object.keys(disk.files).map((path) => ({ path, kind: "file" })),
          ];
          // The contract's chunks carry at most 200 entries.
          for (let start = 0; start < entries.length; start += 200)
            yield {
              type: "data",
              value: {
                kind: "chunk",
                entries: entries.slice(start, start + 200),
                truncated: false,
              },
            };
          yield {
            type: "data",
            value: { kind: "complete", entryCount: entries.length, truncated: false },
          };
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
    undefined,
    (disk.previewFile ?? (async () => "opened")) as never,
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
    /** Remounts the panel from its persisted state, as a reload does. */
    async reload() {
      await act(async () => tree.update(<></>));
      await act(async () => tree.update(<App />));
    },
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
    /** The first control whose accessible name is `label`. */
    labelled: (label: string) => tree.root.findAllByProps({ "aria-label": label }).at(0),
    /** Visible rows of the workspace tree, as rendered text. */
    rows: () =>
      tree.root
        .findByProps({ "aria-label": "Workspace files" })
        .findAllByType("button")
        .map((row) => row.children.join("")),
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

// Review repros (proof-host-8 P1, P2): an open aimed at the file view that is
// already showing goes to that view in place. Its editor, and whatever it has
// not saved yet, stays; a different file is selected in it.
describe("a file link to the open file view", () => {
  const lineReveal = () => {
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", lineHeight: "16px" }));
  };

  it.each([
    { outcome: { kind: "conflict" }, conflict: true },
    { outcome: { kind: "error", message: "disk full" }, conflict: false },
  ])(
    "keeps edits whose save is still pending, settling as $outcome.kind",
    async ({ outcome, conflict }) => {
      vi.useFakeTimers();
      lineReveal();
      let finishSave!: (outcome: unknown) => void;
      const panel = await mountPanel({
        files: { "pending.txt": "disk copy" },
        save: () =>
          new Promise((resolve) => {
            finishSave = resolve;
          }),
      });
      try {
        await act(async () => panel.navigation({ relativePath: "pending.txt" }));
        // Dirty: the autosave debounce has not fired yet.
        await act(async () => panel.editor().props.onChange({ target: { value: "one\ntwo" } }));
        await act(async () => panel.navigation({ relativePath: "pending.txt", line: 2 }));
        expect(editorState(panel)).toEqual({ contents: "one\ntwo", conflict: false, saves: 0 });
        // Saving: the flushed save is in flight when the next link lands.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        await act(async () => panel.editor().props.onChange({ target: { value: "one\ntwo\n3" } }));
        await act(async () => panel.navigation({ relativePath: "pending.txt", line: 3 }));
        await act(async () => finishSave(outcome));
        expect(editorState(panel)).toEqual({ contents: "one\ntwo\n3", conflict, saves: 1 });
        expect(panel.calls.reads).toBe(1);
        expect(panel.calls.presentations).toHaveLength(3);
      } finally {
        await panel.unmount();
      }
    },
  );

  it("reveals each requested line, repeats included, in the same editor", async () => {
    lineReveal();
    const panel = await mountPanel({ files: { "lines.txt": "one\ntwo\nthree" } });
    try {
      await act(async () => panel.navigation({ relativePath: "lines.txt" }));
      for (const line of [2, 3, 2, 2])
        await act(async () => panel.navigation({ relativePath: "lines.txt", line }));
      // Lines 2 and 3 start at offsets 4 and 8.
      expect(panel.textarea.carets).toEqual([4, 8, 4, 4]);
      expect(panel.calls.reads).toBe(1);
    } finally {
      await panel.unmount();
    }
  });

  it("selects the linked file when the view has moved to another one", async () => {
    const panel = await mountPanel({ files: { "a.txt": "file A", "b.txt": "file B" } });
    try {
      await act(async () => panel.navigation({ relativePath: "a.txt" }));
      await act(async () => panel.button("b.txt")!.props.onClick());
      expect(panel.editor().props.value).toBe("file B");
      await act(async () => panel.navigation({ relativePath: "a.txt" }));
      expect(panel.editor().props.value).toBe("file A");
    } finally {
      await panel.unmount();
    }
  });

  // Native parity: closing the tab disposes its edits; reopening reads the disk.
  it("starts from the disk after its tab was closed", async () => {
    vi.useFakeTimers();
    const panel = await mountPanel({
      files: { "closed.txt": "disk copy" },
      save: () => ({ kind: "conflict" }),
    });
    try {
      await act(async () => panel.navigation({ relativePath: "closed.txt" }));
      await conflictedEdit(panel, "abandoned edit");
      await act(async () => {
        useRightPanelStore.setState({ byThreadKey: {} });
      });
      await act(async () => panel.navigation({ relativePath: "closed.txt" }));
      expect(editorState(panel)).toEqual({ contents: "disk copy", conflict: false, saves: 1 });
    } finally {
      await panel.unmount();
    }
  });
});

// Review repros (proof-host-10 P2): a failed open is shown beside the view
// it could not navigate, which keeps its unsaved edits.
describe("a file link the presentation provider rejects", () => {
  const failing = (files: Record<string, string>) => {
    const outage = { on: false };
    return {
      outage,
      disk: {
        files,
        presentationError: () => (outage.on ? new Error("provider offline") : undefined),
      },
    };
  };

  it("reports a failed change of file and clears it once an open succeeds", async () => {
    vi.useFakeTimers();
    const { outage, disk } = failing({ "a.txt": "file A", "b.txt": "file B" });
    const panel = await mountPanel(disk);
    try {
      await act(async () => panel.navigation({ relativePath: "a.txt" }));
      await act(async () => panel.button("b.txt")!.props.onClick());
      await act(async () => panel.editor().props.onChange({ target: { value: "unsaved B" } }));
      outage.on = true;
      await act(async () => panel.navigation({ relativePath: "a.txt", line: 2 }));
      expect(panel.editor().props.value).toBe("unsaved B");
      expect(panel.text()).toContain("provider offline");
      outage.on = false;
      await act(async () => panel.navigation({ relativePath: "b.txt" }));
      expect(panel.editor().props.value).toBe("unsaved B");
      expect(panel.text()).not.toContain("provider offline");
    } finally {
      await panel.unmount();
    }
  });

  it("reports a failed repeated line reveal and keeps the pending edit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", lineHeight: "16px" }));
    const { outage, disk } = failing({ "lines.txt": "one\ntwo\nthree" });
    const panel = await mountPanel(disk);
    try {
      await act(async () => panel.navigation({ relativePath: "lines.txt", line: 2 }));
      await act(async () => panel.editor().props.onChange({ target: { value: "one\ntwo!" } }));
      outage.on = true;
      await act(async () => panel.navigation({ relativePath: "lines.txt", line: 2 }));
      expect(editorState(panel)).toEqual({ contents: "one\ntwo!", conflict: false, saves: 0 });
      expect(panel.text()).toContain("provider offline");
    } finally {
      await panel.unmount();
    }
  });
});

// Review repro (proof-host-10 P2): an in-place open carries the view's saved
// settings; it does not replace them with the open's path.
describe("a file link to the path the view already shows", () => {
  it("keeps the view's saved choices across a reload", async () => {
    const panel = await mountPanel({ files: { "a.md": "# heading" } });
    try {
      await act(async () => panel.navigation({ relativePath: "a.md" }));
      await act(async () => panel.button("Show rendered markdown")!.props.onClick());
      await act(async () => panel.navigation({ relativePath: "a.md" }));
      expect(panel.button("Show markdown source")).toBeDefined();
      await panel.reload();
      expect({
        rendered: !!panel.button("Show markdown source"),
        source: !!panel.button("Show rendered markdown"),
      }).toEqual({ rendered: true, source: false });
    } finally {
      await panel.unmount();
    }
  });
});

// Review repros (proof-host-10 P2): the preference's first answer, begun
// before the user chose, does not undo that choice; later changes still apply.
describe("an HTML file whose first preference answer arrives after a choice", () => {
  const view = { frames: 0, editors: 1 };
  const page = { frames: 1, editors: 0 };
  const rendered: Frame = {
    type: "snapshot",
    value: { wordWrap: false, renderBrowserFile: true },
  };
  const stubFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
    );

  it.each(["read", "stream"] as const)(
    "keeps the source when the %s answers late",
    async (kind) => {
      stubFetch();
      let answer!: (frame: Frame) => void;
      const held = new Promise<Frame>((resolve) => {
        answer = resolve;
      });
      const silent = new Promise<Frame>(() => {});
      const panel = await mountPanel({
        files: { "late.html": "<p>source</p>" },
        preferences: kind === "stream" ? held : silent,
        preferencesRead: kind === "read" ? held : silent,
        preferenceWrite: new Promise(() => {}),
      });
      try {
        await act(async () => panel.navigation({ relativePath: "late.html" }));
        await act(async () => panel.button("Show HTML source")!.props.onClick());
        expect({ frames: panel.frames(), editors: panel.editors() }).toEqual(view);
        await act(async () => answer(rendered));
        expect({ frames: panel.frames(), editors: panel.editors() }).toEqual(view);
      } finally {
        await panel.unmount();
      }
    },
  );

  it("still follows a later change of the shared preference", async () => {
    stubFetch();
    let answer!: (frame: Frame) => void;
    const held = new Promise<Frame>((resolve) => {
      answer = resolve;
    });
    let change!: (frame: Frame) => void;
    const panel = await mountPanel({
      files: { "late.html": "<p>source</p>" },
      preferences: held,
      preferencesRead: new Promise(() => {}),
      preferenceChange: new Promise((resolve) => {
        change = resolve;
      }),
      preferenceWrite: new Promise(() => {}),
    });
    try {
      await act(async () => panel.navigation({ relativePath: "late.html" }));
      await act(async () => panel.button("Show HTML source")!.props.onClick());
      await act(async () => answer(rendered));
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual(view);
      await act(async () => change({ ...rendered, type: "data" }));
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual(page);
    } finally {
      await panel.unmount();
    }
  });
});

// Review repro (proof-host-8 P2): a preference stream that never answers.
describe("an HTML file whose preference stream stays silent", () => {
  it("falls back to the view's own choice once the bounded read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    const panel = await mountPanel({
      files: { "silent.html": "<p>source</p>" },
      preferences: new Promise(() => {}),
      preferencesRead: Promise.resolve(new Error("Client request timed out")),
    });
    try {
      await act(async () => panel.navigation({ relativePath: "silent.html" }));
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual({
        frames: 1,
        editors: 0,
      });
      await act(async () => panel.button("Show HTML source")!.props.onClick());
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual({
        frames: 0,
        editors: 1,
      });
    } finally {
      await panel.unmount();
    }
  });

  it("shows the source at once when the user asks, even with no answer at all", async () => {
    const panel = await mountPanel({
      files: { "silent.html": "<p>source</p>" },
      preferences: new Promise(() => {}),
      preferencesRead: new Promise(() => {}),
    });
    try {
      await act(async () => panel.navigation({ relativePath: "silent.html" }));
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual({
        frames: 0,
        editors: 0,
      });
      await act(async () => panel.button("Show HTML source")!.props.onClick());
      expect({ frames: panel.frames(), editors: panel.editors() }).toEqual({
        frames: 0,
        editors: 1,
      });
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

// Native parity (FileBrowserPanel): one toolbar control expands every folder
// in the tree, then collapses them all again.
describe("expanding and collapsing every folder", () => {
  it("toggles every folder from one control, as the native tree does", async () => {
    const panel = await mountPanel({
      directories: ["src", "src/lib", "docs"],
      files: { "src/lib/deep.ts": "x", "src/top.ts": "y", "docs/guide.md": "z", "root.txt": "r" },
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "root.txt"));
      expect(panel.rows()).toEqual(["▸ docs/", "▸ src/", "root.txt"]);
      expect(panel.labelled("Expand all folders")).toBeDefined();
      await act(async () => panel.labelled("Expand all folders")!.props.onClick());
      expect(panel.rows()).toEqual([
        "▾ docs/",
        "guide.md",
        "▾ src/",
        "▾ lib/",
        "deep.ts",
        "top.ts",
        "root.txt",
      ]);
      expect(panel.labelled("Expand all folders")).toBeUndefined();
      await act(async () => panel.labelled("Collapse all folders")!.props.onClick());
      expect(panel.rows()).toEqual(["▸ docs/", "▸ src/", "root.txt"]);
      expect(panel.labelled("Expand all folders")).toBeDefined();
    } finally {
      await panel.unmount();
    }
  });

  it("names the collapse once every folder is open by hand", async () => {
    const panel = await mountPanel({
      directories: ["src"],
      files: { "src/a.ts": "a", "b.ts": "b" },
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "b.ts"));
      expect(panel.labelled("Expand all folders")).toBeDefined();
      const folder = panel.labelled("Workspace files")!.findAllByType("button")[0]!;
      await act(async () => folder.props.onClick());
      expect(panel.labelled("Collapse all folders")).toBeDefined();
      await act(async () => folder.props.onClick());
      expect(panel.labelled("Expand all folders")).toBeDefined();
    } finally {
      await panel.unmount();
    }
  });

  // Review repro (gaps-files-2 P3): expand-all past the saved-folder bound
  // still stands after a reload.
  it("keeps every folder open across a reload, past the saved-folder bound", async () => {
    const names = Array.from({ length: 600 }, (_, i) => `d${String(i).padStart(3, "0")}`);
    const panel = await mountPanel({
      directories: names,
      files: Object.fromEntries(names.map((name) => [`${name}/f.txt`, "f"])),
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "d000/f.txt"));
      await act(async () => panel.labelled("Expand all folders")!.props.onClick());
      const folder = panel.labelled("Workspace files")!.findAllByType("button")[0]!;
      // One folder closed by hand stays closed; every other one stays open.
      await act(async () => folder.props.onClick());
      await panel.reload();
      expect(panel.rows().slice(0, 3)).toEqual(["▸ d000/", "▾ d001/", "f.txt"]);
      await act(async () =>
        panel.labelled("Workspace files")!.findAllByType("button")[0]!.props.onClick(),
      );
      expect(panel.labelled("Collapse all folders")).toBeDefined();
    } finally {
      await panel.unmount();
    }
  });

  it("offers no control when the tree has no folders", async () => {
    const panel = await mountPanel({ files: { "only.txt": "o" } });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "only.txt"));
      expect(panel.labelled("Expand all folders")).toBeUndefined();
      expect(panel.labelled("Collapse all folders")).toBeUndefined();
    } finally {
      await panel.unmount();
    }
  });
});

// Native parity (FilePreviewPanel): the file explorer beside an open file
// can be hidden and shown again, and the choice survives a reload.
describe("hiding the file explorer", () => {
  const explorer = (panel: Panel) => ({
    tree: panel.labelled("Workspace files") !== undefined,
    search: panel.labelled("Search workspace files") !== undefined,
    hide: panel.button("Hide file explorer")?.props["aria-pressed"],
    show: panel.button("Show file explorer")?.props["aria-pressed"],
  });

  it("hides the tree and its search, then shows them again", async () => {
    const panel = await mountPanel({ files: { "a.txt": "a", "b.txt": "b" } });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "a.txt"));
      expect(explorer(panel)).toEqual({ tree: true, search: true, hide: true, show: undefined });
      await act(async () => panel.button("Hide file explorer")!.props.onClick());
      expect(explorer(panel)).toEqual({ tree: false, search: false, hide: undefined, show: false });
      expect(panel.editors()).toBe(1);
      await panel.reload();
      expect(explorer(panel)).toEqual({ tree: false, search: false, hide: undefined, show: false });
      await act(async () => panel.button("Show file explorer")!.props.onClick());
      expect(explorer(panel)).toEqual({ tree: true, search: true, hide: true, show: undefined });
    } finally {
      await panel.unmount();
    }
  });
});

// Native parity (FilePreviewPanel "Open file in preview browser"): a page
// opens in the thread's preview browser through t3.ui/navigation.
describe("opening a file in the preview browser", () => {
  const stubFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
    );

  it("offers it for pages only and opens the page from the workspace root", async () => {
    stubFetch();
    const previews: unknown[][] = [];
    const panel = await mountPanel({
      files: { "site/page.html": "<p>page</p>", "notes.txt": "n" },
      previewFile: async (...args) => {
        previews.push(args);
        return "opened";
      },
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "notes.txt"));
      expect(panel.button("Open file in preview browser")).toBeUndefined();
      await act(async () => useRightPanelStore.getState().openFile(ref, "site/page.html"));
      expect(panel.button("Open file in preview browser")).toBeDefined();
      await act(async () => panel.button("Open file in preview browser")!.props.onClick());
      expect(previews).toEqual([[ref, "/fixture/site/page.html", "/fixture"]]);
      expect(panel.text()).not.toContain("cannot be opened");
    } finally {
      await panel.unmount();
    }
  });

  it("names a browser that cannot open the page", async () => {
    stubFetch();
    const panel = await mountPanel({
      files: { "page.html": "<p>page</p>" },
      previewFile: async () => "browser-unavailable",
    });
    try {
      await act(async () => useRightPanelStore.getState().openFile(ref, "page.html"));
      expect(panel.button("Open file in preview browser")).toBeDefined();
      await act(async () => panel.button("Open file in preview browser")!.props.onClick());
      expect(panel.text()).toContain(
        "page.html cannot be opened — The preview browser is unavailable in this client",
      );
    } finally {
      await panel.unmount();
    }
  });
});

// Review backlog (proof-host-12 P3): a reload restores the latest line a link
// revealed, as native's persisted `revealLine` does, not the view's first one.
describe("a line revealed after the view opened", () => {
  it("is the line a reload reveals", async () => {
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: "0px", lineHeight: "16px" }));
    const panel = await mountPanel({ files: { "reveal.txt": "one\ntwo\nthree" } });
    try {
      await act(async () => panel.navigation({ relativePath: "reveal.txt", line: 2 }));
      expect(panel.textarea.carets.at(-1)).toBe(4);
      await act(async () => panel.navigation({ relativePath: "reveal.txt", line: 3 }));
      expect(panel.textarea.carets.at(-1)).toBe(8);
      await panel.reload();
      expect(panel.textarea.carets.at(-1)).toBe(8);
    } finally {
      await panel.unmount();
    }
  });
});
