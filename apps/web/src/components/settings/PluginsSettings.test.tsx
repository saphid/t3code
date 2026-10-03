import type { ReactElement } from "react";
import * as Cause from "effect/Cause";
import {
  EnvironmentId,
  type PluginInstallation,
  PluginInstallationId,
  type PluginNpmPackage,
} from "@t3tools/contracts";
import {
  PLUGIN_MANAGE_ACCESS_REQUIRED,
  type PluginManageAccess,
} from "@t3tools/client-runtime/state/pluginPresentation";
import { deliverPluginCatalog } from "@t3tools/client-runtime/state/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const add = vi.hoisted(() => vi.fn());
const consent = vi.hoisted(() => vi.fn());
const enable = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const npmAdd = vi.hoisted(() => vi.fn());
const stageUpdate = vi.hoisted(() => vi.fn());
const applyUpdate = vi.hoisted(() => vi.fn());
const discardUpdate = vi.hoisted(() => vi.fn());
const catalogQuery = vi.hoisted(() => ({
  data: null as unknown,
  error: null as string | null,
  isPending: false,
  isSuccess: true,
  refresh: vi.fn(),
}));
const npmQuery = vi.hoisted(() => ({
  data: null as unknown,
  error: null as string | null,
  isPending: false,
  isSuccess: true,
  refresh: vi.fn(),
}));
/** Every query atom a render asked for; null means it asked for none. */
const queried = vi.hoisted(() => [] as Array<unknown>);

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
    remove: "remove",
    catalog: () => "catalog",
  },
  pluginNpmEnvironment: {
    packages: () => "npm-packages",
    add: "npmAdd",
    stageUpdate: "stageUpdate",
    applyUpdate: "applyUpdate",
    discardUpdate: "discardUpdate",
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    queried.push(atom);
    return atom === "npm-packages" ? npmQuery : catalogQuery;
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    ({ add, consent, enable, remove, npmAdd, stageUpdate, applyUpdate, discardUpdate })[command] ??
    add,
}));
vi.mock("./PluginContributions", () => ({ PluginContributionsList: () => null }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => null },
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: true }),
}));
vi.mock("../../environments/primary", () => ({
  usePrimarySessionState: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

import {
  AddPluginDialog,
  InstallFromNpmDialog,
  PluginEnvironmentCatalog,
  PluginNpmUpdateSection,
  PluginReviewDialog,
} from "./PluginsSettings";

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
    status: null,
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

/** The access-check status slot, which always occupies the same space. */
function accessStatus(tree: ReactElement) {
  const slot = visitElements(
    tree,
    (candidate) =>
      typeof candidate.type === "function" && candidate.type.name === "AccessStatusSlot",
  );
  if (!slot) throw new Error("Status slot not found");
  return slot.props.status;
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
  const renderCatalog = (access: PluginManageAccess = "granted") => {
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

  it("explains a pending access check on the list in the header's status slot", () => {
    catalogQuery.data = deliverPluginCatalog([reply]);
    const checking = renderCatalog("pending");
    expect(accessStatus(checking)).toBe("Checking access…");
    expect(find(checking, isAddPlugin).disabled).toBe(true);
    const granted = renderCatalog("granted");
    expect(accessStatus(granted)).toBeNull();
    expect(find(granted, isAddPlugin).disabled).toBe(false);
  });

  it("keeps the view-only explanation through a re-check of a denied session", () => {
    catalogQuery.data = deliverPluginCatalog([reply]);
    const isViewOnly = (props: Record<string, unknown>) => props.title === "View only";
    expect(find(renderCatalog("denied"), isViewOnly).description).toBe(
      PLUGIN_MANAGE_ACCESS_REQUIRED,
    );
    const checking = renderCatalog("pending");
    expect(find(checking, isViewOnly).description).toBe(PLUGIN_MANAGE_ACCESS_REQUIRED);
    expect(accessStatus(checking)).toBe("Checking access…");
    expect(find(checking, isAddPlugin).disabled).toBe(true);
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
  const CHECKING = "Checking access…";
  const renderReview = (installation: PluginInstallation, canManage = true) => {
    hooks.beginRender();
    return PluginReviewDialog({
      environment,
      detail: { _tag: "found", installation },
      canManage,
      status: canManage ? null : CHECKING,
      notice: null,
      npm: null,
      onRetry: () => undefined,
      onClose: () => undefined,
    }) as ReactElement;
  };
  const isCheckbox = (props: Record<string, unknown>) =>
    typeof props.onCheckedChange === "function";
  const isApprove = (props: Record<string, unknown>) => props.children === "Approve and enable";
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
    expect(accessStatus(checking)).toBe(CHECKING);
    expect(find(checking, isApprove).disabled).toBe(true);
    expect(find(granted, isCheckbox).disabled).toBe(false);
    expect(accessStatus(granted)).toBeNull();
  });
});

const NPM_INTEGRITY = `sha512-${"A".repeat(86)}==`;
const npmPackage = (
  installationId: PluginInstallationId,
  staged: string | null = null,
): PluginNpmPackage => ({
  installationId,
  source: {
    registry: "https://registry.npmjs.org",
    name: "t3-notifier",
    version: "1.0.0",
    integrity: NPM_INTEGRITY,
    installedAt: "2026-10-04T00:00:00.000Z",
  },
  stagedUpdate:
    staged === null
      ? null
      : {
          version: "1.1.0",
          integrity: NPM_INTEGRITY,
          manifest: {
            id: "acme.notifier",
            name: "Notifier",
            version: "1.1.0",
            capabilities: [],
            proposedApi: false,
          } as unknown as NonNullable<PluginNpmPackage["stagedUpdate"]>["manifest"],
          source: { digest: staged, files: 4, bytes: 4096 },
          stagedAt: "2026-10-04T01:00:00.000Z",
        },
});
const settleMicrotasks = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe("InstallFromNpmDialog", () => {
  const renderInstall = (canManage: boolean) => {
    hooks.beginRender();
    return InstallFromNpmDialog({
      environment,
      canManage,
      status: null,
      notice: null,
      onClose: () => undefined,
      onInstalled: () => undefined,
    }) as ReactElement;
  };
  const type = (tree: ReactElement, id: string, value: string) =>
    (
      find(tree, (props) => props.id === id).onChange as (event: {
        target: { value: string };
      }) => void
    )({ target: { value } });
  /** Types a package and version into an open dialog, then submits by keyboard. */
  async function install(version: string, canManageAtSubmit = true) {
    type(renderInstall(true), "plugin-directory-name", " @acme/t3-notifier ");
    type(renderInstall(true), "plugin-directory-version", version);
    (find(renderInstall(canManageAtSubmit), isForm).onSubmit as (event: object) => void)({
      preventDefault: () => undefined,
    });
    await settleMicrotasks();
  }

  beforeEach(() => {
    hooks.reset();
    npmAdd.mockReset().mockReturnValue(new Promise(() => undefined));
  });

  it("downloads the exact version typed, and latest when none is", async () => {
    await install("1.2.3");
    expect(npmAdd).toHaveBeenCalledWith({
      environmentId: environment.environmentId,
      input: { name: "@acme/t3-notifier", version: "1.2.3" },
    });
    hooks.reset();
    npmAdd.mockClear();
    await install("");
    expect(npmAdd).toHaveBeenCalledWith({
      environmentId: environment.environmentId,
      input: { name: "@acme/t3-notifier", version: "latest" },
    });
  });

  it("sends nothing for a range or once the open dialog loses management authority", async () => {
    await install("^1.0.0");
    expect(npmAdd).not.toHaveBeenCalled();
    hooks.reset();
    await install("1.2.3", false);
    expect(npmAdd).not.toHaveBeenCalled();
  });
});

describe("PluginEnvironmentCatalog npm installs", () => {
  const installationId = PluginInstallationId.make("installation-npm");
  const installed = {
    installationId,
    directory: "/state/plugins/npm/pkg-1/package",
    manifest: null,
    source: { digest: `sha256:${"a".repeat(64)}`, files: 3, bytes: 2048 },
    problem: null,
    consent: null,
    enabled: false,
  } as unknown as PluginInstallation;
  const serverWith = (capabilities: Record<string, boolean>) =>
    ({
      ...environment,
      connection: { phase: "connected" },
      serverConfig: { environment: { platform: { machine: "server" }, capabilities } },
    }) as unknown as EnvironmentPresentation;
  const renderCatalog = (target: EnvironmentPresentation) => {
    hooks.beginRender();
    return PluginEnvironmentCatalog({
      environment: target,
      access: "granted",
      onRetryAccess: null,
    }) as ReactElement;
  };
  const isInstallFromNpm = (props: Record<string, unknown>) =>
    typeof props.onClick === "function" &&
    Array.isArray(props.children) &&
    props.children.includes("Install from npm");

  beforeEach(() => {
    hooks.reset();
    queried.length = 0;
    catalogQuery.data = deliverPluginCatalog([]);
    npmQuery.data = { packages: [] };
    npmQuery.refresh.mockReset();
    catalogQuery.refresh.mockReset();
  });

  it("offers no npm install and lists nothing from npm on a server without it", () => {
    const tree = renderCatalog(serverWith({ plugins: true }));
    expect(visitElements(tree, (candidate) => isInstallFromNpm(candidate.props))).toBeFalsy();
    expect(queried).not.toContain("npm-packages");
  });

  it("opens the review of an install with its reply and reads the list again", () => {
    const target = serverWith({ plugins: true, pluginNpm: true });
    expect(queried).toEqual([]);
    (find(renderCatalog(target), isInstallFromNpm).onClick as () => void)();
    const dialog = visitElements(
      renderCatalog(target),
      (candidate) =>
        typeof candidate.type === "function" && candidate.type.name === "InstallFromNpmDialog",
    )!;
    const reply = npmPackage(installationId);
    (dialog.props.onInstalled as (result: object) => void)({
      installation: installed,
      package: reply,
    });
    expect(npmQuery.refresh).toHaveBeenCalledTimes(1);
    const review = visitElements(
      renderCatalog(target),
      (candidate) =>
        typeof candidate.type === "function" && candidate.type.name === "PluginReviewDialog",
    )!;
    expect(review.props.npm).toMatchObject({
      installed: { list: npmQuery.data, reply },
    });
  });
});

describe("PluginReviewDialog npm download", () => {
  const installationId = PluginInstallationId.make("installation-npm");
  const unapproved = {
    installationId,
    directory: "/state/plugins/npm/pkg-1/package",
    manifest: null,
    source: { digest: `sha256:${"a".repeat(64)}`, files: 3, bytes: 2048 },
    problem: null,
    consent: null,
    enabled: false,
  } as unknown as PluginInstallation;
  const renderReview = (canManage: boolean) => {
    hooks.beginRender();
    return PluginReviewDialog({
      environment,
      detail: { _tag: "found", installation: unapproved },
      canManage,
      status: null,
      notice: null,
      npm: {
        state: { _tag: "available", list: { packages: [npmPackage(installationId)] } },
        installed: null,
        refresh: () => undefined,
      },
      onRetry: () => undefined,
      onClose: () => undefined,
    }) as ReactElement;
  };
  const isDiscard = (props: Record<string, unknown>) => props.children === "Discard";

  beforeEach(() => {
    hooks.reset();
    remove.mockReset().mockResolvedValue({ _tag: "Success", value: { installationId } });
  });

  it("discards an unapproved download by removing it, once", async () => {
    (find(renderReview(true), isDiscard).onClick as () => void)();
    await settleMicrotasks();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({
      environmentId: environment.environmentId,
      input: { installationId },
    });
  });

  it("sends nothing from a Discard whose dialog lost management authority", async () => {
    const opened = renderReview(true);
    renderReview(false);
    (find(opened, isDiscard).onClick as () => void)();
    await settleMicrotasks();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("PluginNpmUpdateSection", () => {
  const installationId = PluginInstallationId.make("installation-npm");
  const DIGEST_1 = `sha256:${"1".repeat(64)}`;
  const DIGEST_2 = `sha256:${"2".repeat(64)}`;
  const installation = {
    installationId,
    directory: "/state/plugins/npm/pkg-1/package",
    manifest: null,
    source: { digest: `sha256:${"a".repeat(64)}`, files: 3, bytes: 2048 },
    problem: null,
    consent: null,
    enabled: true,
  } as unknown as PluginInstallation;
  const settled: Array<PluginNpmPackage | null> = [];
  const renderSection = (pkg: PluginNpmPackage | null, canManage = true) => {
    hooks.beginRender();
    return PluginNpmUpdateSection({
      environment,
      installation,
      pkg,
      canManage,
      onSettled: (reply) => settled.push(reply),
    }) as ReactElement;
  };
  const isCheckbox = (props: Record<string, unknown>) =>
    typeof props.onCheckedChange === "function";
  const isApply = (props: Record<string, unknown>) => props.children === "Apply update";

  beforeEach(() => {
    hooks.reset();
    settled.length = 0;
    applyUpdate.mockReset();
    stageUpdate.mockReset();
  });

  it("applies only the acknowledged download, and reports a failure for a fresh read", async () => {
    applyUpdate.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail(new Error("Could not write the plugin's files.")),
    });
    (
      find(renderSection(npmPackage(installationId, DIGEST_1)), isCheckbox).onCheckedChange as (
        checked: boolean,
      ) => void
    )(true);
    // Another client downloaded a different version before Apply was pressed.
    (find(renderSection(npmPackage(installationId, DIGEST_2)), isApply).onClick as () => void)();
    await settleMicrotasks();
    expect(applyUpdate).not.toHaveBeenCalled();

    (find(renderSection(npmPackage(installationId, DIGEST_1)), isApply).onClick as () => void)();
    await settleMicrotasks();
    expect(applyUpdate).toHaveBeenCalledWith({
      environmentId: environment.environmentId,
      input: { installationId, digest: DIGEST_1 },
    });
    // A failed apply claims nothing; the screen reads what is installed again.
    expect(settled).toEqual([null]);
  });

  it("downloads nothing without management", async () => {
    const isForm = (props: Record<string, unknown>) => typeof props.onSubmit === "function";
    (
      find(renderSection(npmPackage(installationId), false), isForm).onSubmit as (
        event: object,
      ) => void
    )({ preventDefault: () => undefined });
    await settleMicrotasks();
    expect(stageUpdate).not.toHaveBeenCalled();
  });
});
