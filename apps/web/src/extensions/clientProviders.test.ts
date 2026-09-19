import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ClientProviderCaller, ClientProviderEmitEvent } from "@t3tools/contracts";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import { applyThemeColorPreview, getThemeColorVariable, THEME_PREVIEW_ID } from "../themePalette";
import { themeStore } from "../hooks/useTheme";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  createClientProviders,
  createComposerClientProvider,
  createNotificationsClientProvider,
  createPanelsClientProvider,
  createTerminalAppearanceClientProvider,
  createThemeClientProvider,
  type ClientProviderDeps,
} from "./clientProviders";
import { ClientProviderOpError, type ClientProviderInvokeCall } from "./clientProviderTypes";
import {
  configureExtensionCommandEnvironment,
  unconfigureExtensionCommandEnvironment,
  type ExtensionCommandEnvironmentDeps,
} from "./extensionCommandRegistry";
import type { InstalledPackage } from "./installedController";

vi.mock("../components/ThreadTerminalDrawer", () => ({
  terminalThemeFromApp: () => ({
    background: { r: 10, g: 20, b: 30 },
    foreground: { r: 200, g: 201, b: 202 },
    cursor: { r: 1, g: 2, b: 3 },
  }),
}));

const ENV = "env-a";
const INSTALL = "ext.a";
const SURFACE = `${INSTALL}/panel`;
const HASH = "hash-a";

const caller = (overrides?: Partial<ClientProviderCaller>): ClientProviderCaller => ({
  installationId: INSTALL,
  contentHash: HASH,
  installationGeneration: 1,
  ...overrides,
});

const context = (overrides?: { environmentId?: string; projectId?: string }): ViewContext => ({
  client: "web",
  resource: {
    namespace: "t3.extensions",
    id: INSTALL,
    environmentId: overrides?.environmentId ?? ENV,
    projectId: overrides?.projectId ?? "project-a",
    threadId: "thread-a",
  },
});

function installation(
  capabilities: readonly string[],
  overrides?: { id?: string; contentHash?: string },
): InstalledPackage {
  return {
    id: overrides?.id ?? INSTALL,
    contentHash: overrides?.contentHash ?? HASH,
    enabled: true,
    installationGeneration: 1,
    grants: {
      capabilities: [...capabilities],
      projectIds: [ProjectId.make("project-a")],
    },
    package: {
      manifest: {
        id: INSTALL,
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: SURFACE,
            title: "Panel",
            placements: ["side-panel", "bottom-dock"],
            clients: ["web"],
            scope: "thread",
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
    },
  } as unknown as InstalledPackage;
}

function makeDeps(
  capabilities: readonly string[],
  emit?: (correlationId: string, event: ClientProviderEmitEvent) => void,
  extraInstallations: readonly InstalledPackage[] = [],
): ClientProviderDeps {
  const installed = installation(capabilities);
  return {
    environmentId: EnvironmentId.make(ENV),
    client: "web",
    emit: emit ?? vi.fn(),
    installations: () => [installed, ...extraInstallations],
  };
}

const signal = new AbortController().signal;

function invokeCall(
  method: string,
  input: unknown,
  overrides?: Partial<ClientProviderInvokeCall>,
): ClientProviderInvokeCall {
  return {
    method,
    input: input as ClientProviderInvokeCall["input"],
    context: context(),
    caller: caller(),
    signal,
    ...overrides,
  };
}

function expectDenied(fn: () => unknown, code = "client-target-denied") {
  try {
    fn();
    expect.unreachable("expected a ClientProviderOpError");
  } catch (error) {
    expect(error).toBeInstanceOf(ClientProviderOpError);
    expect((error as ClientProviderOpError).code).toBe(code);
  }
}

// Minimal DOM surface for theme painting + snapshot reads.
function stubThemeDom() {
  const dataset: Record<string, string> = {};
  const styleProps = new Map<string, string>();
  const classes = new Set<string>();
  const style = {
    setProperty: (key: string, value: string) => void styleProps.set(key, value),
    removeProperty: (key: string) => void styleProps.delete(key),
    backgroundColor: "",
  };
  const documentElement = {
    dataset,
    style,
    classList: {
      toggle: (cls: string, force?: boolean) => {
        const next = force ?? !classes.has(cls);
        if (next) classes.add(cls);
        else classes.delete(cls);
        return next;
      },
      contains: (cls: string) => classes.has(cls),
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
    },
  };
  vi.stubGlobal("document", {
    documentElement,
    body: { style: { backgroundColor: "" } },
    head: { append: vi.fn() },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ name: "", setAttribute: vi.fn(), content: "" }),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) => styleProps.get(key) ?? "",
    backgroundColor: "",
  }));
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return { dataset, styleProps, storage };
}

