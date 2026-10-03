import type { ReactElement } from "react";
import { EnvironmentId, type PluginInstallation, PluginInstallationId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const add = vi.hoisted(() => vi.fn());
const catalogQuery = vi.hoisted(() => ({
  data: null as unknown,
  dataUpdatedAt: 0,
  error: null as string | null,
  isPending: false,
  isSuccess: true,
  refresh: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => undefined,
    useId: () => "plugin-directory",
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("../../state/plugins", () => ({
  pluginEnvironment: { add: Symbol("add"), catalog: () => Symbol("catalog") },
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => catalogQuery }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => add }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => null },
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: true }),
}));
vi.mock("../../environments/primary", () => ({
  usePrimarySessionState: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

import { AddPluginDialog, PluginEnvironmentCatalog } from "./PluginsSettings";

const environment = {
  environmentId: EnvironmentId.make("remote"),
  label: "Build box",
  entry: { target: { _tag: "RemoteConnectionTarget" } },
} as unknown as EnvironmentPresentation;

function renderDialog(canManage: boolean): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return AddPluginDialog({
    environment,
    canManage,
    notice: canManage ? null : "Managing plugins needs administrative access.",
    onClose: () => undefined,
    onAdded: () => undefined,
  }) as ReactElement<Record<string, unknown>>;
}

function find(tree: ReactElement, match: (props: Record<string, unknown>) => boolean) {
  const element = visitElements(tree, (candidate) => match(candidate.props));
  if (!element) throw new Error("Element not found");
  return element.props;
}

const isInput = (props: Record<string, unknown>) => props.id === "plugin-directory";
const isForm = (props: Record<string, unknown>) => typeof props.onSubmit === "function";
const isAddButton = (props: Record<string, unknown>) => props.children === "Add and review";

/** Types a directory, then submits by keyboard (the form) or by the Add button. */
async function typeAndSubmit(canManageAtSubmit: boolean, via: "keyboard" | "button") {
  const opened = renderDialog(true);
  (find(opened, isInput).onChange as (event: { target: { value: string } }) => void)({
    target: { value: " /srv/plugins/notifier " },
  });
  const current = renderDialog(canManageAtSubmit);
  if (via === "keyboard")
    (find(current, isForm).onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: () => undefined,
    });
  else (find(current, isAddButton).onClick as () => void)();
  await Promise.resolve();
}

describe("AddPluginDialog", () => {
  beforeEach(() => {
    hooks.reset();
    add.mockReset().mockReturnValue(new Promise(() => undefined));
  });

  it.each(["keyboard", "button"] as const)(
    "adds the typed directory by %s while management is allowed",
    async (via) => {
      await typeAndSubmit(true, via);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith({
        environmentId: environment.environmentId,
        input: { directory: "/srv/plugins/notifier" },
      });
    },
  );

  it.each(["keyboard", "button"] as const)(
    "sends nothing by %s once the open dialog loses management authority",
    async (via) => {
      await typeAndSubmit(false, via);
      expect(add).not.toHaveBeenCalled();
    },
  );
});

describe("PluginEnvironmentCatalog add handoff", () => {
  const installationId = PluginInstallationId.make("installation-1");
  const reply = { installationId, directory: "/srv/plugins/notifier" } as PluginInstallation;
  const connected = {
    ...environment,
    connection: { phase: "connected" },
    serverConfig: { environment: { platform: { machine: "server" } } },
  } as unknown as EnvironmentPresentation;
  const renderCatalog = () => {
    hooks.beginRender();
    return PluginEnvironmentCatalog({
      environment: connected,
      access: "granted",
      onRetryAccess: null,
    }) as ReactElement;
  };
  const byName = (name: string) => (tree: ReactElement) => {
    const element = visitElements(
      tree,
      (candidate) => typeof candidate.type === "function" && candidate.type.name === name,
    );
    return element?.props ?? null;
  };
  const addDialog = byName("AddPluginDialog");
  const reviewDialog = byName("PluginReviewDialog");

  beforeEach(() => {
    hooks.reset();
    catalogQuery.refresh.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(2_000);
  });
  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  /** Opens Add, then delivers the add reply while the catalogue still shows `before`. */
  function addWhileCatalogShows(before: unknown, receivedAt: number) {
    catalogQuery.data = before;
    catalogQuery.dataUpdatedAt = receivedAt;
    const opened = renderCatalog();
    (
      find(
        opened,
        (props) =>
          typeof props.onClick === "function" &&
          Array.isArray(props.children) &&
          props.children.includes("Add plugin"),
      ).onClick as () => void
    )();
    (addDialog(renderCatalog())!.onAdded as (installation: PluginInstallation) => void)(reply);
  }

  it("restarts the catalogue once and shows the reply until the restarted snapshot arrives", () => {
    addWhileCatalogShows({ _tag: "available", installations: [] }, 1_000);
    expect(catalogQuery.refresh).toHaveBeenCalledTimes(1);
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "found", installation: reply });

    const listed = { ...reply, enabled: true };
    catalogQuery.data = { _tag: "available", installations: [listed] };
    catalogQuery.dataUpdatedAt = 2_010;
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "found", installation: listed });
  });

  it("ends as removed when the restarted snapshot equals the old one", () => {
    // Added and removed elsewhere before the old subscription reported either.
    addWhileCatalogShows({ _tag: "available", installations: [] }, 1_000);
    catalogQuery.data = { _tag: "available", installations: [] };
    catalogQuery.dataUpdatedAt = 2_010;
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "missing" });
  });
});
