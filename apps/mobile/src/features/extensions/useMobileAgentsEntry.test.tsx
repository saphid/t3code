// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { MobileInstallation } from "./mobileExtensionHost";
import { useMobileAgentsEntry } from "./useMobileAgentsEntry";

const state = vi.hoisted(() => ({
  atom: null as unknown,
  connected: true,
  pending: false,
  detailStatus: "synchronizing",
  detailFailed: false,
}));
vi.mock("../../state/extension-installations", () => ({
  mobileExtensionInstallations: () => state.atom,
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    presentation: { connection: { phase: state.connected ? "connected" : "disconnected" } },
  }),
}));
vi.mock("../../state/use-thread-selection", () => ({
  useThreadSelection: () => ({
    selectedThreadRef: { environmentId: "e", threadId: "t" },
    selectedThread: state.pending
      ? null
      : { environmentId: "e", id: "t", projectId: "p", worktreePath: null },
    selectedThreadProject: { id: "p", workspaceRoot: "/project" },
    selectedThreadDetailState: {
      status: state.pending ? state.detailStatus : "live",
      error: state.detailFailed ? Option.some("Thread not found") : Option.none(),
    },
  }),
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: {} }));
afterEach(() => {
  vi.unstubAllGlobals();
  state.pending = false;
  state.connected = true;
  state.detailStatus = "synchronizing";
  state.detailFailed = false;
});

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useMobileAgentsEntry>;
  function Host() {
    const next = useMobileAgentsEntry("e");
    useLayoutEffect(() => {
      current = next;
    });
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        createElement(RegistryContext.Provider, { value: registry }, createElement(Host)),
      ),
    );
  await render();
  return {
    read: () => current,
    render,
    dispose: async () => {
      await act(() => root.unmount());
      registry.dispose();
    },
  };
}

describe("Agents catalogue and thread recovery", () => {
  it("shows unavailable on a connected list failure and Refresh actually refetches", async () => {
    let calls = 0;
    state.atom = Atom.make(
      Effect.suspend(() => {
        calls++;
        return calls === 1
          ? Effect.fail(new Error("Extensions list returned status 503."))
          : Effect.succeed<readonly MobileInstallation[]>([]);
      }),
    );
    const host = await mount();
    try {
      expect(calls).toBe(1);
      expect(host.read().entry.status).toBe("unavailable");
      await act(() => host.read().refresh());
      expect(calls).toBe(2);
      expect(host.read().entry.status).toBe("missing");
    } finally {
      await host.dispose();
    }
  });
  it.each([
    "Remote environment endpoint https://fixture.example/api/extensions/list returned undeclared status 404.",
    "Remote environment endpoint https://fixture.example/api/extensions/list returned undeclared status 405.",
    "Remote environment endpoint https://fixture.example/api/extensions/list returned undeclared status 501.",
    "Unknown request tag: subscribeExtensionCatalogue",
  ])(
    "shows incompatible when the connected server lacks the catalogue API: %s",
    async (message) => {
      state.atom = Atom.make(
        message.startsWith("Unknown request tag")
          ? Effect.die(message)
          : Effect.fail(new Error(message)),
      );
      const host = await mount();
      try {
        expect(host.read().entry.status).toBe("incompatible");
      } finally {
        await host.dispose();
      }
    },
  );
  it("keeps a disconnected catalogue failure offline", async () => {
    state.connected = false;
    state.atom = Atom.make(Effect.fail(new Error("Extensions list returned status 503.")));
    const host = await mount();
    try {
      expect(host.read().entry.status).toBe("offline");
    } finally {
      await host.dispose();
    }
  });
  it.each(["deleted", "live", "failed"])(
    "shows thread unavailable after selection settles: %s",
    async (status) => {
      state.pending = true;
      state.detailStatus = status === "failed" ? "synchronizing" : status;
      state.detailFailed = status === "failed";
      state.atom = Atom.make(Effect.succeed<readonly MobileInstallation[]>([]));
      const host = await mount();
      try {
        expect(host.read().entry.status).toBe("thread-unavailable");
      } finally {
        await host.dispose();
      }
    },
  );
  it.each(["empty", "synchronizing"])(
    "passes %s thread selection through the production hook",
    async (status) => {
      state.detailStatus = status;
      state.pending = true;
      state.atom = Atom.make(Effect.succeed<readonly MobileInstallation[]>([]));
      const host = await mount();
      try {
        expect(host.read().entry.status).toBe("loading");
        state.pending = false;
        await host.render();
        expect(host.read().entry.status).toBe("missing");
      } finally {
        await host.dispose();
      }
    },
  );
});