const THEME_CAPS = ["t3.ui/theme.read", "t3.ui/theme.write"];

beforeEach(() => {
  stubThemeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  unconfigureExtensionCommandEnvironment(ENV);
  useComposerDraftStore
    .getState()
    .clearDraftThread(scopeThreadRef(EnvironmentId.make(ENV), ThreadId.make("thread-a")));
});

describe("caller authorization", () => {
  it("rejects unknown installations, stale content hashes, and missing grants", () => {
    const deps = makeDeps(THEME_CAPS);
    const provider = createThemeClientProvider(deps);
    expectDenied(() =>
      provider.invoke(invokeCall("getState", {}, { caller: caller({ installationId: "ext.b" }) })),
    );
    expectDenied(() =>
      provider.invoke(invokeCall("getState", {}, { caller: caller({ contentHash: "other" }) })),
    );
    // Read is granted but write is not.
    const readOnly = createThemeClientProvider(makeDeps(["t3.ui/theme.read"]));
    readOnly.invoke(invokeCall("getState", {}));
    expectDenied(() =>
      readOnly.invoke(
        invokeCall("applyPreference", {
          writer: INSTALL,
          preference: { mode: "session", theme: "ocean" },
        }),
      ),
    );
  });

  it("rejects foreign environment and out-of-scope project contexts", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    expectDenied(() =>
      provider.invoke(invokeCall("getState", {}, { context: context({ environmentId: "env-b" }) })),
    );
    expectDenied(() =>
      provider.invoke(invokeCall("getState", {}, { context: context({ projectId: "project-b" }) })),
    );
  });
});

