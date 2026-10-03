import type { ReactElement } from "react";
import { EnvironmentId, type PluginInstallation, PluginInstallationId } from "@t3tools/contracts";
import { deliverPluginCatalog } from "@t3tools/client-runtime/state/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const add = vi.hoisted(() => vi.fn());
const consent = vi.hoisted(() => vi.fn());
const enable = vi.hoisted(() => vi.fn());
const catalogQuery = vi.hoisted(() => ({
  data: null as unknown,
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
    // Runs on each render, as React's commit would before any later event.
    useLayoutEffect: (effect: () => void) => void effect(),
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
  pluginEnvironment: {
    add: "add",
    consent: "consent",
    enable: "enable",
    catalog: () => Symbol("catalog"),
  },
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => catalogQuery }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "consent" ? consent : command === "enable" ? enable : add,
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => null },
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: true }),
}));
vi.mock("../../environments/primary", () => ({
  usePrimarySessionState: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

import { AddPluginDialog, PluginEnvironmentCatalog, PluginReviewDialog } from "./PluginsSettings";

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
  const renderCatalog = (access: "granted" | "pending" = "granted") => {
    hooks.beginRender();
    return PluginEnvironmentCatalog({
      environment: connected,
      access,
      onRetryAccess: null,
    }) as ReactElement;
  };
  const isAddPlugin = (props: Record<string, unknown>) =>
    typeof props.onClick === "function" &&
    Array.isArray(props.children) &&
    props.children.includes("Add plugin");
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
    // The device clock steps backwards across the restart; ordering must not depend on it.
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    catalogQuery.refresh.mockReset().mockImplementation(() => {
      vi.mocked(Date.now).mockReturnValue(1_500);
    });
  });
  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  /** Opens Add, then delivers the add reply while the catalogue still shows `before`. */
  function addWhileCatalogShows(before: unknown) {
    catalogQuery.data = before;
    (find(renderCatalog(), isAddPlugin).onClick as () => void)();
    (addDialog(renderCatalog())!.onAdded as (installation: PluginInstallation) => void)(reply);
  }

  it("restarts the catalogue once and shows the reply until the restarted snapshot arrives", () => {
    addWhileCatalogShows(deliverPluginCatalog([]));
    expect(catalogQuery.refresh).toHaveBeenCalledTimes(1);
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "found", installation: reply });

    const listed = { ...reply, enabled: true };
    catalogQuery.data = deliverPluginCatalog([listed]);
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "found", installation: listed });
  });

  it("explains a pending access check on the list in the header's fixed slot", () => {
    catalogQuery.data = deliverPluginCatalog([reply]);
    const isStatus = (props: Record<string, unknown>) => props.role === "status";
    const checking = renderCatalog("pending");
    expect(find(checking, isStatus).children).toBe("Checking access…");
    expect(find(checking, isAddPlugin).disabled).toBe(true);
    const granted = renderCatalog("granted");
    expect(find(granted, isStatus).children).toBeNull();
    expect(find(granted, isAddPlugin).disabled).toBe(false);
  });

  it("ends as removed when the restarted snapshot equals the old one", () => {
    // Added and removed elsewhere before the old subscription reported either.
    addWhileCatalogShows(deliverPluginCatalog([]));
    catalogQuery.data = deliverPluginCatalog([]);
    expect(reviewDialog(renderCatalog())!.detail).toEqual({ _tag: "missing" });
  });
});

describe("PluginReviewDialog", () => {
  const DIGEST_A = `sha256:${"a".repeat(64)}`;
  const DIGEST_B = `sha256:${"b".repeat(64)}`;
  const reviewed = (digest: string) =>
    ({
      installationId: PluginInstallationId.make("installation-1"),
      directory: "/srv/plugins/notifier",
      manifest: null,
      source: { digest, files: 3, bytes: 2048 },
      problem: null,
      consent: null,
      enabled: false,
    }) as unknown as PluginInstallation;
  const CHECKING = "Checking your access to this environment…";
  const renderReview = (installation: PluginInstallation, canManage = true) => {
    hooks.beginRender();
    return PluginReviewDialog({
      environment,
      detail: { _tag: "found", installation },
      canManage,
      notice: canManage ? null : CHECKING,
      onRetry: () => undefined,
      onClose: () => undefined,
    }) as ReactElement;
  };
  const isCheckbox = (props: Record<string, unknown>) =>
    typeof props.onCheckedChange === "function";
  const isApprove = (props: Record<string, unknown>) => props.children === "Approve and enable";
  const isStatus = (props: Record<string, unknown>) => props.role === "status";
  const success = { _tag: "Success", value: { installation: reviewed(DIGEST_A) } };

  beforeEach(() => {
    hooks.reset();
    enable.mockReset().mockResolvedValue(success);
  });

  /** Acknowledges the files on screen, approves, and holds the consent reply. */
  function approveHoldingConsent() {
    let release: (value: unknown) => void = () => undefined;
    consent.mockReset().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    (find(renderReview(reviewed(DIGEST_A)), isCheckbox).onCheckedChange as (c: boolean) => void)(
      true,
    );
    (find(renderReview(reviewed(DIGEST_A)), isApprove).onClick as () => void)();
    return (value: unknown) => release(value);
  }
  const drain = async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };

  it("enables the reviewed files once consent succeeds", async () => {
    const release = approveHoldingConsent();
    renderReview(reviewed(DIGEST_A));
    release(success);
    await drain();
    expect(consent).toHaveBeenCalledWith({
      environmentId: environment.environmentId,
      input: { installationId: "installation-1", digest: DIGEST_A },
    });
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("never enables when the files change while consent is in flight", async () => {
    const release = approveHoldingConsent();
    // A snapshot reports new bytes for the same installation; access stays granted.
    renderReview(reviewed(DIGEST_B));
    release(success);
    await drain();
    expect(consent).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
  });

  it("keeps the acknowledgement and status slot laid out through an access check", () => {
    const granted = renderReview(reviewed(DIGEST_A));
    const checking = renderReview(reviewed(DIGEST_A), false);
    expect(find(checking, isCheckbox).disabled).toBe(true);
    expect(find(checking, isStatus).children).toBe(CHECKING);
    expect(find(checking, isApprove).disabled).toBe(true);
    expect(find(granted, isCheckbox).disabled).toBe(false);
    expect(find(granted, isStatus).children).toBeNull();
  });
});
