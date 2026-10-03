import type { ReactElement } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentPresentation } from "../../state/environments";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const add = vi.hoisted(() => vi.fn());

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
vi.mock("../../state/plugins", () => ({ pluginEnvironment: { add: Symbol("add") } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => add }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => null },
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: true }),
}));
vi.mock("../../environments/primary", () => ({
  usePrimarySessionState: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

import { AddPluginDialog } from "./PluginsSettings";

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