describe("theme provider", () => {
  it("reports the stored theme when nothing is painted", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    const state = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string };
      sessionOverlay: unknown;
    };
    expect(state.effectiveTheme.kind).toBe("stored");
    expect(state.sessionOverlay).toBeNull();
  });

  it("paints a session overlay owned by the calling installation", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    const applied = provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    ) as { applied: boolean };
    expect(applied.applied).toBe(true);
    const dataset = document.documentElement.dataset as Record<string, string>;
    expect(dataset.themeId).toBe(THEME_PREVIEW_ID);
    expect(dataset.themePreviewOwner).toBe(INSTALL);
    const state = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string; writer?: string };
    };
    expect(state.effectiveTheme.kind).toBe("session-overlay");
    expect(state.effectiveTheme.writer).toBe(INSTALL);
  });

  it("refuses to impersonate another installation as the writer", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    expectDenied(() =>
      provider.invoke(
        invokeCall("applyPreference", {
          writer: "ext.other",
          preference: { mode: "session", theme: "ocean" },
        }),
      ),
    );
  });

  it("yields to a foreign preview instead of clobbering it", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    // The theme editor owns the painted preview — provider writes must defer.
    applyThemeColorPreview({} as never, "light", "t3.theme-editor");
    const denied = provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    ) as { applied: boolean; reason: string };
    expect(denied).toEqual({ applied: false, reason: "external-preview-active" });
    const state = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string; writer?: string };
    };
    expect(state.effectiveTheme.kind).toBe("external-preview");
    expect(state.effectiveTheme.writer).toBe("t3.theme-editor");
  });

  it("supersedes a peer installation's overlay — equal peers, last-writer-wins", () => {
    const peer = installation(THEME_CAPS, { id: "ext.peer" });
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS, undefined, [peer]));
    // A peer's overlay owns the paint — it is superseded, not refused.
    applyThemeColorPreview({} as never, "light", "ext.peer");
    const applied = provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    ) as { applied: boolean };
    expect(applied.applied).toBe(true);
    const dataset = document.documentElement.dataset as Record<string, string>;
    expect(dataset.themePreviewOwner).toBe(INSTALL);
    const state = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string; writer?: string };
    };
    expect(state.effectiveTheme).toEqual({
      kind: "session-overlay",
      theme: "ocean",
      writer: INSTALL,
    });
  });

  it("does not resurrect a superseded overlay once the foreign paint clears", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    );
    // An editor draft takes the paint — the held overlay record is superseded.
    applyThemeColorPreview({} as never, "light", "t3.theme-editor");
    const foreign = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string };
    };
    expect(foreign.effectiveTheme.kind).toBe("external-preview");
    // The draft clears and the stored theme repaints: no ghost overlay resurfaces.
    themeStore.refreshTheme();
    const state = provider.invoke(invokeCall("getState", {})) as {
      effectiveTheme: { kind: string };
    };
    expect(state.effectiveTheme.kind).toBe("stored");
  });

  it("clears its own overlay and repaints the stored theme", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    );
    const cleared = provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", clear: true },
      }),
    ) as { applied: boolean };
    expect(cleared.applied).toBe(true);
    const dataset = document.documentElement.dataset as Record<string, string>;
    expect(dataset.themeId).not.toBe(THEME_PREVIEW_ID);
    expect(dataset.themePreviewOwner).toBeUndefined();
  });

  it("persists a stored preference through the theme store", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    const applied = provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "persist", theme: "grove" },
      }),
    ) as { applied: boolean; propagatedTo: string };
    expect(applied).toEqual({ applied: true, propagatedTo: "storage-origin" });
    expect(themeStore.getSnapshot().theme).toBe("grove");
  });

  it("resolves palette tokens for an appearance", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "persist", theme: "grove" },
      }),
    );
    const resolved = provider.invoke(invokeCall("resolveTokens", { appearance: "light" })) as {
      tokens: Record<string, string>;
      cssVars: Record<string, string>;
    };
    expect(Object.keys(resolved.tokens).length).toBeGreaterThan(0);
    expect(resolved.cssVars.canvas).toContain("--");
    expectDenied(
      () => provider.invoke(invokeCall("resolveTokens", { appearance: "auto" })),
      "provider-rejected",
    );
  });

  it("falls back to live computed tokens for the stock system theme", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    // Repaint the stock preference so leftover palette vars are stripped,
    // then simulate the stylesheet-resolved roles the app wears.
    provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "persist", theme: "system" },
      }),
    );
    const { styleProps } = stubThemeDom();
    styleProps.set(getThemeColorVariable("canvas"), "#fcfcfc");
    const resolved = provider.invoke(invokeCall("resolveTokens", {})) as {
      tokens: Record<string, string>;
    };
    expect(resolved.tokens.canvas).toBe("#fcfcfc");
  });

  it("streams a snapshot then data events on overlay changes", () => {
    const provider = createThemeClientProvider(makeDeps(THEME_CAPS));
    const events: ClientProviderEmitEvent[] = [];
    const close = provider.openStream!({
      name: "watchState",
      input: null,
      context: context(),
      caller: caller(),
      emit: (event) => events.push(event),
    });
    expect(events[0]?.type).toBe("snapshot");
    provider.invoke(
      invokeCall("applyPreference", {
        writer: INSTALL,
        preference: { mode: "session", theme: "ocean" },
      }),
    );
    expect(events.some((event) => event.type === "data")).toBe(true);
    if (typeof close === "function") close();
  });
});

describe("notifications provider", () => {
  it("shows a toast, emits action outcomes, and retains ownership", () => {
    const emits: [string, ClientProviderEmitEvent][] = [];
    const provider = createNotificationsClientProvider(
      makeDeps(["t3.ui/notify"], (correlationId, event) => emits.push([correlationId, event])),
    );
    const addSpy = vi.spyOn(toastManager, "add").mockReturnValue("toast-1" as never);
    const closeSpy = vi.spyOn(toastManager, "close").mockImplementation(() => {});
    provider.invoke(
      invokeCall("notify", {
        notification: {
          notificationId: "n-1",
          severity: "info",
          title: "Build done",
          body: "all good",
          actions: [{ id: "open", label: "Open" }],
        },
      }),
    );
    expect(addSpy).toHaveBeenCalledOnce();
    const toastOptions = addSpy.mock.calls[0]![0] as unknown as {
      title: string;
      data?: { additionalActions?: { props: { onClick: () => void } }[] };
    };
    expect(toastOptions.title).toBe("Build done");
    // Action click emits the outcome under the server correlation id.
    toastOptions.data?.additionalActions?.[0]?.props.onClick();
    expect(emits).toEqual([
      ["n-1", { type: "notificationOutcome", outcome: { actionId: "open" } }],
    ]);
    expect(closeSpy).toHaveBeenCalledWith("toast-1");
  });

  it("enforces owner-scoped update and dismiss", () => {
    const emits: [string, ClientProviderEmitEvent][] = [];
    const other = installation(["t3.ui/notify"], { id: "ext.b", contentHash: "hash-b" });
    const provider = createNotificationsClientProvider(
      makeDeps(["t3.ui/notify"], (correlationId, event) => emits.push([correlationId, event]), [
        other,
      ]),
    );
    vi.spyOn(toastManager, "add").mockReturnValue("toast-2" as never);
    const updateSpy = vi.spyOn(toastManager, "update").mockImplementation(() => {});
    const closeSpy = vi.spyOn(toastManager, "close").mockImplementation(() => {});
    provider.invoke(
      invokeCall("notify", {
        notification: { notificationId: "n-2", severity: "info", title: "Hi" },
      }),
    );
    // A different known installation cannot touch the notification.
    const foreign = caller({ installationId: "ext.b", contentHash: "hash-b" });
    expectDenied(
      () => provider.invoke(invokeCall("dismiss", { notificationId: "n-2" }, { caller: foreign })),
      "notification-owner-mismatch",
    );
    // Unknown id expires rather than lying.
    expectDenied(
      () => provider.invoke(invokeCall("dismiss", { notificationId: "n-404" })),
      "notification-expired",
    );
    provider.invoke(invokeCall("update", { notificationId: "n-2", patch: { title: "Updated" } }));
    expect(updateSpy).toHaveBeenCalledWith("toast-2", { title: "Updated" });
    const dismissed = provider.invoke(invokeCall("dismiss", { notificationId: "n-2" })) as {
      dismissed: boolean;
    };
    expect(dismissed.dismissed).toBe(true);
    expect(closeSpy).toHaveBeenCalledWith("toast-2");
    expect(emits.at(-1)).toEqual([
      "n-2",
      { type: "notificationOutcome", outcome: { dismissed: true } },
    ]);
  });

  it("settles a durationMs toast through its own timer, not the toast manager", () => {
    vi.useFakeTimers();
    try {
      const emits: [string, ClientProviderEmitEvent][] = [];
      const provider = createNotificationsClientProvider(
        makeDeps(["t3.ui/notify"], (correlationId, event) => emits.push([correlationId, event])),
      );
      vi.spyOn(toastManager, "add").mockReturnValue("toast-3" as never);
      const closeSpy = vi.spyOn(toastManager, "close").mockImplementation(() => {});
      provider.invoke(
        invokeCall("notify", {
          notification: {
            notificationId: "n-3",
            severity: "info",
            title: "Soon gone",
            durationMs: 4000,
          },
        }),
      );
      vi.advanceTimersByTime(4000);
      // A parked awaitAction can never be stranded by a timed-out toast.
      expect(emits).toEqual([
        ["n-3", { type: "notificationOutcome", outcome: { dismissed: true } }],
      ]);
      expect(closeSpy).toHaveBeenCalledWith("toast-3");
      // Settled notifications expire honestly for later management.
      expectDenied(
        () => provider.invoke(invokeCall("dismiss", { notificationId: "n-3" })),
        "notification-expired",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles the outcome when the manager closes the toast outside data.onClose", () => {
    const emits: [string, ClientProviderEmitEvent][] = [];
    const provider = createNotificationsClientProvider(
      makeDeps(["t3.ui/notify"], (correlationId, event) => emits.push([correlationId, event])),
    );
    const addSpy = vi.spyOn(toastManager, "add").mockReturnValue("toast-x" as never);
    provider.invoke(
      invokeCall("notify", {
        notification: { notificationId: "n-x", severity: "info", title: "Ephemeral" },
      }),
    );
    const toastOptions = addSpy.mock.calls[0]![0] as unknown as {
      timeout: number;
      onClose: () => void;
    };
    // The manager's own 5 s default must never apply — lifetime is owned here.
    expect(toastOptions.timeout).toBe(0);
    // A manager-driven close (auto-dismiss, closeAll, swipe) fires the
    // top-level onClose, which must settle the owned record.
    toastOptions.onClose();
    expect(emits).toEqual([["n-x", { type: "notificationOutcome", outcome: { dismissed: true } }]]);
    // Settle is first-write-wins: a second close emits nothing.
    toastOptions.onClose();
    expect(emits).toHaveLength(1);
    expectDenied(
      () => provider.invoke(invokeCall("dismiss", { notificationId: "n-x" })),
      "notification-expired",
    );
  });

  it("denies targeting outside the invocation scope and honors anchor/dismissible/variant", () => {
    const provider = createNotificationsClientProvider(makeDeps(["t3.ui/notify"]));
    const addSpy = vi.spyOn(toastManager, "add").mockReturnValue("toast-4" as never);
    // threadId naming another thread is denied, not silently ignored.
    expectDenied(() =>
      provider.invoke(
        invokeCall("notify", {
          notification: {
            notificationId: "n-4",
            severity: "info",
            title: "Hi",
            threadId: "thread-b",
          },
        }),
      ),
    );
    expectDenied(() =>
      provider.invoke(
        invokeCall("notify", {
          notification: {
            notificationId: "n-4",
            severity: "info",
            title: "Hi",
            projectId: "project-b",
          },
        }),
      ),
    );
    provider.invoke(
      invokeCall("notify", {
        notification: {
          notificationId: "n-5",
          severity: "warning",
          title: "Careful",
          anchor: "thread",
          threadId: "thread-a",
          dismissible: false,
          actions: [{ id: "revert", label: "Revert", variant: "destructive" }],
        },
      }),
    );
    const toastOptions = addSpy.mock.calls[0]![0] as unknown as {
      data?: {
        dismissible?: boolean;
        threadRef?: unknown;
        additionalActions?: { variant?: string }[];
      };
    };
    expect(toastOptions.data?.dismissible).toBe(false);
    // A thread anchor means the toast is thread-scoped through the native filter.
    expect(toastOptions.data?.threadRef).not.toBeUndefined();
    expect(toastOptions.data?.additionalActions?.[0]?.variant).toBe("destructive");
  });

  it("merges dismissible into toast data on update without dropping callbacks", () => {
    const provider = createNotificationsClientProvider(makeDeps(["t3.ui/notify"]));
    const addSpy = vi.spyOn(toastManager, "add").mockReturnValue("toast-6" as never);
    const updateSpy = vi.spyOn(toastManager, "update").mockImplementation(() => {});
    provider.invoke(
      invokeCall("notify", {
        notification: { notificationId: "n-6", severity: "info", title: "Hi" },
      }),
    );
    provider.invoke(invokeCall("update", { notificationId: "n-6", patch: { dismissible: false } }));
    const patch = updateSpy.mock.calls[0]![1] as { data?: Record<string, unknown> };
    // `data` replaces wholesale on update — the merge must keep onClose alive.
    expect(patch.data?.dismissible).toBe(false);
    expect(typeof patch.data?.onClose).toBe("function");
    expect(addSpy).toHaveBeenCalledOnce();
  });
});

describe("composer provider", () => {
  it("inserts context refs into the real draft store", () => {
    const provider = createComposerClientProvider(makeDeps(["t3.composer/write"]));
    const result = provider.invoke(
      invokeCall("insertContext", {
        threadId: "thread-a",
        refs: [{ path: "src/a.ts", startLine: 2, endLine: 4, excerpt: "const x = 1;" }],
      }),
    ) as { inserted: number };
    expect(result.inserted).toBe(1);
    const state = provider.invoke(invokeCall("getDraftState", { threadId: "thread-a" })) as {
      draft: { contextCounts: { reviewComments: number } } | null;
    };
    expect(state.draft?.contextCounts.reviewComments).toBe(1);
  });

  it("scopes draft access to the caller's thread context", () => {
    const provider = createComposerClientProvider(makeDeps(["t3.composer/write"]));
    expectDenied(() =>
      provider.invoke(
        invokeCall("insertContext", {
          threadId: "thread-b",
          refs: [{ path: "a.ts" }],
        }),
      ),
    );
    expectDenied(() => provider.invoke(invokeCall("getDraftState", { threadId: "thread-b" })));
  });

  it("requires the composer write grant", () => {
    const provider = createComposerClientProvider(makeDeps([]));
    expectDenied(() =>
      provider.invoke(
        invokeCall("insertContext", { threadId: "thread-a", refs: [{ path: "a.ts" }] }),
      ),
    );
  });

  it("attaches a file annotation and returns its id", () => {
    const provider = createComposerClientProvider(makeDeps(["t3.messages/write"]));
    const result = provider.invoke(
      invokeCall("attachAnnotation", {
        threadId: "thread-a",
        annotation: {
          filePath: "src/b.ts",
          startLine: 3,
          endLine: 5,
          body: "rename this",
          excerpt: "let y = 2;",
        },
      }),
    ) as { annotationId: string };
    expect(result.annotationId).toContain(`annotation:${INSTALL}:`);
    const draft = useComposerDraftStore
      .getState()
      .getComposerDraft(scopeThreadRef(EnvironmentId.make(ENV), ThreadId.make("thread-a")));
    expect(draft?.reviewComments.some((entry) => entry.id === result.annotationId)).toBe(true);
  });
});

describe("panels provider", () => {
  it("requires the panels grant and a known surface", () => {
    const noGrant = createPanelsClientProvider(makeDeps([]));
    expectDenied(() =>
      noGrant.invoke(
        invokeCall("openSurface", {
          threadId: "thread-a",
          surfaceId: SURFACE,
          placement: "side-panel",
        }),
      ),
    );
    const provider = createPanelsClientProvider(makeDeps(["t3.ui/panels"]));
    expectDenied(
      () =>
        provider.invoke(
          invokeCall("openSurface", {
            threadId: "thread-a",
            surfaceId: "ext.a/missing",
            placement: "side-panel",
          }),
        ),
      "panel-surface-not-found",
    );
  });

  it("defaults an omitted placement to the surface's first declared slot", () => {
    const dockOnly = {
      ...installation(["t3.ui/panels"]),
      package: {
        ...installation(["t3.ui/panels"]).package,
        manifest: {
          ...installation(["t3.ui/panels"]).package.manifest,
          surfaces: [
            {
              id: SURFACE,
              title: "Dock",
              placements: ["bottom-dock"],
              clients: ["web"],
              scope: "thread",
              capabilities: [],
              stateVersion: 1,
            },
          ],
        },
      },
    } as InstalledPackage;
    const provider = createPanelsClientProvider({
      environmentId: EnvironmentId.make(ENV),
      client: "web",
      emit: vi.fn(),
      installations: () => [dockOnly],
    });
    // Explicit wrong placement is rejected against the manifest declaration.
    expectDenied(
      () =>
        provider.invoke(
          invokeCall("openSurface", {
            threadId: "thread-a",
            surfaceId: SURFACE,
            placement: "side-panel",
          }),
        ),
      "provider-rejected",
    );
    // Omitted placement resolves to "bottom-dock" and proceeds — failing only
    // at the (unseeded) thread shell, not the placement declaration.
    expectDenied(
      () =>
        provider.invoke(invokeCall("openSurface", { threadId: "thread-a", surfaceId: SURFACE })),
      "panel-surface-not-found",
    );
  });

  it("lists no open surfaces on a fresh store and toggles the dock", () => {
    const provider = createPanelsClientProvider(makeDeps(["t3.ui/panels"]));
    const listed = provider.invoke(invokeCall("listSurfaces", { threadId: "thread-a" })) as {
      surfaces: unknown[];
    };
    expect(listed.surfaces).toEqual([]);
    expect(provider.invoke(invokeCall("showDock", { threadId: "thread-a" }))).toEqual({
      applied: true,
    });
    expect(provider.invoke(invokeCall("hideDock", { threadId: "thread-a" }))).toEqual({
      applied: true,
    });
  });
});

describe("terminal appearance provider", () => {
  it("reports the terminal theme derived from app state", () => {
    const provider = createTerminalAppearanceClientProvider(makeDeps(["t3.ui/theme.read"]));
    const snapshot = provider.invoke(invokeCall("getAppearance", {})) as {
      theme: { background: string; foreground: string; cursor: string };
      appearance: string;
    };
    expect(snapshot.theme.background).toBe("rgb(10, 20, 30)");
    expect(snapshot.appearance).toBe("light");
  });

  it("streams a snapshot for watchAppearance", () => {
    const provider = createTerminalAppearanceClientProvider(makeDeps(["t3.ui/theme.read"]));
    const events: ClientProviderEmitEvent[] = [];
    const close = provider.openStream!({
      name: "watchAppearance",
      input: null,
      context: context(),
      caller: caller(),
      emit: (event) => events.push(event),
    });
    expect(events[0]?.type).toBe("snapshot");
    if (typeof close === "function") close();
  });
});

describe("keybindings provider", () => {
  const keybindingsDeps = (): ExtensionCommandEnvironmentDeps => ({
    installationGeneration: (id) => (id === INSTALL ? 1 : null),
    installationSurfaces: (id) =>
      id === INSTALL
        ? [
            {
              id: SURFACE,
              title: "Panel",
              placements: ["side-panel"],
              clients: ["web"],
              scope: "thread",
              stateVersion: 1,
            },
          ]
        : null,
    installationGrants: (id) => (id === INSTALL ? ["project-a"] : null),
    client: "web",
  });

  it("rejects callers without the keybindings grant and registers for granted ones", () => {
    configureExtensionCommandEnvironment(ENV, keybindingsDeps());
    const providers = createClientProviders(makeDeps([]));
    const denied = providers.get("t3.client/keybindings")!;
    expectDenied(() =>
      denied.invoke(
        invokeCall("registerCommands", {
          commands: [{ id: "run", title: "Run", scope: "surface" }],
        }),
      ),
    );
    const granted = createClientProviders(makeDeps(["t3.ui/keybindings"])).get(
      "t3.client/keybindings",
    )!;
    const registered = granted.invoke(
      invokeCall("registerCommands", {
        commands: [{ id: "run", title: "Run", scope: "surface" }],
      }),
    ) as { commandSetToken: string; results: { status: string }[] };
    expect(registered.commandSetToken).toBeTruthy();
    expect(registered.results[0]?.status).toBe("registered");
  });
});
